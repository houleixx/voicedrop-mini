const books = require('../../services/books')

function decoded(value) {
  try { return decodeURIComponent(String(value || '')) } catch (_) { return String(value || '') }
}

Page({
  data: { url: '', loading: false, title: '', author: '', cover: false },
  onLoad(options) {
    const slug = String(options.slug || '').replace(/[^A-Za-z0-9_-]/g, '')
    const book = {
      slug,
      title: decoded(options.title),
      main: decoded(options.main || options.title),
      author: decoded(options.author),
      cover: String(options.cover || '') === '1',
      coverAt: Math.max(0, Number(options.coverAt) || 0)
    }
    this.book = book
    this.bookUrl = books.readerPageUrl(book, decoded(options.page))
    this.setData({ title: book.main, author: book.author, cover: book.cover })
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
  },
  onReady() {
    this.setData({ url: this.bookUrl, loading: true })
  },
  finishLoading() {
    if (!this.data.loading) return
    this.setData({ loading: false })
  },
  onWebLoad(event) {
    const source = event && event.detail && event.detail.src
    this.bookUrl = books.readerPageUrl(this.book, source || this.bookUrl)
    this.finishLoading()
  },
  onWebError() {
    this.finishLoading()
    wx.showToast({ title: '书籍加载失败', icon: 'none' })
  },
  sharePayload() {
    const book = this.book || {}
    const payload = {
      title: books.shareTitle(book),
      path: `/pages/book-reader/index?slug=${encodeURIComponent(book.slug || '')}&title=${encodeURIComponent(book.title || '')}&main=${encodeURIComponent(book.main || book.title || '')}&author=${encodeURIComponent(book.author || '')}&cover=${book.cover ? '1' : '0'}&coverAt=${encodeURIComponent(String(book.coverAt || 0))}`
    }
    const root = books.readerUrl(book)
    if (this.bookUrl && this.bookUrl !== root) payload.path += `&page=${encodeURIComponent(this.bookUrl)}`
    if (book.cover) payload.imageUrl = books.coverUrl(book)
    return payload
  },
  onShareAppMessage() { return this.sharePayload() },
  onShareTimeline() {
    const payload = this.sharePayload()
    return { title: payload.title, query: payload.path.split('?')[1] || '', imageUrl: payload.imageUrl }
  },
  onUnload() {
    this.bookUrl = ''
    this.book = null
  }
})
