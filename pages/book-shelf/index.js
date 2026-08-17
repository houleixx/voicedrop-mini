const books = require('../../services/books')
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
    const cached = books.cachedShelf()
    this.setData({ items: books.markEditableByAuthor(cached, ''), loading: cached.length === 0 })
    this.loadProfileAuthor()
    this.load({ keepData: true })
  },

  onShow() {
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
      this.setData({ items: books.markEditableByAuthor(items, this.data.profileAuthor), error: '' })
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
