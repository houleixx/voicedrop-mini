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
const recordPermission = require('../../utils/record-permission')

const app = getApp()

function isDevtoolsRuntime(systemInfo, deviceInfo) {
  return [systemInfo, deviceInfo].some((info) => Object.values(info || {}).some((value) => /devtools|wechatdevtools|微信开发者工具/i.test(String(value || ''))))
}

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
    commandStatusKind: '',
    commandStatusOk: true,
    commandTalking: false,
    commandCanceled: false,
    dockHint: '轻点录音 · 长按说话',
    linkRequest: null,
    communityLoading: false,
    communityPosts: [],
    communityLeftPosts: [],
    communityRightPosts: [],
    communityFeedTab: 'recommended',
    communityError: '',
    communityLoaded: false,
    refreshing: false,
    audioConsentVisible: false,
    communityFeedDevtools: false,
    scrollContentTop: 0,
    communityScrollContentTop: 0
  },

  onLoad(options) {
    this.initialLoadStarted = true
    this.topLevelUiRendered = false
    const activeTab = this.initialTab(options)
    this.setData({ activeTab, currentHomeTab: activeTab })
    try {
      const info = wx.getSystemInfoSync()
      let deviceInfo = {}
      try { deviceInfo = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : {} } catch (_) {}
      const statusBarPx = info.statusBarHeight
      const topRpx = 200
      const pxPerRpx = info.windowWidth / 750
      const scrollContentTop = statusBarPx + topRpx * pxPerRpx
      this.setData({
        communityFeedDevtools: isDevtoolsRuntime(info, deviceInfo),
        scrollContentTop,
        communityScrollContentTop: scrollContentTop + 88 * pxPerRpx
      })
    } catch (_) {
      const pxPerRpx = (wx.getSystemInfoSync?.().windowWidth || 375) / 750
      const scrollContentTop = 200 * pxPerRpx + 20
      this.setData({ scrollContentTop, communityScrollContentTop: scrollContentTop + 88 * pxPerRpx })
    }
    this.bindRecorder()
    this.createStatusSession()
    this.createCommandSession()
    this.load()
    if (this.data.activeTab === 'community') {
      const restored = this.restoreCachedCommunityFeed()
      this.loadCommunity(restored ? { silent: true, keepDataOnError: true } : undefined)
    }
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
    this._communityLoadGeneration = (this._communityLoadGeneration || 0) + 1
    this.recordCoverLoadId = (this.recordCoverLoadId || 0) + 1
    this.recordMetaLoadId = (this.recordMetaLoadId || 0) + 1
    if (this.statusSession) this.statusSession.close()
    if (this.commandSession) this.commandSession.close()
    if (this.asrSession) this.asrSession.close()
    if (this.asrRecorder) this.asrRecorder.stop()
  },

  onPullDownRefresh() {
    this.refreshFromUser().finally(() => wx.stopPullDownRefresh())
  },

  onRefresherRefresh() {
    return this.refreshFromUser()
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
    if (this.data.activeTab === 'community') {
      const restored = this.data.communityLoaded || this.restoreCachedCommunityFeed()
      this.loadCommunity(restored ? { silent: true, keepDataOnError: true } : undefined)
    }
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
        records: this.commandRecordsFor(this.data.allRecords, tag)
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
      records: activeTab === 'recordings' ? this.commandRecordsFor(this.data.allRecords, '') : this.data.records
    })
    if (activeTab === 'community') {
      const restored = this.data.communityLoaded || this.restoreCachedCommunityFeed()
      this.loadCommunity(restored ? { silent: true, keepDataOnError: true } : undefined)
    }
    if (this.commandSession) this.commandSession.setRefs(this.currentCommandRefs())
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/index' })
  },

  refreshCurrent(options) {
    if (this.data.activeTab === 'community') return this.loadCommunity(options)
    return this.load(options)
  },

  refreshFromUser() {
    if (this._refreshPromise) return this._refreshPromise
    this.setData({ refreshing: true })
    this._refreshPromise = Promise.resolve(this.refreshCurrent({ silent: true, keepDataOnError: true }))
      .then((ok) => {
        if (ok === false) wx.showToast({ title: '加载失败', icon: 'error' })
        return ok
      })
      .catch(() => {
        wx.showToast({ title: '加载失败', icon: 'error' })
        return false
      })
      .finally(() => {
        this._refreshPromise = null
        this.setData({ refreshing: false })
      })
    return this._refreshPromise
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
      const recordsWithRefs = this.preserveRecordingCovers(this.assignCommandRefs(records))
      const filteredRecords = this.commandRecordsFor(recordsWithRefs, selectedTag)
      const recordCoverLoadId = (this.recordCoverLoadId || 0) + 1
      this.recordCoverLoadId = recordCoverLoadId
      const recordMetaLoadId = (this.recordMetaLoadId || 0) + 1
      this.recordMetaLoadId = recordMetaLoadId
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
        records: filteredRecords,
        error: ''
      })
      this.loadRecordingCovers(recordsWithRefs, recordCoverLoadId)
      this.enrichRecordingMeta(records, recordMetaLoadId)
      this.publishPendingReplies(records)
      if (this.commandSession) this.commandSession.setRefs(this.currentCommandRefs())
      return true
    } catch (error) {
      if (!keepDataOnError || !this.data.records.length) {
        this.setData({ error: this.loadErrorMessage(error) })
      }
      return false
    } finally {
      this.topLevelUiRendered = true
      if (!silent) this.setData({ loading: false })
    }
  },

  async enrichRecordingMeta(records, loadId) {
    if (!library.enrichArticleMeta) return
    try {
      await library.enrichArticleMeta(records)
      if (loadId !== this.recordMetaLoadId) return
      const selectedTag = this.selectedTagFor(records)
      const homeTags = recordingUtil.tagsFromRecords(records)
      const homeTabs = this.homeTabsFor(homeTags)
      const recordsWithRefs = this.preserveRecordingCovers(this.assignCommandRefs(records))
      const filteredRecords = this.commandRecordsFor(recordsWithRefs, selectedTag)
      const currentHomeTab = this.data.activeTab === 'community'
        ? 'community'
        : (selectedTag ? `tag:${selectedTag}` : 'recordings')
      const recordCoverLoadId = (this.recordCoverLoadId || 0) + 1
      this.recordCoverLoadId = recordCoverLoadId
      this.setData({
        allRecords: recordsWithRefs,
        homeTags,
        homeTabs,
        selectedTag,
        selectedTagMissing: Boolean(selectedTag && !homeTags.includes(selectedTag)),
        currentHomeTab,
        records: filteredRecords
      })
      this.loadRecordingCovers(recordsWithRefs, recordCoverLoadId)
      if (this.commandSession) this.commandSession.setRefs(this.currentCommandRefs())
    } catch (_) {
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

  async loadRecordingCovers(records, loadId) {
    const candidates = (records || []).filter((rec) => rec && rec.coverPhotoKey && !rec.coverPhotoUrl)
    if (!candidates.length) return
    let scope = ''
    try {
      scope = await library.ownerScope()
    } catch (_) {
      return
    }
    if (!scope || loadId !== this.recordCoverLoadId) return
    await Promise.all(candidates.map(async (rec) => {
      try {
        const coverPhotoUrl = await library.downloadPhotoTemp(rec.coverPhotoKey, scope)
        if (!coverPhotoUrl || loadId !== this.recordCoverLoadId) return
        this.updateRecordingCover(rec.stem, coverPhotoUrl)
      } catch (_) {
      }
    }))
  },

  preserveRecordingCovers(records) {
    const current = new Map((this.data.allRecords || []).map((rec) => [rec.stem, rec]))
    return (records || []).map((rec) => {
      const cached = current.get(rec.stem)
      if (!cached || !cached.coverPhotoUrl || cached.coverPhotoKey !== rec.coverPhotoKey) return rec
      return Object.assign({}, rec, { coverPhotoUrl: cached.coverPhotoUrl })
    })
  },

  updateRecordingCover(stem, coverPhotoUrl) {
    const update = (records) => (records || []).map((rec) => rec.stem === stem
      ? Object.assign({}, rec, { coverPhotoUrl: coverPhotoUrl || '' })
      : rec)
    this.setData({
      allRecords: update(this.data.allRecords),
      records: update(this.data.records)
    })
  },

  onRecordCoverError(event) {
    const stem = event.currentTarget.dataset.stem || ''
    if (stem) this.updateRecordingCover(stem, '')
  },

  restoreCachedCommunityFeed() {
    const loaded = community.cachedFeed && community.cachedFeed()
    if (!loaded || !loaded.latest || !loaded.latest.length) return false
    const feed = community.filterFeed(loaded,
      (post) => !blockStore.isBlocked(post.author || post.authorName || ''))
    this._communityFeed = feed
    if (feed.liked && feed.liked.length) prefs.setLikedCommunityPosts(new Set(feed.liked))
    const postData = this.communityPostData(feed, this.data.communityFeedTab)
    this.setData({
      ...postData,
      communityLoaded: true,
      communityLoading: false,
      communityError: ''
    })
    return true
  },

  loadCommunity(options) {
    if (this._communityLoadPromise) return this._communityLoadPromise
    const generation = (this._communityLoadGeneration || 0) + 1
    this._communityLoadGeneration = generation
    const task = this.fetchCommunity(options, generation)
    this._communityLoadPromise = task
    return task.finally(() => {
      if (this._communityLoadPromise === task) this._communityLoadPromise = null
    })
  },

  async fetchCommunity(options, generation) {
    const silent = Boolean(options && options.silent)
    const keepDataOnError = Boolean(options && options.keepDataOnError)
    if (!silent) this.setData({ communityLoading: true, communityError: '' })
    try {
      const loaded = await community.loadFeed()
      const feed = community.filterFeed(loaded,
        (post) => !blockStore.isBlocked(post.author || post.authorName || ''))
      if (generation !== this._communityLoadGeneration) return false
      this._communityFeed = feed
      if (feed.liked && feed.liked.length) prefs.setLikedCommunityPosts(new Set(feed.liked))
      const postData = this.communityPostData(feed, this.data.communityFeedTab)
      this.setData({
        ...postData,
        communityLoaded: true,
        communityError: ''
      })
      return true
    } catch (error) {
      if (generation !== this._communityLoadGeneration) return false
      if (!keepDataOnError || !this.data.communityPosts.length) {
        this.setData({ communityError: this.loadErrorMessage(error) })
      }
      return false
    } finally {
      if (!silent && generation === this._communityLoadGeneration) this.setData({ communityLoading: false })
    }
  },

  selectCommunityFeed(event) {
    const tab = event.currentTarget.dataset.feedTab
    if (!['recommended', 'latest', 'replies'].includes(tab) || tab === this.data.communityFeedTab) return
    const postData = this.communityPostData(this._communityFeed, tab)
    this.setData({
      communityFeedTab: tab,
      ...postData
    })
  },

  communityPostData(feed, tab) {
    const communityPosts = community.cardPosts(feed, tab)
    const columns = community.masonryColumns(communityPosts, this._communityCoverAspects)
    return {
      communityPosts,
      communityLeftPosts: columns.left,
      communityRightPosts: columns.right
    }
  },

  onCommunityCoverLoad(event) {
    const key = event.currentTarget.dataset.coverKey
    const width = Number(event.detail && event.detail.width)
    const height = Number(event.detail && event.detail.height)
    if (!key || !width || !height) return
    const aspect = width / height
    this._communityCoverAspects = this._communityCoverAspects || {}
    if (Math.abs((this._communityCoverAspects[key] || 0) - aspect) < 0.01) return
    this._communityCoverAspects[key] = aspect
    const columns = community.masonryColumns(this.data.communityPosts, this._communityCoverAspects)
    this.setData({ communityLeftPosts: columns.left, communityRightPosts: columns.right })
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
      onLinkRelease: () => this.setData({ linkRequest: null })
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
        this.confirmLibraryCommand(id, text)
      },
      onUpdate: () => {
        if (library.invalidateArticleCaches) library.invalidateArticleCaches()
        this.load({ silent: true, keepDataOnError: true })
      },
      onState: (state) => {
        this.setData({ commandState: state })
      },
      onError: (message) => {
        this.setData({ commandReply: message, commandReplyOk: false })
        this.refreshCommandStatus({ commandReply: message, commandReplyOk: false })
      }
    })
  },

  confirmLibraryCommand(id, text) {
    if (!id) return
    const queue = this._libraryCommandConfirms || (this._libraryCommandConfirms = [])
    if ((this._activeLibraryCommandConfirm && this._activeLibraryCommandConfirm.id === id) ||
        queue.some((item) => item.id === id)) return
    queue.push({ id, text })
    this.showNextLibraryCommandConfirm()
  },

  showNextLibraryCommandConfirm() {
    if (this._activeLibraryCommandConfirm) return
    const queue = this._libraryCommandConfirms || []
    if (!queue.length) return
    const item = queue.shift()
    this._activeLibraryCommandConfirm = item
    wx.showModal({
      title: '确认操作',
      content: item.text || '确认执行这条指令？',
      confirmText: '删除',
      cancelText: '取消',
      confirmColor: '#d8593b',
      success: (result) => {
        if (!this.commandSession) return
        if (result.confirm) this.commandSession.confirm(item.id)
        else if (result.cancel) this.commandSession.cancel(item.id)
      },
      complete: () => {
        if (this._activeLibraryCommandConfirm === item) this._activeLibraryCommandConfirm = null
        this.showNextLibraryCommandConfirm()
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
      commandStatusKind: status.kind,
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
      records: this.commandRecordsFor(this.data.allRecords, tag)
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

  commandRecordsFor(records, tag) {
    return this.assignCommandRefs(recordingUtil.filterByTag(records || [], tag || ''))
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
    if (!await recordPermission.ensure(wx)) return
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
    if (!await recordPermission.ensure(wx)) {
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
      // The Mini Program runtime can corrupt one of several same-host
      // WebSockets when status + command + binary ASR overlap. Keep the
      // command queue persisted, close its idle socket while listening, then
      // let enqueue reconnect it after ASR has closed.
      this.commandSession.close()
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

    // RecorderManager.stop() is asynchronous. Wait for onStop so its buffered
    // tail PCM reaches onFrameRecorded before sending the ASR final packet.
    const recorder = this.asrRecorder
    this.asrRecorder = null
    if (recorder) {
      if (cancel) recorder.stop()
      else await holdToTalk.stopRecorderAndWait(recorder, 500)
    }

    let text = ''
    if (!cancel && this.commandTranscript) {
      this.setData({ commandReply: this.commandTranscript.bubbleText(), commandReplyOk: true })
      this.refreshCommandStatus({
        commandReply: this.commandTranscript.bubbleText(),
        commandReplyOk: true
      })
      // Register before finish: an existing partial transcript must not make us
      // close early; wait for the new final response caused by this final packet.
      const finalText = this.commandTranscript.waitForFinalText(1500)
      if (this.asrSession) this.asrSession.finish()
      text = await finalText
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
    const shareId = event.currentTarget.dataset.shareId
    const index = Number(event.currentTarget.dataset.index)
    const post = shareId
      ? this.data.communityPosts.find((item) => item.shareId === shareId)
      : this.data.communityPosts[index]
    if (!post) return
    if (this._longPressedCommunityPost === post.shareId) {
      this._longPressedCommunityPost = ''
      return
    }
    app.globalData.currentCommunityPost = post
    wx.navigateTo({ url: `/pages/community-detail/index?shareId=${encodeURIComponent(post.shareId)}` })
  },

  confirmCommunityUnshare(event) {
    const shareId = event.currentTarget.dataset.shareId
    const index = Number(event.currentTarget.dataset.index)
    const post = shareId
      ? this.data.communityPosts.find((item) => item.shareId === shareId)
      : this.data.communityPosts[index]
    if (!post || !post.mine) return
    this._longPressedCommunityPost = post.shareId
    wx.showModal({
      title: '从 VD社区隐藏？',
      content: '原文章不受影响，之后仍可再次分享。',
      confirmText: '取消分享',
      confirmColor: '#d8593b',
      success: async (result) => {
        if (!result.confirm) return
        const ok = await community.unshare(post.shareId).catch(() => false)
        if (!ok) {
          wx.showToast({ title: '取消分享失败', icon: 'error' })
          return
        }
        await this.loadCommunity({ silent: true, keepDataOnError: true })
      }
    })
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
      if (ok) {
        this.removeRecordingLocally(rec)
        wx.showToast({ title: '已删除' })
      } else {
        wx.showToast({ title: '删除失败', icon: 'error' })
      }
    } catch (error) {
      wx.showToast({ title: '删除失败', icon: 'error' })
    } finally {
      wx.hideLoading()
    }
  },

  removeRecordingLocally(rec) {
    const remaining = this.data.allRecords.filter((item) => item.stem !== rec.stem)
    const allRecords = this.assignCommandRefs(remaining)
    const homeTags = recordingUtil.tagsFromRecords(allRecords)
    const selectedTag = this.selectedTagFor(allRecords)
    const records = this.commandRecordsFor(allRecords, selectedTag)
    const currentHomeTab = selectedTag ? `tag:${selectedTag}` : 'recordings'
    this.setData({
      allRecords,
      records,
      homeTags,
      homeTabs: this.homeTabsFor(homeTags),
      selectedTag,
      selectedTagMissing: false,
      currentHomeTab,
      error: ''
    })
    if (this.commandSession) this.commandSession.setRefs(this.currentCommandRefs(records))
  }
})

module.exports = { isDevtoolsRuntime }
