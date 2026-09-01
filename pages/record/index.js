const audio = require('../../services/audio')
const recordingUploads = require('../../services/recording-upload-queue')
const wav = require('../../utils/wav')
const recording = require('../../utils/recording')
const recordingQuality = require('../../utils/recording-quality')
const photoInsert = require('../../utils/photo-insert')
const realtimeInterviewer = require('../../services/realtime-interviewer')
const app = getApp()

// Waveform pattern (Android uses 13 bars with fixed pattern scaled by amplitude)
const WAVE_PATTERN = [0.30, 0.56, 0.82, 0.48, 0.95, 0.65, 0.38, 0.74, 0.52, 0.86, 0.34, 0.62, 0.44]
const MIN_PCM_BYTES = 16000 * 2 / 10

function interruptedRecordingError() {
  const error = new Error('recording contains no usable PCM')
  error.emptyAudio = true
  return error
}

function refreshRecordingUploadQueue() {
  if (typeof getCurrentPages !== 'function') return
  const pages = getCurrentPages()
  const page = pages[pages.length - 1]
  if (!page || page.route !== 'pages/recordings/index') return
  if (typeof page.showPendingRecordingUploads === 'function') page.showPendingRecordingUploads()
  if (typeof page.drainPendingRecordingUploads === 'function') page.drainPendingRecordingUploads()
}

