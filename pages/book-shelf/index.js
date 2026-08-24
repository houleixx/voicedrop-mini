const books = require('../../services/books')
const bookCoverCache = require('../../services/book-cover-cache')
const settings = require('../../services/settings')
const MIN_REFRESH_FEEDBACK_MS = 600

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

Page({
  data: {
    tabs: [
      { key: 'recordings', label: '我的录音' },
      { key: 'community', label: 'VD社区' },
      { key: 'books', label: '写书' }
    ],
    items: [], profileAuthor: '', loading: true, refreshing: false, error: ''
  },

  onLoad() {
    this._shelfActive = true
    this._shelfIdentity = books.cacheIdentity()
    this.ensureBookCoverSession()
    const cached = books.cachedShelf()
    const items = this.prepareBookItems(cached, '')
    this.setData({ items, loading: cached.length === 0 })
    this._bookCoverSession.load(items)
    this.loadProfileAuthor()
    this.load({ keepData: true })
  },

  onShow() {
    const identity = books.cacheIdentity()
    if (identity !== this._shelfIdentity) {
      this._shelfIdentity = identity
      this._shelfRequestId = (this._shelfRequestId || 0) + 1
      this._profileAuthorRequestId = (this._profileAuthorRequestId || 0) + 1
      const cached = books.cachedShelf()
      const items = this.prepareBookItems(cached, '')
      this.setData({ items, profileAuthor: '', loading: cached.length === 0, error: '' })
      this._bookCoverSession.load(items)
      this.loadProfileAuthor()
      this.load({ keepData: cached.length > 0 })
      return
    }
    if (this._reloadAuthorAfterSettings) {
      this._reloadAuthorAfterSettings = false
      this.loadProfileAuthor()
    }
    if (!this._reloadAfterRevise) return
    this._reloadAfterRevise = false
    this.load({ keepData: true, forceRefresh: true })
  },

  async loadProfileAuthor() {
    const requestId = (this._profileAuthorRequestId || 0) + 1
    this._profileAuthorRequestId = requestId
    this.setData({
      profileAuthor: '',
      items: books.markEditableByAuthor(this.data.items, '')
    })
    try {
      const profile = await settings.loadStyle()
      if (this._shelfActive === false || this._profileAuthorRequestId !== requestId) return
      const profileAuthor = String(profile && profile.name || '').trim()
      this.setData({
        profileAuthor,
        items: books.markEditableByAuthor(this.data.items, profileAuthor)
      })
    } catch (_) {}
  },

  async load(options) {
    const requestId = (this._shelfRequestId || 0) + 1
    this._shelfRequestId = requestId
    const forceRefresh = Boolean(options && options.forceRefresh)
    try {
      const items = await books.shelf({ forceRefresh })
      if (this._shelfRequestId !== requestId) return
      const prepared = this.prepareBookItems(items, this.data.profileAuthor)
      this.setData({ items: prepared, error: '' })
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
    this._shelfRequestId = (this._shelfRequestId || 0) + 1
    this._profileAuthorRequestId = (this._profileAuthorRequestId || 0) + 1
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
      if (changed) this.setData({ items })
    })
    return this._bookCoverSession
  },
  prepareBookItems(items, author) {
    const routed = books.refreshCoverUrls(items)
    return this.ensureBookCoverSession().decorate(books.markEditableByAuthor(routed, author))
  },
  onBookCoverError(event) {
    const slug = event.currentTarget.dataset.slug
    const book = this.data.items.find((item) => item.slug === slug)
    if (!book) return
    this.setData({ items: this.data.items.map((item) => item.slug === slug
      ? Object.assign({}, item, { coverDisplayUrl: '' })
      : item) })
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
  reviseBook(event) {
    const book = this.data.items[event.currentTarget.dataset.index]
    if (!book || !book.editableByAuthor) return
    this._reloadAfterRevise = true
    wx.navigateTo({
      url: `/pages/book-revise/index?slug=${encodeURIComponent(book.slug)}&title=${encodeURIComponent(book.main || book.title || '')}`,
      fail: () => { this._reloadAfterRevise = false }
    })
  },
  openBook(event) {
    const book = this.data.items[event.currentTarget.dataset.index]
    if (!book) return
    wx.navigateTo({ url: `/pages/book-reader/index?slug=${encodeURIComponent(book.slug)}&title=${encodeURIComponent(book.title)}&main=${encodeURIComponent(book.main)}&author=${encodeURIComponent(book.author)}&cover=${book.cover ? '1' : '0'}&coverAt=${encodeURIComponent(String(book.coverAt || 0))}` })
  }
})
