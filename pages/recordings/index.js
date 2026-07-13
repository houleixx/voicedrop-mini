const library = require('../../services/library')
const audio = require('../../services/audio')
const statusSession = require('../../services/status-session')
const libraryCommand = require('../../services/library-command')
const asrDictation = require('../../services/asr-dictation')
const community = require('../../services/community')
const blockStore = require('../../utils/block-store')
const pendingReplies = require('../../utils/pending-replies')
const prefs = require('../../utils/prefs')
const recordingQuality = require('../../utils/recording-quality')
const recordingUtil = require('../../utils/recording')
const resumeRefresh = require('../../utils/resume-refresh')
const holdToTalk = require('../../utils/hold-to-talk')
const audioConsentFlow = require('../../utils/audio-consent-flow')

const app = getApp()

Page({
  data: {
    activeTab: 'recordings',
    currentHomeTab: 'recordings',
    homeTabs: [
      { key: 'recordings', label: '我的录音' },
      { key: 'community', label: 'VD社区' }
    ],
    loading: false,
    recording: false,
    startedAt: 0,
    seconds: 0,
    allRecords: [],
    records: [],
    homeTags: [],
    selectedTag: '',
    selectedTagMissing: false,
    error: '',
    commandText: '',
    commandState: '',
    commandQueue: [],
    commandReply: '',
    commandReplyOk: true,
    commandStatusText: '',
    commandStatusOk: true,
    commandTalking: false,
    commandCanceled: false,
    dockHint: '轻点录音 · 长按说话',
    linkRequest: null,
    communityLoading: false,
    communityPosts: [],
    communityError: '',
    communityLoaded: false,
    audioConsentVisible: false,
    scrollContentTop: 0
  },

  onLoad(options) {
    this.initialLoadStarted = true
    this.topLevelUiRendered = false
    const activeTab = this.initialTab(options)
    this.setData({ activeTab, currentHomeTab: activeTab })
    try {
      const info = wx.getSystemInfoSync()
      const statusBarPx = info.statusBarHeight
      const topRpx = 200
      const pxPerRpx = info.windowWidth / 750
      this.setData({ scrollContentTop: statusBarPx + topRpx * pxPerRpx })
    } catch (_) {
      this.setData({ scrollContentTop: 200 * (wx.getSystemInfoSync?.().windowWidth || 375) / 750 + 20 })
    }
    this.bindRecorder()
    this.createStatusSession()
    this.createCommandSession()
    this.load()
    if (this.data.activeTab === 'community') this.loadCommunity()
  },

  onShow() {
    if (this.statusSession) this.statusSession.connect()
    if (this.commandSession) {
      this.commandSession.setRefs(this.currentCommandRefs())
      this.commandSession.connect()
    }
    this.applyPendingHomeTab()
    if (this.initialLoadStarted && !this.topLevelUiRendered) return
    if (!this.initialLoadStarted) {
      this.load()
      if (this.data.activeTab === 'community') this.loadCommunity()
      return
    }
    if (this.data.activeTab === 'community') {
      if (this.data.communityLoaded) this.loadCommunity({ silent: true, keepDataOnError: true })
      else this.loadCommunity()
    }
    const redraw = resumeRefresh.shouldRedrawOnResume(false, this.topLevelUiRendered)
    if (redraw) this.load()
    else this.load({ silent: true, keepDataOnError: true })
  },

  onHide() {
    if (this.statusSession) this.statusSession.close()
    if (this.commandSession) this.commandSession.close()
  },

  onUnload() {
    audioConsentFlow.dispose(this)
    if (this.statusSession) this.statusSession.close()
    if (this.commandSession) this.commandSession.close()
    if (this.asrSession) this.asrSession.close()
    if (this.asrRecorder) this.asrRecorder.stop()
  },

  onPullDownRefresh() {
    this.refreshCurrent().finally(() => wx.stopPullDownRefresh())
  },

  onShareAppMessage() {
    return {
      title: this.data.activeTab === 'community' ? 'VD社区' : 'VoiceDrop 口述',
      path: this.data.activeTab === 'community' ? '/pages/recordings/index?tab=community' : '/pages/recordings/index'
    }
  },

  onShareTimeline() {
    return {
      title: this.data.activeTab === 'community' ? 'VD社区' : 'VoiceDrop 口述',
      query: this.data.activeTab === 'community' ? 'tab=community' : ''
    }
  },

  initialTab(options) {
    const fromQuery = options && options.tab
    const pending = app.globalData.pendingHomeTab || ''
    const tab = fromQuery || pending || 'recordings'
    app.globalData.pendingHomeTab = ''
    return tab === 'community' ? 'community' : 'recordings'
  },

  applyPendingHomeTab() {
    const pending = app.globalData.pendingHomeTab || ''
    if (!pending) return
    app.globalData.pendingHomeTab = ''
    if (pending === this.data.activeTab) return
    this.setData({ activeTab: pending === 'community' ? 'community' : 'recordings' })
    if (this.data.activeTab === 'community' && !this.data.communityLoaded) this.loadCommunity()
  },

  switchHomeTab(event) {
    const key = event.detail && event.detail.key
    if (!key || key === this.data.currentHomeTab) return
    if (key.startsWith('tag:')) {
      const tag = event.detail.tab && event.detail.tab.tag || key.slice(4)
      this.setData({
        activeTab: 'recordings',
        currentHomeTab: key,
        selectedTag: tag,
        selectedTagMissing: Boolean(tag && !this.data.homeTags.includes(tag)),
        records: recordingUtil.filterByTag(this.data.allRecords, tag)
      })
      if (this.commandSession) this.commandSession.setRefs(this.currentCommandRefs())
      return
    }
    const activeTab = key === 'community' ? 'community' : 'recordings'
    const selectedTag = activeTab === 'recordings' ? '' : this.data.selectedTag
    this.setData({
      activeTab,
      currentHomeTab: key,
      selectedTag,
      selectedTagMissing: false,
      records: activeTab === 'recordings' ? recordingUtil.filterByTag(this.data.allRecords, '') : this.data.records
    })
    if (activeTab === 'community' && !this.data.communityLoaded) this.loadCommunity()
    if (this.commandSession) this.commandSession.setRefs(this.currentCommandRefs())
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/index' })
  },

  refreshCurrent() {
    if (this.data.activeTab === 'community') return this.loadCommunity()
    return this.load()
  },

  bindRecorder() {
    const manager = audio.recorder()
    manager.onStop(async (res) => {
      const active = app.globalData.activeRecorderSession || {}
      if (active.type === 'asr') {
        this._asrMode = false
        this._skipRecorderStopCount = Math.max(0, (this._skipRecorderStopCount || 0) - 1)
        return
      }
      if (active.type !== 'recordings') return
      // Skip upload if this stop was triggered by ASR dictation session
      // Use synchronous flag because setData is async and commandTalking may already be false
      if (this._asrMode || this._skipRecorderStopCount > 0) {
        this._asrMode = false
        this._skipRecorderStopCount = Math.max(0, (this._skipRecorderStopCount || 0) - 1)
        return
      }

      const elapsed = Math.max(1, Math.round((Date.now() - this.data.startedAt) / 1000))
      const name = audio.nameForSession(new Date(this.data.startedAt), elapsed)
      this.setData({ recording: false, seconds: elapsed })
      if (recordingQuality.looksSilent(res.peakAmplitude, elapsed)) {
        wx.showToast({ title: '没有检测到明显声音', icon: 'none' })
      }
      wx.showLoading({ title: '上传中' })
      try {
        await audio.uploadFile(res.tempFilePath, name)
        if (app.globalData.pendingRecordTag) {
          await audio.uploadTags(name, [app.globalData.pendingRecordTag])
          app.globalData.pendingRecordTag = ''
        }
        if (app.globalData.pendingReplyTo) {
          pendingReplies.put(name, app.globalData.pendingReplyTo)
          app.globalData.pendingReplyTo = null
        }
        wx.showToast({ title: '已上传' })
        await this.load()
      } catch (error) {
        wx.showToast({ title: '上传失败', icon: 'error' })
      } finally {
        wx.hideLoading()
      }
    })
    manager.onError(() => {
      this.setData({ recording: false })
      wx.showToast({ title: '录音失败', icon: 'error' })
    })
  },

  async load(options) {
    const silent = Boolean(options && options.silent)
    const keepDataOnError = Boolean(options && options.keepDataOnError)
    if (!silent) this.setData({ loading: true, error: '' })
    try {
      const records = await library.list()
      const selectedTag = this.selectedTagFor(records)
      const homeTags = recordingUtil.tagsFromRecords(records)
      const homeTabs = this.homeTabsFor(homeTags)
      // Assign command reference numbers to records with articles
      const recordsWithRefs = this.assignCommandRefs(records)
      const filteredRecords = recordingUtil.filterByTag(recordsWithRefs, selectedTag)
      const currentHomeTab = this.data.activeTab === 'community'
        ? 'community'
        : (selectedTag ? `tag:${selectedTag}` : 'recordings')

      this.setData({
        allRecords: recordsWithRefs,
        homeTags,
        homeTabs,
        selectedTag,
        selectedTagMissing: Boolean(selectedTag && !homeTags.includes(selectedTag)),
        currentHomeTab,
        records: filteredRecords
      })
      this.publishPendingReplies(records)
      if (this.commandSession) this.commandSession.setRefs(this.currentCommandRefs())
    } catch (error) {
      if (!keepDataOnError || !this.data.records.length) {
        this.setData({ error: this.loadErrorMessage(error) })
      }
    } finally {
      this.topLevelUiRendered = true
      if (!silent) this.setData({ loading: false })
    }
  },

  async publishPendingReplies(records) {
    try {
      const count = await pendingReplies.publishReadyReplies(records, async (rec, replyTo) => Boolean(await community.share(rec, replyTo)))
      if (count > 0) wx.showToast({ title: `已发布 ${count} 篇回应` })
    } catch (error) {
    }
  },

  loadErrorMessage(error) {
    return error && (error.message || error.errMsg) || '加载失败'
  },

  async loadCommunity(options) {
    const silent = Boolean(options && options.silent)
    const keepDataOnError = Boolean(options && options.keepDataOnError)
    if (!silent) this.setData({ communityLoading: true, communityError: '' })
    try {
      const posts = await community.list()
      const visible = posts.filter((post) => !blockStore.isBlocked(post.author || post.authorName || ''))
      const ranking = await community.rank(visible).catch(() => ({ order: [], liked: [] }))
      if (ranking.liked && ranking.liked.length) prefs.setLikedCommunityPosts(new Set(ranking.liked))
      const byId = {}
      visible.forEach((post) => { byId[post.shareId] = post })
      const ranked = ranking.order && ranking.order.length
        ? ranking.order.map((id) => byId[id]).filter(Boolean).concat(visible.filter((post) => !ranking.order.includes(post.shareId)))
        : visible
      this.setData({ communityPosts: ranked, communityLoaded: true, communityError: '' })
    } catch (error) {
      if (!keepDataOnError || !this.data.communityPosts.length) {
        this.setData({ communityError: this.loadErrorMessage(error) })
      }
    } finally {
      if (!silent) this.setData({ communityLoading: false })
    }
  },

  createStatusSession() {
    this.statusSession = statusSession.createSession({
      onPhase: ({ stem, status }) => this.updateRecordStatus(stem, status),
      onDone: ({ stem, status }) => {
        this.updateRecordStatus(stem, status)
        this.load()
      },
      onLinkRequest: (request) => {
        this.setData({ linkRequest: request })
        wx.showModal({
          title: '设备登录请求',
          content: `有新设备想登录当前账号。\n\n验证码：${request.code}\n\n如果不是你本人操作，请忽略。`,
          showCancel: false
        })
      },
      onLinkRelease: () => this.setData({ linkRequest: null }),
      onError: (message) => this.setData({ commandReply: message, commandReplyOk: false })
    })
  },

  createCommandSession() {
    this.commandSession = libraryCommand.createSession({
      onQueueChanged: (queue) => {
        this.setData({ commandQueue: queue })
        this.refreshCommandStatus({ commandQueue: queue })
      },
      onReply: (text, ok) => {
        this.setData({ commandReply: text, commandReplyOk: ok })
        this.refreshCommandStatus({ commandReply: text, commandReplyOk: ok })
      },
      onConfirm: (id, text) => {
        this.commandSession.confirm(id)
      },
      onUpdate: () => this.load(),
      onState: (state) => {
        this.setData({ commandState: state })
      },
      onError: (message) => {
        this.setData({ commandReply: message, commandReplyOk: false })
        this.refreshCommandStatus({ commandReply: message, commandReplyOk: false })
      }
    })
  },

  refreshCommandStatus(overrides) {
    const state = Object.assign({}, this.data, overrides || {}, {
      transcriptText: this.commandTranscript ? this.commandTranscript.bestText() : ''
    })
    const status = holdToTalk.commandStatus(state)
    this.setData({
      commandStatusText: status.text,
      commandStatusOk: status.ok
    })
  },

  updateRecordStatus(stem, status) {
    const records = this.data.records.map((rec) => {
      if (rec.stem !== stem) return rec
      const next = Object.assign({}, rec)
      if (status === 'ready') next.hasArticles = true
      else if (status === 'empty') next.isEmpty = true
      else next.phase = status
      next.statusLabel = recordingUtil.statusLabel(next)
      return next
    })
    this.setData({ records })
  },

  selectedTagFor(records) {
    const pending = app.globalData.pendingRecordTag || ''
    if (pending) return pending
    const selected = this.data.selectedTag || ''
    if (!selected) return ''
    const tags = recordingUtil.tagsFromRecords(records || this.data.allRecords)
    return tags.includes(selected) ? selected : ''
  },

  homeTabsFor(homeTags) {
    return [
      { key: 'recordings', label: '我的录音' },
      { key: 'community', label: 'VD社区' }
    ].concat((homeTags || []).map((tag) => ({ key: `tag:${tag}`, label: tag, tag })))
  },

  selectTag(event) {
    const tag = event.currentTarget.dataset.tag || ''
    app.globalData.pendingRecordTag = tag
    const currentHomeTab = tag ? `tag:${tag}` : 'recordings'
    this.setData({
      currentHomeTab,
      activeTab: 'recordings',
      selectedTag: tag,
      selectedTagMissing: Boolean(tag && !this.data.homeTags.includes(tag)),
      records: recordingUtil.filterByTag(this.data.allRecords, tag)
    })
    if (this.commandSession) this.commandSession.setRefs(this.currentCommandRefs())
  },

  // Assign command reference numbers to records with articles or silent (like Android's commandRefNumberFor)
  assignCommandRefs(records) {
    let ref = 0
    // Include recordings with articles AND silent recordings
    const visible = (records || [])
      .filter((rec) => !rec.uploading && (rec.hasArticles || rec.isEmpty))
      .slice(0, 20)
    const refMap = {}
    visible.forEach((rec) => {
      ref++
      refMap[rec.stem] = ref
    })
    return (records || []).map((rec) => {
      const next = Object.assign({}, rec)
      next._commandRef = refMap[rec.stem] || 0
      return next
    })
  },

  currentCommandRefs(records) {
    const visible = records || recordingUtil.filterByTag(this.data.allRecords, this.data.selectedTag)
    // Include recordings with articles AND silent recordings
    return visible
      .filter((rec) => rec.hasArticles || rec.isEmpty)
      .slice(0, 20)
      .map((rec, index) => ({ n: index + 1, stem: rec.stem, title: rec.rowTitle }))
  },

  onCommandInput(event) {
    this.setData({ commandText: event.detail.value })
  },

  submitCommand() {
    if (!this.commandSession || !this.data.commandText.trim()) return
    this.commandSession.enqueue(this.data.commandText, this.currentCommandRefs())
    this.setData({ commandText: '' })
  },

  requestAudioConsent() {
    return audioConsentFlow.request(this)
  },

  onAudioConsentAgree() {
    audioConsentFlow.agree(this)
  },

  onAudioConsentDecline() {
    audioConsentFlow.decline(this)
  },

  onAudioConsentViewAgreement() {
    audioConsentFlow.decline(this)
    wx.navigateTo({ url: '/pages/audio-consent/index' })
  },

  async startRecord() {
    if (!await this.requestAudioConsent()) return
    if (this.data.selectedTag) app.globalData.pendingRecordTag = this.data.selectedTag
    wx.navigateTo({ url: '/pages/record/index' })
  },

  stopRecord() {
    audio.stop()
  },

  // MARK: - FAB tap/longpress
  CANCEL_DISTANCE_PX: 60,
  LONG_PRESS_MS: 350,

  onMicTouchStart(event) {
    this._micStartY = event.touches[0].pageY
    this._micMovedToCancel = false
    this._micTouchStartedAt = Date.now()
    this._micLongPressActive = false
    this._micTouchEndedBeforeCommandStart = false
    this._clearMicLongPressTimer()
    this._micLongPressTimer = setTimeout(() => {
      this._micLongPressActive = true
      this._startLibraryCommandTalk()
    }, this.LONG_PRESS_MS)
  },

  onMicTouchMove(event) {
    if (!this.data.commandTalking) return
    const shouldCancel = holdToTalk.shouldCancel(this._micStartY, event.touches[0].pageY, this.CANCEL_DISTANCE_PX)
    if (shouldCancel !== this._micMovedToCancel) {
      this._micMovedToCancel = shouldCancel
      this.setData({ commandCanceled: shouldCancel })
      this.refreshCommandStatus({ commandCanceled: shouldCancel })
      this._updateDockHint()
    }
  },

  onMicTouchEnd() {
    this._clearMicLongPressTimer()
    if (this._micLongPressActive || this.data.commandTalking || this._pendingCommandTalkStart) {
      this._lastCommandTouchEndAt = Date.now()
      if (this.data.commandTalking) this._finishLibraryCommandTalk(this._micMovedToCancel)
      else this._micTouchEndedBeforeCommandStart = true
      this._micLongPressActive = false
      return
    }
    this.startRecord()
  },

  onMicTouchCancel() {
    this._clearMicLongPressTimer()
    if (this.data.commandTalking) this._finishLibraryCommandTalk(true)
    else if (this._pendingCommandTalkStart) this._micTouchEndedBeforeCommandStart = true
    this._micLongPressActive = false
  },

  _clearMicLongPressTimer() {
    if (!this._micLongPressTimer) return
    clearTimeout(this._micLongPressTimer)
    this._micLongPressTimer = null
  },

  _updateDockHint() {
    if (this.data.commandTalking) {
      const hint = this.data.commandCanceled ? '上滑取消 · 松开放弃' : '松开发送 · 上滑取消'
      this.setData({ dockHint: hint })
    } else {
      this.setData({ dockHint: '轻点录音 · 长按说话' })
    }
  },

  async _startLibraryCommandTalk() {
    if (this.data.commandTalking || this._pendingCommandTalkStart) return
    this._pendingCommandTalkStart = true

    if (!await this.requestAudioConsent()) {
      this._pendingCommandTalkStart = false
      return
    }
    if (this._micTouchEndedBeforeCommandStart) {
      this._pendingCommandTalkStart = false
      return
    }

    this._beginAsrSession()
  },

  _beginAsrSession() {
    this._pendingCommandTalkStart = false
    const sessionId = (this._asrSessionId || 0) + 1
    this._asrSessionId = sessionId
    this._activeAsrSessionId = sessionId
    this.commandTranscript = holdToTalk.createTranscript()
    const transcript = this.commandTranscript
    this.setData({
      commandTalking: true,
      commandCanceled: false,
      commandReply: '在听…',
      commandReplyOk: true
    })
    this.refreshCommandStatus({
      commandTalking: true,
      commandCanceled: false,
      commandReply: '在听…',
      commandReplyOk: true
    })
    this._updateDockHint()
    if (this.commandSession) {
      this.commandSession.setRefs(this.currentCommandRefs())
      this.commandSession.connect()
    }

    // Create ASR dictation session
    this.asrSession = asrDictation.createSession({
      onText: (text, isFinal) => {
        if (this._activeAsrSessionId !== sessionId || !transcript) return
        transcript.accept(text, isFinal)
        if (!this.data.commandTalking) return
        this.setData({
          commandReply: transcript.bubbleText(),
          commandReplyOk: true
        })
        this.refreshCommandStatus({
          commandReply: transcript.bubbleText(),
          commandReplyOk: true
        })
      },
      onState: (state) => {
        if (this._activeAsrSessionId !== sessionId) return
        if (!this.data.commandTalking) return
        if (transcript.bestText()) return
        this.setData({ commandReply: state, commandReplyOk: true })
        this.refreshCommandStatus({ commandReply: state, commandReplyOk: true })
      },
      onError: (message) => {
        if (this._activeAsrSessionId !== sessionId) return
        if (!this.data.commandTalking) return
        this.setData({ commandReply: message, commandReplyOk: false })
        this.refreshCommandStatus({ commandReply: message, commandReplyOk: false })
      }
    })
    this.asrSession.connect()

    // Start ASR recorder with frame callback for real-time streaming
    this._asrMode = true // synchronous flag to prevent upload in bindRecorder's onStop
    this._skipRecorderStopCount = (this._skipRecorderStopCount || 0) + 1
    app.globalData.activeRecorderSession = { type: 'asr', id: sessionId }
    const recorder = wx.getRecorderManager()
    this.asrRecorder = recorder

    recorder.onFrameRecorded((res) => {
      if (!this.data.commandTalking || this.data.commandCanceled) return
      // Send PCM frame to ASR server
      this.asrSession.sendAudio(res.frameBuffer, false)
    })

    recorder.onError(() => {
      if (this.data.commandTalking) {
        this.setData({ commandReply: '录音失败', commandReplyOk: false })
      }
    })

    // Start recording in PCM format for ASR streaming
    recorder.start({
      duration: 60 * 60 * 1000,
      sampleRate: 16000,
      numberOfChannels: 1,
      format: 'PCM',
      frameSize: 3 // ~120ms per frame at 16kHz 16bit mono
    })
  },

  async _finishLibraryCommandTalk(cancel) {
    if (!this.data.commandTalking || this._finishingTalk) return
    this._finishingTalk = true

    // Stop ASR recorder
    if (this.asrRecorder) {
      this.asrRecorder.stop()
      this.asrRecorder = null
    }

    // Send final frame to ASR
    if (this.asrSession && !cancel) {
      this.asrSession.finish()
    }

    let text = ''
    if (!cancel && this.commandTranscript) {
      this.setData({ commandReply: this.commandTranscript.bubbleText(), commandReplyOk: true })
      this.refreshCommandStatus({
        commandReply: this.commandTranscript.bubbleText(),
        commandReplyOk: true
      })
      text = await this.commandTranscript.waitForBestText(3000)
    }

    if (this.asrSession) {
      this.asrSession.close()
      this.asrSession = null
    }

    this.setData({ commandTalking: false })
    this.refreshCommandStatus({ commandTalking: false })

    if (cancel) {
      this.setData({ commandReply: '', commandReplyOk: true, commandCanceled: false })
      this.refreshCommandStatus({ commandReply: '', commandReplyOk: true, commandCanceled: false })
    } else if (text) {
      // Enqueue the recognized text as a library command
      if (this.commandSession) {
        this.commandSession.enqueue(text, this.currentCommandRefs())
      }
      this.setData({ commandReply: text, commandReplyOk: true })
      this.refreshCommandStatus({ commandReply: text, commandReplyOk: true })
    }

    this._updateDockHint()
    this.commandTranscript = null
    this._activeAsrSessionId = null
    this._finishingTalk = false
  },

  openDetail(event) {
    const index = Number(event.currentTarget.dataset.index)
    const rec = this.data.records[index]
    // Like Android: show status toast for recordings without articles
    if (!rec.hasArticles) {
      wx.showToast({ title: rec.statusLabel || '待处理', icon: 'none' })
      return
    }
    app.globalData.currentRecording = rec
    wx.navigateTo({ url: `/pages/detail/index?stem=${encodeURIComponent(rec.stem)}` })
  },

  openPost(event) {
    const index = Number(event.currentTarget.dataset.index)
    const post = this.data.communityPosts[index]
    app.globalData.currentCommunityPost = post
    wx.navigateTo({ url: `/pages/community-detail/index?shareId=${encodeURIComponent(post.shareId)}` })
  },

  // MARK: - Swipe to delete (like Android)
  DELETE_WIDTH_PX: 80,

  onScreenTouchStart() {
    this.closeAllSwipeRows()
  },

  onRowTouchStart(event) {
    this.closeOtherSwipeRows(event.currentTarget.dataset.index)
    this._swipeStartX = event.touches[0].pageX
    this._swipeStartY = event.touches[0].pageY
    this._swiping = false
  },

  onRowTouchMove(event) {
    const dx = event.touches[0].pageX - this._swipeStartX
    const dy = event.touches[0].pageY - this._swipeStartY
    // Detect horizontal swipe (ignore vertical scroll)
    if (!this._swiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      this._swiping = true
    }
    if (this._swiping && dx < 0) {
      const index = event.currentTarget.dataset.index
      const maxSwipe = -this.DELETE_WIDTH_PX
      const translateX = Math.max(maxSwipe, dx / 3)
      this._setRowTranslateX(index, translateX)
    }
  },

  onRowTouchEnd(event) {
    if (!this._swiping) return
    const index = event.currentTarget.dataset.index
    const records = this.data.records.slice()
    const currentX = records[index]._translateX || 0
    const halfOpen = -this.DELETE_WIDTH_PX / 2
    // Snap open or closed
    const targetX = currentX < halfOpen ? -this.DELETE_WIDTH_PX : 0
    this._setRowTranslateX(index, targetX)
    this._swiping = false
  },

  _setRowTranslateX(index, translateX) {
    const records = this.data.records.slice()
    if (records[index]) {
      records[index]._translateX = translateX
      this.setData({ records })
    }
  },

  closeOtherSwipeRows(skipIndex) {
    const records = this.data.records
    let changed = false
    for (let i = 0; i < records.length; i++) {
      if (i === skipIndex) continue
      if (records[i]._translateX && records[i]._translateX < 0) {
        records[i]._translateX = 0
        changed = true
      }
    }
    if (changed) this.setData({ records })
  },

  closeAllSwipeRows() {
    const records = this.data.records.slice()
    let changed = false
    for (let i = 0; i < records.length; i++) {
      if (records[i]._translateX && records[i]._translateX < 0) {
        records[i]._translateX = 0
        changed = true
      }
    }
    if (changed) this.setData({ records })
  },

  confirmDelete(event) {
    const index = Number(event.currentTarget.dataset.index)
    const rec = this.data.records[index]
    // Close swipe row first
    this._setRowTranslateX(index, 0)
    // Show confirmation dialog (same text as Android)
    wx.showModal({
      title: '删除这条录音？',
      content: '音频和已挖出的文章都会从云端删除，不可恢复。',
      confirmText: '删除',
      cancelText: '取消',
      confirmColor: '#e9332c',
      success: (res) => {
        if (res.confirm) this.deleteRecording(rec)
      }
    })
  },

  async deleteRecording(rec) {
    wx.showLoading({ title: '删除中' })
    try {
      const library = require('../../services/library')
      const ok = await library.deleteRecording(rec)
      wx.hideLoading()
      if (ok) {
        wx.showToast({ title: '已删除' })
        await this.load()
      } else {
        wx.showToast({ title: '删除失败', icon: 'error' })
      }
    } catch (error) {
      wx.hideLoading()
      wx.showToast({ title: '删除失败', icon: 'error' })
    }
  }
})
