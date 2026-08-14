const books = require('../../services/books')

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
    const cached = books.cachedShelf()
    this.setData({ items: cached, loading: cached.length === 0 })
    this.load({ keepData: true })
  },

  async load(options) {
    try {
      const items = await books.shelf()
      this.setData({ items, error: '' })
    } catch (_) {
      if (!(options && options.keepData) || this.data.items.length === 0) {
        this.setData({ error: '书架加载失败，下拉重试' })
      }
    } finally {
      this.setData({ loading: false, refreshing: false })
    }
  },

  refresh() { this.setData({ refreshing: true }); this.load({ keepData: true }) },
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
