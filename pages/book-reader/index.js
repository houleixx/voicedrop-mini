const books = require('../../services/books')

function decoded(value) {
  try { return decodeURIComponent(String(value || '')) } catch (_) { return String(value || '') }
}

Page({
  data: { url: '', loading: false, title: '', author: '', cover: false, moreTop: 92, moreRight: 12 },
  onLoad(options) {
    const slug = String(options.slug || '').replace(/[^A-Za-z0-9_-]/g, '')
    const book = {
      slug,
      title: decoded(options.title),
      main: decoded(options.main || options.title),
      author: decoded(options.author),
      cover: String(options.cover || '') === '1'
    }
    this.book = book
    this.bookUrl = books.readerUrl(book)
    let moreTop = 92
    let moreRight = 12
    try {
      const system = wx.getSystemInfoSync()
      const menu = wx.getMenuButtonBoundingClientRect()
      if (menu && menu.bottom) moreTop = menu.bottom + 8
      if (system && system.windowWidth && menu && menu.right) moreRight = system.windowWidth - menu.right
    } catch (_) {}
    this.setData({ title: book.main, author: book.author, cover: book.cover, moreTop, moreRight })
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
  },
  onReady() {
    this.setData({ url: this.bookUrl, loading: true })
  },
  finishLoading() {
    if (!this.data.loading) return
    this.setData({ loading: false })
  },
  onWebLoad() { this.finishLoading() },
  onWebError() {
    this.finishLoading()
    wx.showToast({ title: '书籍加载失败', icon: 'none' })
  },
  onShow() {
    if (!this._reloadAfterRevise) return
    this._reloadAfterRevise = false
    const separator = this.bookUrl.includes('?') ? '&' : '?'
    this.setData({ url: this.bookUrl + separator + '_refresh=' + Date.now(), loading: true })
  },
  openActions() {
    wx.showActionSheet({
      itemList: ['修改这本书'],
      success: (result) => {
        if (result.tapIndex === 0) this.openRevise()
      }
    })
  },
  openRevise() {
    const book = this.book || {}
    this._reloadAfterRevise = true
    wx.navigateTo({
      url: '/pages/book-revise/index?slug=' + encodeURIComponent(book.slug || '') +
        '&title=' + encodeURIComponent(book.main || book.title || ''),
      fail: () => { this._reloadAfterRevise = false }
    })
  },
  sharePayload() {
    const book = this.book || {}
    const payload = {
      title: books.shareTitle(book),
      path: `/pages/book-reader/index?slug=${encodeURIComponent(book.slug || '')}&title=${encodeURIComponent(book.title || '')}&main=${encodeURIComponent(book.main || book.title || '')}&author=${encodeURIComponent(book.author || '')}&cover=${book.cover ? '1' : '0'}`
    }
    if (book.cover) payload.imageUrl = books.coverUrl(book)
    return payload
  },
  onShareAppMessage() { return this.sharePayload() },
  onShareTimeline() {
    const payload = this.sharePayload()
    return { title: payload.title, query: payload.path.split('?')[1] || '', imageUrl: payload.imageUrl }
  },
  onUnload() {
    this._reloadAfterRevise = false
    this.bookUrl = ''
    this.book = null
  }
})
