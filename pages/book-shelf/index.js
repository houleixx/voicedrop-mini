const books = require('../../services/books')
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
    items: [], loading: true, refreshing: false, error: ''
  },

  onLoad() {
    this._shelfActive = true
    const cached = books.cachedShelf()
    this.setData({ items: cached, loading: cached.length === 0 })
    this.load({ keepData: true })
  },

  async load(options) {
    const requestId = (this._shelfRequestId || 0) + 1
    this._shelfRequestId = requestId
    const forceRefresh = Boolean(options && options.forceRefresh)
    try {
      const items = await books.shelf({ forceRefresh })
      if (this._shelfRequestId !== requestId) return
      this.setData({ items, error: '' })
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
  },
  switchTab(event) {
    const key = event.detail && event.detail.key
    if (key === 'recordings') wx.reLaunch({ url: '/pages/recordings/index' })
    if (key === 'community') wx.reLaunch({ url: '/pages/recordings/index?tab=community' })
  },
  openSettings() { wx.navigateTo({ url: '/pages/settings/index' }) },
  writeBook() { wx.navigateTo({ url: '/pages/book-writing/index' }) },
  openBook(event) {
    const book = this.data.items[event.currentTarget.dataset.index]
    if (!book) return
    wx.navigateTo({ url: `/pages/book-reader/index?slug=${encodeURIComponent(book.slug)}&title=${encodeURIComponent(book.title)}&main=${encodeURIComponent(book.main)}&author=${encodeURIComponent(book.author)}&cover=${book.cover ? '1' : '0'}` })
  }
})
