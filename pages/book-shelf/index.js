const books = require('../../services/books')
const bookSearch = require('../../utils/book-shelf-search')
const homeFilterLayout = require('../../utils/home-filter-layout')
const filterTabLayout = require('../../utils/filter-tab-layout')
const bookCoverCache = require('../../services/book-cover-cache')
const MIN_REFRESH_FEEDBACK_MS = 600

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

Page({
  ...bookSearch.pageMethods(books, 'items'),
  data: {
    ...bookSearch.initialData,
    filterBaselineClass: '',
    scrollTop: 0,
    scrollContentTop: 0,
    filteredScrollContentTop: 0,
    tabs: [
      { key: 'recordings', label: '我的录音' },
      { key: 'community', label: 'VD社区' },
      { key: 'books', label: '写书' }
    ],
    items: [], loading: true, refreshing: false, error: ''
  },

  onLoad() {
    this.setData({ filterBaselineClass: filterTabLayout.currentBaselineClass() })
    this._shelfActive = true
    this.setData(homeFilterLayout.initialOffsets())
    this._shelfIdentity = books.cacheIdentity()
    this.ensureBookCoverSession()
    const cached = books.cachedShelf()
    const items = this.prepareBookItems(cached)
    this.setData({ items, loading: cached.length === 0 })
    this.refreshBookSearch()
    this._bookCoverSession.load(items)
    this.load({ keepData: true })
  },

  onReady() { homeFilterLayout.measure(this) },

  onResize() { homeFilterLayout.measure(this) },

  onScroll(event) {
    this._bookScrollTop = Math.max(0, Number(event.detail.scrollTop) || 0)
  },

  resetBookScroll() {
    this.setData({ scrollTop: this._bookScrollTop || 0 }, () => {
      if (this._shelfActive === false) return
      this._bookScrollTop = 0
      this.setData({ scrollTop: 0 })
    })
  },

  onLanguageChanged() {
    this.refreshBookSearch()
    homeFilterLayout.measure(this)
  },

  onShow() {
    const identity = books.cacheIdentity()
    if (identity !== this._shelfIdentity) {
      this._shelfIdentity = identity
      this.setData({ bookFilter: 'all', bookQuery: '', bookSearching: false })
      this.invalidateBookSearch()
      this._shelfRequestId = (this._shelfRequestId || 0) + 1
      const cached = books.cachedShelf()
      const items = this.prepareBookItems(cached)
      this.setData({ items, loading: cached.length === 0, error: '' })
      this.refreshBookSearch()
      this._bookCoverSession.load(items)
      this.load({ keepData: cached.length > 0 })
      return
    }
  },

  async load(options) {
    const requestId = (this._shelfRequestId || 0) + 1
    this._shelfRequestId = requestId
    const forceRefresh = Boolean(options && options.forceRefresh)
    if (forceRefresh) this.invalidateBookSearch()
    try {
      const items = await books.shelf({ forceRefresh })
      if (this._shelfRequestId !== requestId) return
      const prepared = this.prepareBookItems(items)
      this.setData({ items: prepared, error: '' })
      this.resumeBookSearch()
      this._bookCoverSession.load(prepared)
    } catch (_) {
      if (this._shelfRequestId !== requestId) return
      if (!(options && options.keepData) || this.data.items.length === 0) {
        this.setData({ error: '书架加载失败，下拉重试' })
      }
    } finally {
      if (this._shelfRequestId === requestId) {
        const state = { loading: false }
        if (!forceRefresh) state.refreshing = false
        this.setData(state)
        this.resumeBookSearch()
      }
    }
  },

  async refresh() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true })
    try {
      await Promise.all([
        this.load({ keepData: true, forceRefresh: true }),
        wait(MIN_REFRESH_FEEDBACK_MS)
      ])
    } finally {
      if (this._shelfActive !== false) this.setData({ refreshing: false })
    }
  },
  onUnload() {
    this._shelfActive = false
    if (this._bookSearch) this._bookSearch.dispose()
    this._shelfRequestId = (this._shelfRequestId || 0) + 1
    if (this._bookCoverSession) this._bookCoverSession.dispose()
  },
  ensureBookCoverSession() {
    if (this._bookCoverSession) return this._bookCoverSession
    this._bookCoverSession = bookCoverCache.createSession(null, (slug, key, filePath) => {
      if (this._shelfActive === false) return
      let changed = false
      const items = this.data.items.map((book) => {
        if (book.slug !== slug || book.coverCacheKey !== key) return book
        changed = true
        return Object.assign({}, book, { coverDisplayUrl: filePath })
      })
      if (changed) { this.setData({ items }); this.refreshBookSearch() }
    })
    return this._bookCoverSession
  },
  prepareBookItems(items) {
    const routed = books.refreshCoverUrls(items)
    return this.ensureBookCoverSession().decorate(routed)
  },
  onBookCoverError(event) {
    const slug = event.currentTarget.dataset.slug
    const book = this.data.items.find((item) => item.slug === slug)
    if (!book) return
    this.setData({ items: this.data.items.map((item) => item.slug === slug
      ? Object.assign({}, item, { coverDisplayUrl: '' })
      : item) })
    this.refreshBookSearch()
    this.ensureBookCoverSession().retry(book)
  },
  switchTab(event) {
    const key = event.detail && event.detail.key
    if (key === 'recordings') wx.reLaunch({ url: '/pages/recordings/index' })
    if (key === 'community') wx.reLaunch({ url: '/pages/recordings/index?tab=community' })
  },
  openSettings() {
    this._reloadAuthorAfterSettings = true
    wx.navigateTo({ url: '/pages/settings/index' })
  },
  writeBook() { wx.navigateTo({ url: '/pages/book-writing/index' }) },
  openBook(event) {
    const book = this.data.items.find((item) => item.slug === event.currentTarget.dataset.slug)
    if (!book) return
    wx.navigateTo({
      url: `/pages/book-reader/index?slug=${encodeURIComponent(book.slug)}&title=${encodeURIComponent(book.title)}&main=${encodeURIComponent(book.main)}&author=${encodeURIComponent(book.author)}&cover=${book.cover ? '1' : '0'}&coverAt=${encodeURIComponent(String(book.coverAt || 0))}&mine=${book.mine ? '1' : '0'}&hidden=${book.hidden ? '1' : '0'}`,
      events: { bookHiddenChanged: () => this.load({ keepData: true, forceRefresh: true }) }
    })
  }
})
