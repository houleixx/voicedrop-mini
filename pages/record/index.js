const audio = require('../../services/audio')
const wav = require('../../utils/wav')
const realtimeInterviewer = require('../../services/realtime-interviewer')
const app = getApp()

// Waveform pattern (Android uses 13 bars with fixed pattern scaled by amplitude)
const WAVE_PATTERN = [0.30, 0.56, 0.82, 0.48, 0.95, 0.65, 0.38, 0.74, 0.52, 0.86, 0.34, 0.62, 0.44]

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
    currentLevel: 0
  },

  onLoad(options) {
    this._alive = true
    this._stopping = false

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
    // Reconnect recorder events if page was backgrounded
    if (this.data.recorder) {
      this.bindRecorderEvents()
    }
  },

  onHide() {
    this.stopTimer()
  },

  startRecording() {
    this._alive = true
    this._stopping = false
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
      }
    })
    this.bindRecorderEvents()

    // Start the timer
    this.data.timerInterval = setInterval(() => {
      if (!this._alive) return
      const elapsed = Math.floor((Date.now() - this.data.startedAt) / 1000)
      this.setData({
        elapsedSeconds: elapsed,
        timerDisplay: this.formatTime(elapsed)
      })
    }, 200)

    // Start actual recording
    audio.startPcmFrames()
    return true
  },

  bindRecorderEvents() {
    const manager = this.data.recorder
    if (!manager) return
    if (this._recorderBound) return
    this._recorderBound = true

    this._frameRecordedHandler = (frame) => this.onRecordingFrame(frame)
    this._stopHandler = (res) => {
      const sessionId = this._recordSessionId
      const startedAt = this.data.startedAt
      const elapsed = Math.max(1, this.data.elapsedSeconds)
      const tag = this.data.tag
      const replyTo = this.data.replyTo
      const active = app.globalData.activeRecorderSession || {}
      if (active.type !== 'record' || active.id !== sessionId) {
        this.unbindRecorderEvents()
        return
      }

      this._stopping = true
      this.stopInterviewer()
      this.stopTimer()
      app.globalData.activeRecorderSession = null
      this._recordSessionId = null
      this.unbindRecorderEvents()
      this.data.recorder = null
      const name = audio.nameForSession(new Date(startedAt), elapsed)
      const wavPath = this.wavPathForSession(sessionId)

      // Show uploading toast
      if (this._alive) {
        wx.showLoading({ title: '上传中' })
        this._loadingShown = true
      }

      // Wrap raw PCM as WAV while retaining the Android-compatible .m4a object key.
      this.finalizePcmFile(res.tempFilePath, sessionId)
        .then((finalizedPath) => audio.uploadFile(finalizedPath, name, 'audio/wav'))
        .then(() => {
          // Upload tags if present
          if (tag) {
            return audio.uploadTags(name, [tag])
          }
          return true
        })
        .then(() => {
          // Handle community reply
          if (replyTo) {
            const pendingReplies = require('../../utils/pending-replies')
            pendingReplies.put(name, replyTo)
            app.globalData.pendingReplyTo = null
          }

          if (!this._alive) return
          wx.hideLoading()
          this._loadingShown = false
          wx.showToast({ title: '已上传' })

          // Navigate back to recordings
          wx.navigateBack({
            success: () => {
              if (!this._alive) return
              // Trigger refresh on recordings page
              const pages = getCurrentPages()
              const prevPage = pages[pages.length - 1]
              if (prevPage && prevPage.load) {
                prevPage.load()
              }
            }
          })
        })
        .catch((error) => {
          if (!this._alive) return
          wx.hideLoading()
          this._loadingShown = false
          wx.showToast({ title: '上传失败', icon: 'error' })
        })
        .finally(() => this.cleanupWavFile(wavPath))
    }

    this._errorHandler = () => {
      const sessionId = this._recordSessionId
      const active = app.globalData.activeRecorderSession || {}
      if (active.type !== 'record' || active.id !== sessionId) {
        this.stopInterviewer()
        this.stopTimer()
        this.unbindRecorderEvents()
        return
      }
      this._stopping = true
      this.stopTimer()
      this.stopInterviewer()
      app.globalData.activeRecorderSession = null
      this._recordSessionId = null
      this.unbindRecorderEvents()
      this.data.recorder = null
      if (!this._alive) return
      wx.showToast({ title: '录音失败', icon: 'error' })
      wx.navigateBack()
    }

    manager.onFrameRecorded(this._frameRecordedHandler)
    manager.onStop(this._stopHandler)
    manager.onError(this._errorHandler)
  },

  unbindRecorderEvents() {
    if (!this._recorderBound) return
    const manager = this.data.recorder
    if (manager) {
      if (manager.offFrameRecorded && this._frameRecordedHandler) manager.offFrameRecorded(this._frameRecordedHandler)
      if (manager.offStop && this._stopHandler) manager.offStop(this._stopHandler)
      if (manager.offError && this._errorHandler) manager.offError(this._errorHandler)
    }
    this._recorderBound = false
    this._frameRecordedHandler = null
    this._stopHandler = null
    this._errorHandler = null
  },

  onRecordingFrame(frame) {
    const active = app.globalData.activeRecorderSession || {}
    if (!this._alive || active.type !== 'record' || active.id !== this._recordSessionId || !frame || !frame.frameBuffer) return
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

  finalizePcmFile(filePath, sessionId) {
    return new Promise((resolve, reject) => {
      const fsManager = wx.getFileSystemManager()
      fsManager.readFile({
        filePath,
        success: (file) => {
          const data = wav.wrapPcm16Wav(file.data, { sampleRate: 16000, channels: 1, bitsPerSample: 16 })
          const wavPath = this.wavPathForSession(sessionId)
          fsManager.writeFile({ filePath: wavPath, data, success: () => resolve(wavPath), fail: reject })
        },
        fail: reject
      })
    })
  },

  cleanupWavFile(filePath) {
    return new Promise((resolve) => {
      const fsManager = wx.getFileSystemManager()
      if (!fsManager.unlink) {
        resolve()
        return
      }
      fsManager.unlink({ filePath, success: resolve, fail: resolve })
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

  stopRecording() {
    const manager = this.data.recorder
    const active = app.globalData.activeRecorderSession || {}
    if (!manager || this._stopping || active.type !== 'record' || active.id !== this._recordSessionId) return

    this._stopping = true
    this.stopInterviewer()
    this.stopTimer()
    audio.stop()
  },

  takePhoto() {
    // Camera functionality - same as Android's openCamera
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      success: (res) => {
        if (!this._alive) return
        wx.showToast({ title: '拍照功能开发中', icon: 'none' })
      }
    })
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
