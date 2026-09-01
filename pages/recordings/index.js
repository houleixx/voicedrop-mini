const library = require('../../services/library')
const auth = require('../../services/auth')
const accountState = require('../../services/account-state')
const audio = require('../../services/audio')
const recordingUploads = require('../../services/recording-upload-queue')
const photoMarkerRepair = require('../../services/photo-marker-repair')
const statusSession = require('../../services/status-session')
const deviceLinkApproval = require('../../services/device-link-approval')
const libraryCommand = require('../../services/library-command')
const asrDictation = require('../../services/asr-dictation')
const community = require('../../services/community')
const books = require('../../services/books')
const bookCoverCache = require('../../services/book-cover-cache')
const blockStore = require('../../utils/block-store')
const pendingReplies = require('../../utils/pending-replies')
const prefs = require('../../utils/prefs')
const recordingQuality = require('../../utils/recording-quality')
const recordingUtil = require('../../utils/recording')
const resumeRefresh = require('../../utils/resume-refresh')
const holdToTalk = require('../../utils/hold-to-talk')
const audioConsentFlow = require('../../utils/audio-consent-flow')
const recordPermission = require('../../utils/record-permission')
const i18n = require('../../utils/i18n')

const app = getApp()
const MIN_BOOK_REFRESH_FEEDBACK_MS = 600

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function layoutOffsets(headerBottom, windowWidth) {
  const pxPerRpx = Math.max(1, Number(windowWidth) || 375) / 750
  const scrollContentTop = Math.max(0, Number(headerBottom) || 0)
  return {
    scrollContentTop,
    communityScrollContentTop: scrollContentTop + 88 * pxPerRpx
  }
}

function bookRowsFor(items) {
  const cells = [{ key: 'write', kind: 'write' }].concat((items || []).map((book) => Object.assign({
    key: `book:${book.slug}`,
    kind: 'book'
  }, book)))
  const rows = []
  for (let index = 0; index < cells.length; index += 2) rows.push(cells.slice(index, index + 2))
  return rows
}