Page({
  data: {
    timerDisplay: '00:00',
    startedAt: 0,
    elapsedSeconds: 0,
    waveBars: [],
    waveColors: [],
    recorder: null,
    timerInterval: null,
    tag: '',
    replyTo: null,
    interviewActive: false,
    interviewState: 'idle',
    interviewStateText: '',
    currentLevel: 0,
    capturedPhotos: []
  },

  onLoad(options) {
    this._alive = true
    this._pageVisible = true
    this._stopping = false
    this._recordingPausedAt = 0
    this._recordingPausedMs = 0
    this._photoPickerRecoveryPending = false
    this._photoPickerCompleted = false
    this._photoPickerDidHide = false
    this._pendingPhotoPickerOpen = null
    this._photoPickerPauseTimer = null
    this._recoveringRecorder = false

    // Read tag/replyTo from globalData (set by recordings page before navigation)
    const tag = app.globalData.pendingRecordTag || ''
    const replyTo = app.globalData.pendingReplyTo || null

    // Initialize wave bars
    const bars = WAVE_PATTERN.map(() => 12)
    const colors = WAVE_PATTERN.map(() => this.colorForLevel(0))
    this.setData({
      waveBars: bars,
      waveColors: colors,
      tag,
      replyTo
    })

    this.startRecording()
  },

  onUnload() {
    this._alive = false
    this._pageVisible = false
    this.clearPhotoPickerPauseTimer()
    this._pendingPhotoPickerOpen = null
    if (this._loadingShown) {
      wx.hideLoading()
      this._loadingShown = false
    }
    const active = app.globalData.activeRecorderSession || {}
    if (active.type === 'record' && active.id === this._recordSessionId) {
      this.stopRecording()
      return
    }
    this.stopTimer()
    this.stopInterviewer()
    this.unbindRecorderEvents()
    this._recordSessionId = null
  },

  onShow() {
    this._pageVisible = true
    // Reconnect recorder events if page was backgrounded
    if (this.data.recorder) {
      this.bindRecorderEvents()
      const active = app.globalData.activeRecorderSession || {}
      if (!this._stopping && active.type === 'record' && active.id === this._recordSessionId) {
        if (this._photoPickerRecoveryPending) {
          this.recoverRecordingAfterPicker()
        } else if (this._recordingPausedAt) {
          this.resumeOwnedRecorder()
        } else {
          this.startTimer()
        }
      }
    }
  },

  onLanguageChanged() {
    if (!this.interviewer) return
    const state = this.interviewer.state()
    this.setData({ interviewStateText: state.stateText })
  },

  onHide() {
    this._pageVisible = false
    if (this._photoSelecting || this._photoPickerRecoveryPending) {
      this._photoPickerDidHide = true
      this.markRecordingPaused()
    }
    this.stopTimer()
  },

  startRecording() {
    this._alive = true
    this._stopping = false
    this._recordingPausedAt = 0
    this._recordingPausedMs = 0
    this._recoveringRecorder = false
    const active = app.globalData.activeRecorderSession || {}
    if (active.type === 'record') {
      if (this._alive) {
        wx.showToast({ title: '上一段录音正在结束，请稍后重试', icon: 'none' })
        wx.navigateBack()
      }
      return false
    }

    const sessionId = `record-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    app.globalData.activeRecorderSession = { type: 'record', id: sessionId }
    this._recordSessionId = sessionId
    this._aiAudioSegments = []
    const manager = audio.recorder()
    this.setData({ recorder: manager, startedAt: Date.now() })
    this.interviewer = realtimeInterviewer.createInterviewer({
      onChange: (state) => {
        if (!this._alive || this._recordSessionId !== sessionId) return
        this.setData({
          interviewActive: state.active,
          interviewState: state.state,
          interviewStateText: state.stateText
        })
      },
      onAiAudio: (data, delayMs) => {
        if (this._recordSessionId !== sessionId) return
        const elapsedMs = this.recordingElapsedMilliseconds()
        this._aiAudioSegments.push({
          data,
          sampleRate: 24000,
          startMs: elapsedMs + Math.max(0, Number(delayMs) || 0)
        })
      }
    })
    this.bindRecorderEvents()

    this.startTimer()

    // Start actual recording
    audio.startPcmFrames()
    return true
  },

  startTimer() {
    if (this.data.timerInterval) return
    const update = () => {
      if (!this._alive) return
      const elapsed = Math.floor(this.recordingElapsedMilliseconds() / 1000)
      this.setData({
        elapsedSeconds: elapsed,
        timerDisplay: this.formatTime(elapsed)
      })
    }
    update()
    this.data.timerInterval = setInterval(update, 200)
  },

  bindRecorderEvents() {
    const manager = this.data.recorder
    if (!manager) return
    if (this._recorderBound) return
    this._recorderBound = true

    this._frameRecordedHandler = (frame) => this.onRecordingFrame(frame)
    this._pauseHandler = () => {
      if (!this.ownsActiveRecording()) return
      this.markRecordingPaused()
      this.openPhotoPickerAfterPause()
    }
    this._resumeHandler = () => {
      if (!this.ownsActiveRecording()) return
      this._recoveringRecorder = false
      this.markRecordingResumed()
    }
    this._interruptionBeginHandler = () => {
      if (!this.ownsActiveRecording()) return
      this.markRecordingPaused()
    }
    this._interruptionEndHandler = () => {
      if (!this.ownsActiveRecording()) return
      if (this._photoPickerRecoveryPending) {
        this.recoverRecordingAfterPicker()
        return
      }
      this.resumeOwnedRecorder()
    }
    this._stopHandler = (res) => {
      const sessionId = this._recordSessionId
      const startedAt = this.data.startedAt
      const durationSeconds = recordingQuality.durationSeconds(
        res && res.duration,
        this.recordingElapsedMilliseconds()
      )
      const elapsed = Math.max(1, Math.round(durationSeconds))
      const tag = this.data.tag
      const replyTo = this.data.replyTo
      const capturedPhotos = (this.data.capturedPhotos || []).slice()
      const active = app.globalData.activeRecorderSession || {}
      if (active.type !== 'record' || active.id !== sessionId) {
        this.unbindRecorderEvents()
        return
      }
      const aiAudioSegments = this._aiAudioSegments || []
      this._aiAudioSegments = []

      this._stopping = true
      this._recoveringRecorder = false
      this._photoPickerRecoveryPending = false
      this.clearPhotoPickerPauseTimer()
      this._pendingPhotoPickerOpen = null
      this.stopInterviewer()
      this.stopTimer()
      app.globalData.activeRecorderSession = null
      this._recordSessionId = null
      this.unbindRecorderEvents()
      this.data.recorder = null

      if (recordingQuality.isTooShort(durationSeconds)) {
        app.globalData.pendingRecordTag = ''
        app.globalData.pendingReplyTo = null
        this.setData({ capturedPhotos: [] })
        audio.discardFile(res && res.tempFilePath).catch(() => {})
        if (this._alive) {
          wx.showModal({
            title: '录音太短',
            content: '时间太短，不足以产生文章，这条录音不会上传。',
            showCancel: false,
            confirmText: '知道了',
            success: () => wx.navigateBack()
          })
        }
        return
      }

      const name = audio.nameForSession(new Date(startedAt), elapsed)

      // The recorder has stopped and its temporary file is now safe to process.
      // Return at this point so slow local WAV encoding never keeps the user on
      // the recording page. The recordings page will show and drain the durable
      // upload plan once the background work below finishes.
      if (this._alive) {
        this.setData({ capturedPhotos: [] })
        wx.navigateBack()
      }

      // Wrap raw PCM as WAV while retaining the Android-compatible .m4a object key.
      // Persist the whole upload plan before starting network work. Photos always
      // gate their audio and survive a later retry from the recordings page.
      this.finalizePcmFile(res.tempFilePath, sessionId, aiAudioSegments)
        .then((finalizedPath) => recordingUploads.stage({
          name,
          audioPath: finalizedPath,
          contentType: 'audio/wav',
          photos: capturedPhotos,
          tag,
          replyTo
        }))
        .then((item) => {
          app.globalData.pendingRecordTag = ''
          app.globalData.pendingReplyTo = null
          refreshRecordingUploadQueue()
        })
        .catch((error) => {
          if (error && error.emptyAudio) {
            wx.showToast({
              title: '录音未保存：没有录到有效声音',
              icon: 'none'
            })
            return
          }
          if (error && error.photoUpload) {
            wx.showToast({ title: '照片暂未保存，录音已保留', icon: 'none' })
            return
          }
          wx.showToast({
            title: '录音保存失败',
            icon: 'none'
          })
        })
    }

    this._errorHandler = (error) => {
      const recovering = this._recoveringRecorder
      const sessionId = this._recordSessionId
      const active = app.globalData.activeRecorderSession || {}
      if (active.type !== 'record' || active.id !== sessionId) {
        this.stopInterviewer()
        this.stopTimer()
        this.unbindRecorderEvents()
        return
      }
      this._stopping = true
      this._recoveringRecorder = false
      this._photoPickerRecoveryPending = false
      this.clearPhotoPickerPauseTimer()
      this._pendingPhotoPickerOpen = null
      this.stopTimer()
      this.stopInterviewer()
      app.globalData.activeRecorderSession = null
      this._recordSessionId = null
      this.unbindRecorderEvents()
      this.data.recorder = null
      this._aiAudioSegments = []
      if (!this._alive) return
      const detail = String(error && (error.errMsg || error.message) || '请检查麦克风权限后重试')
      this._recordErrorMessage = detail
      wx.showModal({
        title: recovering ? '录音已中断' : '录音失败',
        content: recovering ? `录音恢复失败，请重新录制：${detail}` : `无法开始录音：${detail}`,
        showCancel: false,
        confirmText: '知道了'
      })
    }

    manager.onFrameRecorded(this._frameRecordedHandler)
    manager.onStop(this._stopHandler)
    manager.onError(this._errorHandler)
    if (manager.onPause) manager.onPause(this._pauseHandler)
    if (manager.onResume) manager.onResume(this._resumeHandler)
    if (manager.onInterruptionBegin) manager.onInterruptionBegin(this._interruptionBeginHandler)
    if (manager.onInterruptionEnd) manager.onInterruptionEnd(this._interruptionEndHandler)
  },

  unbindRecorderEvents() {
    if (!this._recorderBound) return
    const manager = this.data.recorder
    if (manager) {
      if (manager.offFrameRecorded && this._frameRecordedHandler) manager.offFrameRecorded(this._frameRecordedHandler)
      if (manager.offStop && this._stopHandler) manager.offStop(this._stopHandler)
      if (manager.offError && this._errorHandler) manager.offError(this._errorHandler)
      if (manager.offPause && this._pauseHandler) manager.offPause(this._pauseHandler)
      if (manager.offResume && this._resumeHandler) manager.offResume(this._resumeHandler)
      if (manager.offInterruptionBegin && this._interruptionBeginHandler) manager.offInterruptionBegin(this._interruptionBeginHandler)
      if (manager.offInterruptionEnd && this._interruptionEndHandler) manager.offInterruptionEnd(this._interruptionEndHandler)
    }
    this._recorderBound = false
    this._frameRecordedHandler = null
    this._stopHandler = null
    this._errorHandler = null
    this._pauseHandler = null
    this._resumeHandler = null
    this._interruptionBeginHandler = null
    this._interruptionEndHandler = null
  },

  onRecordingFrame(frame) {
    const active = app.globalData.activeRecorderSession || {}
    if (!this._alive || active.type !== 'record' || active.id !== this._recordSessionId || !frame || !frame.frameBuffer) return
    this._recoveringRecorder = false
    if (this._recordingPausedAt) this.markRecordingResumed()
    const peak = wav.peakAmplitude(frame.frameBuffer)
    this._peakAmplitude = Math.max(this._peakAmplitude || 0, peak)
    const level = Math.min(1, peak / 32767)
    this.setData({ currentLevel: level })
    this.updateWaveform(level)
    if (this.interviewer) this.interviewer.onPcm16(frame.frameBuffer, 16000)
  },

  toggleInterview() {
    if (this.interviewer) this.interviewer.toggle()
  },

  wavPathForSession(sessionId) {
    return `${wx.env.USER_DATA_PATH}/voicedrop-${sessionId}.wav`
  },

  finalizePcmFile(filePath, sessionId, aiAudioSegments) {
    return new Promise((resolve, reject) => {
      const fsManager = wx.getFileSystemManager()
      fsManager.readFile({
        filePath,
        success: (file) => {
          const pcmBytes = Number(file && file.data && file.data.byteLength) || 0
          if (pcmBytes < MIN_PCM_BYTES) {
            reject(interruptedRecordingError())
            return
          }
          const mixedPcm = wav.mixPcm16(
            file.data,
            aiAudioSegments || this._aiAudioSegments || [],
            { sampleRate: 16000, baseGainDuringOverlay: 0 }
          )
          const data = wav.wrapPcm16Wav(mixedPcm, { sampleRate: 16000, channels: 1, bitsPerSample: 16 })
          const wavPath = this.wavPathForSession(sessionId)
          fsManager.writeFile({ filePath: wavPath, data, success: () => resolve(wavPath), fail: reject })
        },
        fail: reject
      })
    })
  },

  stopInterviewer() {
    try {
      if (this.interviewer) this.interviewer.stop()
    } catch (_) {
      // Interviewing is optional and must never block the primary recording path.
    } finally {
      this.interviewer = null
    }
  },

  ownsActiveRecording() {
    const active = app.globalData.activeRecorderSession || {}
    return Boolean(
      this._alive &&
      !this._stopping &&
      active.type === 'record' &&
      active.id === this._recordSessionId
    )
  },

  recordingElapsedMilliseconds(now = Date.now()) {
    const startedAt = Number(this.data.startedAt) || 0
    if (!startedAt) return 0
    const end = this._recordingPausedAt || now
    return Math.max(0, end - startedAt - (this._recordingPausedMs || 0))
  },

  markRecordingPaused() {
    if (!this._recordingPausedAt) this._recordingPausedAt = Date.now()
    this.stopTimer()
  },

  markRecordingResumed() {
    if (this._recordingPausedAt) {
      this._recordingPausedMs += Math.max(0, Date.now() - this._recordingPausedAt)
      this._recordingPausedAt = 0
    }
    if (this._pageVisible && this.ownsActiveRecording()) this.startTimer()
  },

  clearPhotoPickerPauseTimer() {
    if (!this._photoPickerPauseTimer) return
    clearTimeout(this._photoPickerPauseTimer)
    this._photoPickerPauseTimer = null
  },

  openPhotoPickerAfterPause() {
    const open = this._pendingPhotoPickerOpen
    if (!open) return false
    this._pendingPhotoPickerOpen = null
    this.clearPhotoPickerPauseTimer()
    if (!this.ownsActiveRecording()) {
      this._photoSelecting = false
      this._photoPickerRecoveryPending = false
      return false
    }
    open()
    return true
  },

  pauseRecordingForPhotoPicker(open) {
    const manager = this.data.recorder
    this._pendingPhotoPickerOpen = open
    this.markRecordingPaused()
    if (!manager || typeof manager.pause !== 'function') {
      return this.openPhotoPickerAfterPause()
    }
    this._photoPickerPauseTimer = setTimeout(() => {
      // Some base-library/device combinations omit onPause even though pause()
      // has already taken effect. Give the state transition time, then continue.
      this.openPhotoPickerAfterPause()
    }, 300)
    try {
      manager.pause()
      return true
    } catch (_) {
      this.clearPhotoPickerPauseTimer()
      this._pendingPhotoPickerOpen = null
      this._photoSelecting = false
      this._photoPickerRecoveryPending = false
      this._photoPickerCompleted = false
      this._photoPickerDidHide = false
      this.markRecordingResumed()
      if (this._alive) wx.showToast({ title: '无法暂停录音，请停止后再拍照', icon: 'none' })
      return false
    }
  },

  resumeOwnedRecorder() {
    if (!this.ownsActiveRecording()) return false
    const manager = this.data.recorder
    if (!manager || typeof manager.resume !== 'function' || this._recoveringRecorder) return false
    this._recoveringRecorder = true
    try {
      manager.resume()
      return true
    } catch (error) {
      this._recoveringRecorder = false
      this.markRecordingPaused()
      if (this._alive) {
        wx.showToast({ title: '录音恢复失败，请重新录制', icon: 'none' })
      }
      return false
    }
  },

  recoverRecordingAfterPicker() {
    if (
      !this._photoPickerRecoveryPending ||
      !this._photoPickerCompleted ||
      !this._pageVisible
    ) return false

    const shouldResume = Boolean(this._photoPickerDidHide || this._recordingPausedAt)
    this._photoPickerRecoveryPending = false
    this._photoPickerCompleted = false
    this._photoPickerDidHide = false
    if (shouldResume) return this.resumeOwnedRecorder()
    if (this.ownsActiveRecording()) this.startTimer()
    return false
  },

  stopRecording() {
    const manager = this.data.recorder
    const active = app.globalData.activeRecorderSession || {}
    if (!manager || this._stopping || active.type !== 'record' || active.id !== this._recordSessionId) return

    this._stopping = true
    this.clearPhotoPickerPauseTimer()
    this._pendingPhotoPickerOpen = null
    this.stopInterviewer()
    this.stopTimer()
    audio.stop()
  },

  takePhoto() {
    if (this._photoSelecting || this._stopping) return
    const current = this.data.capturedPhotos || []
    const remaining = Math.max(0, 9 - current.length)
    if (!remaining) {
      wx.showToast({ title: '每段录音最多添加 9 张照片', icon: 'none' })
      return
    }
    const appendPhotos = (files) => {
      if (!this._alive) return
      const known = new Set((this.data.capturedPhotos || []).map((photo) => photo.path))
      const sessionTs = recording.timestamp(new Date(this.data.startedAt))
      const fallbackOffset = Math.floor(this.recordingElapsedMilliseconds() / 1000)
      const additions = (files || [])
        .map((file) => Object.assign({}, file, { path: file.tempFilePath || file.path || '' }))
        .filter((file) => file.path && !known.has(file.path))
        .map((file) => ({
          path: file.path,
          key: recording.photoKey(
            sessionTs,
            photoInsert.photoOffsetForFile(sessionTs, file, fallbackOffset)
          )
        }))
      this.setData({ capturedPhotos: current.concat(additions).slice(0, 9) })
    }
    const finish = () => {
      this.clearPhotoPickerPauseTimer()
      this._pendingPhotoPickerOpen = null
      this._photoSelecting = false
      this._photoPickerCompleted = true
      this.recoverRecordingAfterPicker()
    }
    this._photoSelecting = true
    this._photoPickerRecoveryPending = true
    this._photoPickerCompleted = false
    this._photoPickerDidHide = false
    const openPicker = () => {
      if (wx.chooseMedia) {
        wx.chooseMedia({
          count: remaining,
          mediaType: ['image'],
          sourceType: ['camera', 'album'],
          sizeType: ['compressed'],
          success: (res) => appendPhotos(res.tempFiles || []),
          fail: finish,
          complete: finish
        })
        return
      }
      if (wx.chooseImage) {
        wx.chooseImage({
          count: remaining,
          sourceType: ['camera', 'album'],
          sizeType: ['compressed'],
          success: (res) => appendPhotos(
            res.tempFiles && res.tempFiles.length
              ? res.tempFiles
              : (res.tempFilePaths || []).map((path) => ({ path }))
          ),
          fail: finish,
          complete: finish
        })
        return
      }
      finish()
      wx.showToast({ title: '当前微信不支持选择图片', icon: 'none' })
    }
    this.pauseRecordingForPhotoPicker(openPicker)
  },

  removePhoto(event) {
    if (this._stopping) return
    const index = Number(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) return
    const photos = (this.data.capturedPhotos || []).slice()
    if (index >= photos.length) return
    photos.splice(index, 1)
    this.setData({ capturedPhotos: photos })
  },

  updateWaveform(level) {
    const bars = WAVE_PATTERN.map((pattern) => Math.max(12, Math.round(Math.min(1, pattern * (0.22 + level * 0.95)) * 80)))
    const colors = bars.map((height) => this.colorForLevel(height / 80))
    this.setData({ waveBars: bars, waveColors: colors })
  },

  colorForLevel(ratio) {
    if (ratio > 0.6) return '#e9332c'
    if (ratio > 0.3) return '#eba89f'
    return '#e5c8c3'
  },

  stopTimer() {
    if (this.data.timerInterval) {
      clearInterval(this.data.timerInterval)
      if (this._alive) this.setData({ timerInterval: null })
      else this.data.timerInterval = null
    }
  },

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
})