Page({
  data: {
    activeTab: 'recordings',
    currentHomeTab: 'recordings',
    homeTabs: [
      { key: 'recordings', label: '我的录音' },
      { key: 'community', label: 'VD社区' },
      { key: 'books', label: '写书' }
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
    dockHint: i18n.ui('轻点录音 · 长按说话'),
    linkRequest: null,
    communityLoading: false,
    communityPosts: [],
    communityLeftPosts: [],
    communityRightPosts: [],
    communityFeedTab: 'latest',
    communitySearching: false,
    communitySearchQuery: '',
    communityError: '',
    communityLoaded: false,
    bookItems: [],
    bookRows: bookRowsFor([]),
    booksLoading: false,
    booksError: '',
    booksLoaded: false,
    refreshing: false,
    audioConsentVisible: false,
    scrollTop: 0,
    scrollContentTop: 0,
    communityScrollContentTop: 0
  },

  onLoad(options) {
    this.initialLoadStarted = true
    this._awaitingInitialShow = true
    this.topLevelUiRendered = false
    this._pageUnloaded = false
    const activeTab = this.initialTab(options)
    this._scrollPositions = { recordings: 0, community: 0, books: 0 }
    this._refreshPromises = Object.create(null)
    this._refreshingTabs = Object.create(null)
    this.setData({ activeTab, currentHomeTab: activeTab })
    try {
      const info = wx.getSystemInfoSync()
      const pxPerRpx = info.windowWidth / 750
      const fallbackHeaderBottom = Number(info.statusBarHeight || 0) + 200 * pxPerRpx
      this.setData(layoutOffsets(fallbackHeaderBottom, info.windowWidth))
    } catch (_) {
      const pxPerRpx = (wx.getSystemInfoSync?.().windowWidth || 375) / 750
      this.setData(layoutOffsets(200 * pxPerRpx + 20, wx.getSystemInfoSync?.().windowWidth))
    }
    this.bindRecorder()
    this._socketBearer = auth.bearer()
    this.createStatusSession()
    this.deviceLinkApproval = this.createDeviceLinkApproval()
    this.createCommandSession()
    const restored = this.restoreCachedRecordings()
    this.load(restored ? { silent: true, keepDataOnError: true } : undefined)
    this.drainPendingRecordingUploads()
    if (this.data.activeTab === 'community') {
      const restored = this.restoreCachedCommunityFeed()
      this.loadCommunity(restored ? { silent: true, keepDataOnError: true } : undefined)
    }
    if (this.data.activeTab === 'books') {
      const restored = this.restoreCachedBooks()
      this.loadBooks(restored ? { silent: true, keepDataOnError: true } : undefined)
    }
  },

  onReady() {
    this.measureHomeTabsBottom()
  },

  onResize() {
    this.measureHomeTabsBottom()
  },

  onLanguageChanged() {
    this._updateDockHint()
  },

  measureHomeTabsBottom() {
    if (typeof wx.createSelectorQuery !== 'function') return
    const measure = () => {
      if (this._pageUnloaded) return
      wx.createSelectorQuery()
        .select('#home-tabs')
        .boundingClientRect((rect) => {
          if (!rect || !Number.isFinite(rect.bottom) || rect.bottom <= 0) return
          const width = wx.getWindowInfo?.().windowWidth || wx.getSystemInfoSync?.().windowWidth || 375
          const offsets = layoutOffsets(rect.bottom, width)
          if (Math.abs(offsets.scrollContentTop - this.data.scrollContentTop) < 0.5) return
          this.setData(offsets)
        })
        .exec()
    }
    if (typeof wx.nextTick === 'function') wx.nextTick(measure)
    else setTimeout(measure, 0)
  },

  onShow() {
    this.showPendingRecordingUploads()
    this.drainPendingRecordingUploads()
    this.resetAccountSessionsIfNeeded()
    if (this.statusSession) this.statusSession.connect()
    if (this.deviceLinkApproval) this.deviceLinkApproval.recover()
    if (this.commandSession) {
      this.commandSession.setRefs(this.currentCommandRefs())
      this.commandSession.connect()
    }
    this.applyPendingHomeTab()
    if (this._awaitingInitialShow) {
      this._awaitingInitialShow = false
      return
    }
    if (this.initialLoadStarted && !this.topLevelUiRendered) return
    if (!this.initialLoadStarted) {
      this.load()
      if (this.data.activeTab === 'community') this.loadCommunity()
      return
    }
    if (this.data.activeTab === 'community') {
      const hasModeration = Boolean(app.globalData.communityModeration)
      const communityDirty = Boolean(app.globalData.communityFeedDirty)
      if (hasModeration || communityDirty) {
        delete app.globalData.communityFeedDirty
        const refreshAfterLike = () => {
          this.consumeCommunityModeration()
          if (this.data.communityLoaded) this.loadCommunity({ silent: true, keepDataOnError: true })
          else this.loadCommunity()
        }
        const pendingLike = app.globalData.communityLikePending
        if (pendingLike) {
          delete app.globalData.communityLikePending
          Promise.resolve(pendingLike).catch(() => false).then(refreshAfterLike)
        } else {
          refreshAfterLike()
        }
      }
    }
    if (this.data.activeTab === 'books') {
      this.loadBooks({ silent: true, keepDataOnError: true })
    }
    const redraw = resumeRefresh.shouldRedrawOnResume(false, this.topLevelUiRendered)
    if (redraw) this.load()
    else this.load({ silent: true, keepDataOnError: true })
  },

  drainPendingRecordingUploads() {
    if (this._recordingUploadDrain) return this._recordingUploadDrain
    this._recordingUploadDrain = recordingUploads.drain()
      .then((count) => {
        if (count > 0) {
          return this.load({ silent: true, keepDataOnError: true })
        }
        return true
      })
      .finally(() => { this._recordingUploadDrain = null })
    return this._recordingUploadDrain
  },

  /** Renders locally persisted uploads before the next network list refresh returns. */
  showPendingRecordingUploads() {
    const current = (this.data.allRecords || []).filter((record) => !record.localUpload)
    const records = this.withPendingRecordingUploads(current)
    const hadLocalUploads = current.length !== (this.data.allRecords || []).length
    if (!hadLocalUploads && records.length === current.length) return
    const selectedTag = this.selectedTagFor(records)
    const homeTags = recordingUtil.tagsFromRecords(records)
    const recordsWithRefs = this.preserveRecordingCovers(this.assignCommandRefs(records))
    this.setData({
      allRecords: recordsWithRefs,
      homeTags,
      homeTabs: this.homeTabsFor(homeTags),
      selectedTag,
      selectedTagMissing: Boolean(selectedTag && !homeTags.includes(selectedTag)),
      currentHomeTab: this.data.activeTab === 'community'
        ? 'community'
        : this.data.activeTab === 'books' ? 'books' : (selectedTag ? `tag:${selectedTag}` : 'recordings'),
      records: this.commandRecordsFor(recordsWithRefs, selectedTag)
    })
  },

  repairPhotoMarkers(records) {
    if (this._photoMarkerRepair) return this._photoMarkerRepair
    this._photoMarkerRepair = photoMarkerRepair.repairReady(records)
      .then((count) => {
        if (count > 0 && !this._pageUnloaded) {
          return this.load({
            silent: true,
            keepDataOnError: true,
            skipPhotoRepair: true
          })
        }
        return count
      })
      .catch(() => 0)
      .finally(() => { this._photoMarkerRepair = null })
    return this._photoMarkerRepair
  },

  onHide() {
    if (this.statusSession) this.statusSession.close()
    if (this.commandSession) this.commandSession.close()
  },

  onUnload() {
    audioConsentFlow.dispose(this)
    this._pageUnloaded = true
    this._bookLoadRequestId = (this._bookLoadRequestId || 0) + 1
    this._communityLoadGeneration = (this._communityLoadGeneration || 0) + 1
    this.recordCoverLoadId = (this.recordCoverLoadId || 0) + 1
    this.recordMetaLoadId = (this.recordMetaLoadId || 0) + 1
    if (this._bookCoverSession) this._bookCoverSession.dispose()
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
    if (this.data.activeTab === 'books') {
      return { title: 'VoiceDrop 写书', path: '/pages/recordings/index?tab=books' }
    }
    return {
      title: this.data.activeTab === 'community' ? 'VD社区' : 'VoiceDrop 口述',
      path: this.data.activeTab === 'community' ? '/pages/recordings/index?tab=community' : '/pages/recordings/index'
    }
  },

  onShareTimeline() {
    if (this.data.activeTab === 'books') {
      return { title: 'VoiceDrop 写书', query: 'tab=books' }
    }
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
    return tab === 'community' || tab === 'books' ? tab : 'recordings'
  },

  applyPendingHomeTab() {
    const pending = app.globalData.pendingHomeTab || ''
    if (!pending) return
    app.globalData.pendingHomeTab = ''
    if (pending === this.data.activeTab) return
    const activeTab = pending === 'community' || pending === 'books' ? pending : 'recordings'
    this.setData({
      activeTab,
      currentHomeTab: activeTab,
      scrollTop: this.scrollPositionFor(activeTab),
      refreshing: this.isTabRefreshing(activeTab)
    })
    if (this.data.activeTab === 'community') {
      const restored = this.data.communityLoaded || this.restoreCachedCommunityFeed()
      this.loadCommunity(restored ? { silent: true, keepDataOnError: true } : undefined)
    }
    if (this.data.activeTab === 'books') {
      const restored = this.data.booksLoaded || this.restoreCachedBooks()
      this.loadBooks(restored ? { silent: true, keepDataOnError: true } : undefined)
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
        scrollTop: this.scrollPositionFor('recordings'),
        refreshing: this.isTabRefreshing('recordings'),
        records: this.commandRecordsFor(this.data.allRecords, tag)
      })
      if (this.commandSession) this.commandSession.setRefs(this.currentCommandRefs())
      return
    }
    const activeTab = key === 'community' || key === 'books' ? key : 'recordings'
    const selectedTag = activeTab === 'recordings' ? '' : this.data.selectedTag
    this.setData({
      activeTab,
      currentHomeTab: key,
      selectedTag,
      selectedTagMissing: false,
      scrollTop: this.scrollPositionFor(activeTab),
      refreshing: this.isTabRefreshing(activeTab),
      records: activeTab === 'recordings' ? this.commandRecordsFor(this.data.allRecords, '') : this.data.records
    })
    if (activeTab === 'community') {
      const restored = this.data.communityLoaded || this.restoreCachedCommunityFeed()
      this.loadCommunity(restored ? { silent: true, keepDataOnError: true } : undefined)
    }
    if (activeTab === 'books') {
      const restored = this.data.booksLoaded || this.restoreCachedBooks()
      this.loadBooks(restored ? { silent: true, keepDataOnError: true } : undefined)
    }
    if (this.commandSession) this.commandSession.setRefs(this.currentCommandRefs())
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/index' })
  },

  scrollTab(tab) {
    return tab === 'community' || tab === 'books' ? tab : 'recordings'
  },

  scrollPositions() {
    if (!this._scrollPositions) {
      this._scrollPositions = { recordings: 0, community: 0, books: 0 }
      const activeTab = this.scrollTab(this.data.activeTab)
      this._scrollPositions[activeTab] = Math.max(0, Number(this.data.scrollTop) || 0)
    }
    return this._scrollPositions
  },

  scrollPositionFor(tab) {
    return Math.max(0, Number(this.scrollPositions()[this.scrollTab(tab)]) || 0)
  },

  onScroll(event) {
    const tab = this.scrollTab(this.data.activeTab)
    if (this.isTabRefreshing(tab)) return
    const scrollTop = Number(event && event.detail && event.detail.scrollTop)
    if (!Number.isFinite(scrollTop) || scrollTop < 0) return
    this.scrollPositions()[tab] = scrollTop
  },

  isTabRefreshing(tab) {
    return Boolean(this._refreshingTabs && this._refreshingTabs[this.scrollTab(tab)])
  },

  refreshCurrent(options, tab) {
    const requested = tab || this.data.activeTab
    const target = requested === 'community' || requested === 'books' ? requested : 'recordings'
    if (target === 'community') return this.loadCommunity(options)
    if (target === 'books') return this.loadBooks(options)
    return this.load(options)
  },

  restoreCachedBooks() {
    const items = books.cachedShelf()
    if (!items.length) return false
    const bookItems = this.prepareBookItems(items)
    this.setData({ bookItems, bookRows: bookRowsFor(bookItems), booksLoading: false, booksError: '', booksLoaded: true })
    this._bookCoverSession.load(bookItems)
    return true
  },

  ensureBookCoverSession() {
    if (this._bookCoverSession) return this._bookCoverSession
    this._bookCoverSession = bookCoverCache.createSession(null, (slug, key, filePath) => {
      if (this._pageUnloaded) return
      let changed = false
      const bookItems = this.data.bookItems.map((book) => {
        if (book.slug !== slug || book.coverCacheKey !== key) return book
        changed = true
        return Object.assign({}, book, { coverDisplayUrl: filePath })
      })
      if (changed) this.setData({ bookItems, bookRows: bookRowsFor(bookItems) })
    })
    return this._bookCoverSession
  },

  prepareBookItems(items) {
    const routed = books.refreshCoverUrls(items)
    return this.ensureBookCoverSession().decorate(routed)
  },

  onBookCoverError(event) {
    const slug = event.currentTarget.dataset.slug
    const book = this.data.bookItems.find((item) => item.slug === slug)
    if (!book) return
    const bookItems = this.data.bookItems.map((item) => item.slug === slug
      ? Object.assign({}, item, { coverDisplayUrl: '' })
      : item)
    this.setData({ bookItems, bookRows: bookRowsFor(bookItems) })
    this.ensureBookCoverSession().retry(book)
  },

  async loadBooks(options) {
    const silent = Boolean(options && options.silent)
    const keepDataOnError = Boolean(options && options.keepDataOnError)
    const forceRefresh = Boolean(options && options.forceRefresh)
    const requestId = (this._bookLoadRequestId || 0) + 1
    this._bookLoadRequestId = requestId
    if (!silent) this.setData({ booksLoading: true, booksError: '' })
    try {
      const items = await books.shelf({ forceRefresh })
      if (this._pageUnloaded || this._bookLoadRequestId !== requestId) return true
      const bookItems = this.prepareBookItems(items)
      this.setData({ bookItems, bookRows: bookRowsFor(bookItems), booksError: '', booksLoaded: true })
      this._bookCoverSession.load(bookItems)
      return true
    } catch (_) {
      if (this._pageUnloaded || this._bookLoadRequestId !== requestId) return true
      if (!keepDataOnError || !this.data.bookItems.length) {
        this.setData({ booksError: '书架加载失败，下拉重试' })
      }
      return false
    } finally {
      if (!this._pageUnloaded && this._bookLoadRequestId === requestId) {
        this.setData({ booksLoading: false })
      }
    }
  },

  writeBook() {
    wx.navigateTo({ url: '/pages/book-writing/index' })
  },

  openBook(event) {
    const slug = event.currentTarget.dataset.slug
    const book = this.data.bookItems.find((item) => item.slug === slug)
    if (!book) return
    wx.navigateTo({
      url: `/pages/book-reader/index?slug=${encodeURIComponent(book.slug)}&title=${encodeURIComponent(book.main)}&author=${encodeURIComponent(book.author || '')}&cover=${book.cover ? '1' : '0'}&coverAt=${encodeURIComponent(String(book.coverAt || 0))}&mine=${book.mine ? '1' : '0'}&hidden=${book.hidden ? '1' : '0'}`,
      events: { bookHiddenChanged: () => this.loadBooks({ silent: true, keepDataOnError: true, forceRefresh: true }) }
    })
  },

  refreshFromUser() {
    const tab = this.scrollTab(this.data.activeTab)
    const refreshPromises = this._refreshPromises || (this._refreshPromises = Object.create(null))
    if (refreshPromises[tab]) return refreshPromises[tab]
    const refreshingTabs = this._refreshingTabs || (this._refreshingTabs = Object.create(null))
    const refreshingBooks = tab === 'books'
    const options = { silent: true, keepDataOnError: true }
    if (refreshingBooks) options.forceRefresh = true
    refreshingTabs[tab] = true
    if (this.scrollTab(this.data.activeTab) === tab) this.setData({ refreshing: true })
    const refreshPromise = Promise.all([
      Promise.resolve(this.refreshCurrent(options, tab)),
      refreshingBooks ? wait(MIN_BOOK_REFRESH_FEEDBACK_MS) : Promise.resolve()
    ])
      .then(([ok]) => {
        if (ok === false) wx.showToast({ title: '加载失败', icon: 'error' })
        return ok
      })
      .catch(() => {
        wx.showToast({ title: '加载失败', icon: 'error' })
        return false
      })
      .finally(() => {
        if (refreshPromises[tab] === refreshPromise) delete refreshPromises[tab]
        refreshingTabs[tab] = false
        if (!this._pageUnloaded && this.scrollTab(this.data.activeTab) === tab) {
          this.setData({ refreshing: false })
        }
      })
    refreshPromises[tab] = refreshPromise
    return refreshPromise
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

      const durationSeconds = recordingQuality.durationSeconds(
        res && res.duration,
        Date.now() - this.data.startedAt
      )
      const elapsed = Math.max(1, Math.round(durationSeconds))
      const name = audio.nameForSession(new Date(this.data.startedAt), elapsed)
      this.setData({ recording: false, seconds: elapsed })
      if (recordingQuality.isTooShort(durationSeconds)) {
        await audio.discardFile(res && res.tempFilePath)
        app.globalData.pendingRecordTag = ''
        app.globalData.pendingReplyTo = null
        wx.showModal({
          title: '录音太短',
          content: '时间太短，不足以产生文章，这条录音不会上传。',
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }
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

  restoreCachedRecordings() {
    const records = library.cachedRecordings && library.cachedRecordings()
    if (!Array.isArray(records)) return false
    const visibleRecords = this.withPendingRecordingUploads(records)
    const selectedTag = this.selectedTagFor(visibleRecords)
    const homeTags = recordingUtil.tagsFromRecords(visibleRecords)
    const homeTabs = this.homeTabsFor(homeTags)
    const recordsWithRefs = this.preserveRecordingCovers(this.assignCommandRefs(visibleRecords))
    const filteredRecords = this.commandRecordsFor(recordsWithRefs, selectedTag)
    const currentHomeTab = this.data.activeTab === 'community'
      ? 'community'
      : this.data.activeTab === 'books' ? 'books' : (selectedTag ? `tag:${selectedTag}` : 'recordings')
    const recordCoverLoadId = (this.recordCoverLoadId || 0) + 1
    this.recordCoverLoadId = recordCoverLoadId
    this.topLevelUiRendered = true
    this.setData({
      allRecords: recordsWithRefs,
      homeTags,
      homeTabs,
      selectedTag,
      selectedTagMissing: Boolean(selectedTag && !homeTags.includes(selectedTag)),
      currentHomeTab,
      records: filteredRecords,
      loading: false,
      error: ''
    })
    this.loadRecordingCovers(recordsWithRefs, recordCoverLoadId)
    if (this.commandSession) this.commandSession.setRefs(this.currentCommandRefs())
    return true
  },

  async load(options) {
    if (this._libraryLoadPromise) {
      const incoming = options || {}
      const queued = this._libraryLoadQueuedOptions
      this._libraryLoadQueuedOptions = {
        silent: queued ? queued.silent && Boolean(incoming.silent) : Boolean(incoming.silent),
        keepDataOnError: true,
        skipPhotoRepair: queued
          ? queued.skipPhotoRepair && Boolean(incoming.skipPhotoRepair)
          : Boolean(incoming.skipPhotoRepair)
      }
      return this._libraryLoadPromise
    }
    const task = (async () => {
      let currentOptions = options
      let result = false
      do {
        this._libraryLoadQueuedOptions = null
        result = await this.fetchLibrary(currentOptions)
        currentOptions = this._libraryLoadQueuedOptions
      } while (currentOptions)
      return result
    })()
    this._libraryLoadPromise = task
    try {
      return await task
    } finally {
      if (this._libraryLoadPromise === task) this._libraryLoadPromise = null
    }
  },

  async fetchLibrary(options) {
    const silent = Boolean(options && options.silent)
    const keepDataOnError = Boolean(options && options.keepDataOnError)
    if (!silent) this.setData({ loading: true, error: '' })
    try {
      const records = this.withPendingRecordingUploads(await library.list())
      if (!options?.skipPhotoRepair) this.repairPhotoMarkers(records)
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
        : this.data.activeTab === 'books' ? 'books' : (selectedTag ? `tag:${selectedTag}` : 'recordings')

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

  /** Adds durable, not-yet-indexed uploads so returning from recording is immediate. */
  withPendingRecordingUploads(records) {
    const knownNames = new Set((records || []).map((record) => record && record.audioName))
    const pending = recordingUploads.pending()
      .filter((item) => item && item.name && !knownNames.has(item.name))
      .map((item) => {
        const record = recordingUtil.fromRemoteFile({ name: item.name })
        record.uploading = true
        record.localUpload = true
        record.tags = item.tag ? [item.tag] : []
        record.statusLabel = recordingUtil.statusLabel(record)
        record.statusColor = recordingUtil.statusColor(record)
        return record
      })
    return pending.concat(records || [])
  },

  async enrichRecordingMeta(records, loadId) {
    if (!library.enrichArticleMeta) return
    try {
      await library.enrichArticleMeta(records)
      if (loadId !== this.recordMetaLoadId) return
      const enrichedByStem = new Map((records || []).map((rec) => [rec.stem, rec]))
      const currentRecords = (this.data.allRecords || []).map((current) => {
        const enriched = enrichedByStem.get(current.stem)
        if (!enriched) return current
        return Object.assign({}, current, {
          articleTitle: enriched.articleTitle || '',
          tags: Array.isArray(enriched.tags) ? enriched.tags : [],
          coverPhotoKey: enriched.coverPhotoKey || '',
          rowTitle: enriched.rowTitle || current.rowTitle
        })
      })
      const selectedTag = this.selectedTagFor(currentRecords)
      const homeTags = recordingUtil.tagsFromRecords(currentRecords)
      const homeTabs = this.homeTabsFor(homeTags)
      const recordsWithRefs = this.preserveRecordingCovers(this.assignCommandRefs(currentRecords))
      const filteredRecords = this.commandRecordsFor(recordsWithRefs, selectedTag)
      const currentHomeTab = this.data.activeTab === 'community'
        ? 'community'
        : this.data.activeTab === 'books' ? 'books' : (selectedTag ? `tag:${selectedTag}` : 'recordings')
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
    const candidates = (records || []).filter((rec) => rec && !rec.coverPhotoUrl &&
      ((rec.hasArticles && recordingUtil.coverKeyForStem(rec.stem || rec.audioName)) || rec.coverPhotoKey))
    if (!candidates.length) return
    if (!this.recordCoverMissingKeys) this.recordCoverMissingKeys = new Set()
    let scope = ''
    try {
      scope = await library.ownerScope()
    } catch (_) {
      return
    }
    if (!scope || loadId !== this.recordCoverLoadId) return
    await Promise.all(candidates.map(async (rec) => {
      const dedicatedKey = rec.hasArticles ? recordingUtil.coverKeyForStem(rec.stem || rec.audioName) : ''
      const dedicatedMissingKey = dedicatedKey ? `${scope}${dedicatedKey}` : ''
      if (dedicatedKey && !this.recordCoverMissingKeys.has(dedicatedMissingKey)) {
        try {
          const dedicatedUrl = await library.downloadPhotoTemp(dedicatedKey, scope, { preferThumb: true })
          if (dedicatedUrl && loadId === this.recordCoverLoadId) {
            // Keep the square waveform visible until the mini-program image
            // component has actually decoded the dedicated portrait cover.
            this.updateRecordingCover(rec.stem, dedicatedUrl, true, false)
            return
          }
          this.recordCoverMissingKeys.add(dedicatedMissingKey)
        } catch (_) {
          this.recordCoverMissingKeys.add(dedicatedMissingKey)
        }
      }
      if (!rec.coverPhotoKey) return
      try {
        const fallbackUrl = await library.downloadPhotoTemp(rec.coverPhotoKey, scope, { preferThumb: true })
        if (!fallbackUrl || loadId !== this.recordCoverLoadId) return
        this.updateRecordingCover(rec.stem, fallbackUrl, false, true)
      } catch (_) {}
    }))
  },

  preserveRecordingCovers(records) {
    const current = new Map((this.data.allRecords || []).map((rec) => [rec.stem, rec]))
    return (records || []).map((rec) => {
      const cached = current.get(rec.stem)
      if (!cached || !cached.coverPhotoUrl || cached.coverPhotoKey !== rec.coverPhotoKey) return rec
      return Object.assign({}, rec, {
        coverPhotoUrl: cached.coverPhotoUrl,
        coverPhotoIsBook: Boolean(cached.coverPhotoIsBook),
        coverPhotoLoaded: Boolean(cached.coverPhotoLoaded)
      })
    })
  },

  updateRecordingCover(stem, coverPhotoUrl, coverPhotoIsBook, coverPhotoLoaded) {
    const update = (records) => (records || []).map((rec) => rec.stem === stem
      ? Object.assign({}, rec, {
          coverPhotoUrl: coverPhotoUrl || '',
          coverPhotoIsBook: Boolean(coverPhotoUrl && coverPhotoIsBook),
          coverPhotoLoaded: Boolean(coverPhotoUrl && coverPhotoLoaded)
        })
      : rec)
    this.setData({
      allRecords: update(this.data.allRecords),
      records: update(this.data.records)
    })
  },

  onRecordCoverLoad(event) {
    const stem = event.currentTarget.dataset.stem || ''
    const url = event.currentTarget.dataset.url || ''
    if (!stem || !url) return
    const update = (records) => (records || []).map((rec) => rec.stem === stem && rec.coverPhotoUrl === url
      ? Object.assign({}, rec, { coverPhotoLoaded: true })
      : rec)
    this.setData({
      allRecords: update(this.data.allRecords),
      records: update(this.data.records)
    })
  },

  async onRecordCoverError(event) {
    const stem = event.currentTarget.dataset.stem || ''
    const url = event.currentTarget.dataset.url || ''
    if (!stem) return
    const record = (this.data.allRecords || []).find((rec) => rec.stem === stem)
    if (!record || (url && record.coverPhotoUrl !== url)) return
    const wasDedicatedCover = Boolean(record.coverPhotoIsBook)
    this.updateRecordingCover(stem, '', false, false)
    if (!wasDedicatedCover || !record.coverPhotoKey) return

    const dedicatedKey = recordingUtil.coverKeyForStem(record.stem || record.audioName)
    if (record.coverPhotoKey === dedicatedKey) return
    const loadId = this.recordCoverLoadId
    try {
      const scope = await library.ownerScope()
      if (!scope || loadId !== this.recordCoverLoadId) return
      if (!this.recordCoverMissingKeys) this.recordCoverMissingKeys = new Set()
      if (dedicatedKey) this.recordCoverMissingKeys.add(`${scope}${dedicatedKey}`)
      const fallbackUrl = await library.downloadPhotoTemp(record.coverPhotoKey, scope, { preferThumb: true })
      if (!fallbackUrl || loadId !== this.recordCoverLoadId) return
      this.updateRecordingCover(stem, fallbackUrl, false, true)
    } catch (_) {}
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
    this.warmCommunityDetails(postData.communityPosts)
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

  // Detail is a separate page. Apply its successful block/report locally before
  // the network refresh so returning to the community never briefly shows the
  // just-moderated card. The refresh below remains the server reconciliation.
  consumeCommunityModeration() {
    const moderation = app.globalData.communityModeration
    if (!moderation) return
    delete app.globalData.communityModeration
    if (!this._communityFeed) return
    const keep = (post) => {
      if (moderation.type === 'report') return post.shareId !== moderation.shareId
      if (moderation.type === 'block') return (post.author || post.authorName || '') !== moderation.author
      return true
    }
    this._communityFeed = community.filterFeed(this._communityFeed, keep)
    this.setData(this.communityPostData(this._communityFeed, this.data.communityFeedTab))
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
      this.warmCommunityDetails(postData.communityPosts)
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

  openCommunitySearch() {
    this.setData({ communitySearching: true })
  },

  onCommunitySearchInput(event) {
    const query = event && event.detail ? event.detail.value : ''
    this.setData({
      communitySearchQuery: query,
      ...this.communityPostData(this._communityFeed, this.data.communityFeedTab, query)
    })
  },

  closeCommunitySearch() {
    this.setData({
      communitySearching: false,
      communitySearchQuery: '',
      ...this.communityPostData(this._communityFeed, this.data.communityFeedTab, '')
    })
  },

  communityPostData(feed, tab, query) {
    const communityPosts = community.searchPosts(
      community.cardPosts(feed, tab), query == null ? this.data.communitySearchQuery : query)
    const columns = community.masonryColumns(communityPosts, this._communityCoverAspects)
    return {
      communityPosts,
      communityLeftPosts: columns.left,
      communityRightPosts: columns.right
    }
  },

  warmCommunityDetails(posts) {
    if (!community.get) return
    const candidates = (posts || []).slice(0, 4).filter((post) =>
      post && post.shareId && !(community.cachedPost && community.cachedPost(post.shareId)))
    if (!candidates.length) return
    const generation = (this._communityWarmGeneration || 0) + 1
    this._communityWarmGeneration = generation
    const queue = candidates.slice()
    const worker = async () => {
      while (queue.length && generation === this._communityWarmGeneration && !this._pageUnloaded) {
        const post = queue.shift()
        await community.get(post.shareId).catch(() => null)
      }
    }
    return Promise.all([worker(), worker()]).catch(() => [])
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

  onCommunityCoverError(event) {
    const shareId = event.currentTarget.dataset.shareId || ''
    if (!shareId) return
    const replace = (posts) => (posts || []).map((post) => {
      if (post.shareId !== shareId || !post.coverPhotoOriginalUrl || post.coverPhotoUrl === post.coverPhotoOriginalUrl) return post
      return Object.assign({}, post, { coverPhotoUrl: post.coverPhotoOriginalUrl })
    })
    const communityPosts = replace(this.data.communityPosts)
    const columns = community.masonryColumns(communityPosts, this._communityCoverAspects)
    this.setData({ communityPosts, communityLeftPosts: columns.left, communityRightPosts: columns.right })
  },

  createStatusSession() {
    this.statusSession = statusSession.createSession({
      onPhase: ({ stem, status }) => this.updateRecordStatus(stem, status),
      onDone: ({ stem, status }) => {
        const updated = this.updateRecordStatus(stem, status)
        // Completion must not reload the whole home feed. Fetching the one
        // finished article supplies its title/cover while all command refs stay
        // derived from the locally updated allRecords snapshot.
        if (updated && status === 'ready') {
          const loadId = (this.recordMetaLoadId || 0) + 1
          this.recordMetaLoadId = loadId
          this.enrichRecordingMeta([updated], loadId)
        }
      },
      onLinkRequest: (request) => {
        if (this.deviceLinkApproval) this.deviceLinkApproval.present(request)
      },
      onLinkRelease: (release) => {
        this.setData({ linkRequest: null })
        if (this.deviceLinkApproval) this.deviceLinkApproval.release(release)
      }
    })
  },

  createDeviceLinkApproval() {
    return deviceLinkApproval.createApproval({
      onPresent: (request) => {
        if (this._pageUnloaded) return
        this.setData({ linkRequest: request })
      }
    })
  },

  acknowledgeDeviceLink() {
    this.setData({ linkRequest: null })
  },

  rejectDeviceLink() {
    const pairingId = this.data.linkRequest && this.data.linkRequest.pairingId
    this.setData({ linkRequest: null })
    if (pairingId && this.deviceLinkApproval) this.deviceLinkApproval.reject(pairingId)
  },

  preventDeviceLinkTouchMove() {},

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
      onUpdate: (stems) => {
        if (library.invalidateArticleCaches) library.invalidateArticleCaches(stems)
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

  resetAccountSessionsIfNeeded() {
    const currentBearer = auth.bearer()
    if (!accountState.identityChanged(this._socketBearer, currentBearer)) return false
    this._socketBearer = currentBearer
    this._bookLoadRequestId = (this._bookLoadRequestId || 0) + 1
    const cachedBooks = books.cachedShelf()
    const bookItems = this.prepareBookItems(cachedBooks)
    if (this.statusSession) this.statusSession.close()
    if (this.commandSession) this.commandSession.close()
    this._libraryCommandConfirms = []
    this._activeLibraryCommandConfirm = null
    this.setData({
      commandQueue: [],
      commandReply: '',
      commandReplyOk: true,
      commandState: '',
      bookItems,
      bookRows: bookRowsFor(bookItems),
      booksLoaded: cachedBooks.length > 0,
      booksError: ''
    })
    this._bookCoverSession.load(bookItems)
    this.createStatusSession()
    this.deviceLinkApproval = this.createDeviceLinkApproval()
    this.createCommandSession()
    return true
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
    let changed = null
    const apply = (records) => (records || []).map((rec) => {
      if (rec.stem !== stem) return rec
      const next = Object.assign({}, rec)
      if (status === 'ready') next.hasArticles = true
      else if (status === 'empty') next.isEmpty = true
      else next.phase = status
      next.statusLabel = recordingUtil.statusLabel(next)
      next.statusColor = recordingUtil.statusColor(next)
      changed = next
      return next
    })
    const allRecords = this.preserveRecordingCovers(this.assignCommandRefs(apply(this.data.allRecords)))
    const selectedTag = this.selectedTagFor(allRecords)
    const records = this.commandRecordsFor(allRecords, selectedTag)
    this.setData({
      allRecords,
      selectedTag,
      selectedTagMissing: Boolean(selectedTag && !recordingUtil.tagsFromRecords(allRecords).includes(selectedTag)),
      records
    })
    if (this.commandSession) this.commandSession.setRefs(this.currentCommandRefs())
    return changed
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
      { key: 'community', label: 'VD社区' },
      { key: 'books', label: '写书' }
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
      this.setData({ dockHint: i18n.ui(hint) })
    } else {
      this.setData({ dockHint: i18n.ui('轻点录音 · 长按说话') })
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

module.exports = { layoutOffsets, bookRowsFor }
