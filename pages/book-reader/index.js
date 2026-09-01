const books = require('../../services/books')

const LOADING_LAYOUT_DELAY_MS = 100

function decoded(value) {
  try { return decodeURIComponent(String(value || '')) } catch (_) { return String(value || '') }
}

Page({
  data: { url: '', loading: false, title: '', author: '', cover: false, mine: false, hidden: false },
  onLoad(options) {
    const slug = String(options.slug || '').replace(/[^A-Za-z0-9_-]/g, '')
    const book = {
      slug,
      title: decoded(options.title),
      main: decoded(options.main || options.title),
      author: decoded(options.author),
      cover: String(options.cover || '') === '1',
      coverAt: Math.max(0, Number(options.coverAt) || 0),
      mine: String(options.mine || '') === '1',
      hidden: String(options.hidden || '') === '1'
    }
    this.book = book
    this.bookUrl = books.readerPageUrl(book, decoded(options.page))
    this._webFinished = false
    this.setData({ url: this.bookUrl, title: book.main, author: book.author, cover: book.cover, mine: book.mine, hidden: book.hidden })
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
    this.loadOwnership()
  },
  onReady() {
    if (this._webFinished) return
    this.cancelLoadingTimer()
    this._loadingTimer = setTimeout(() => {
      this._loadingTimer = null
      if (!this._webFinished) this.setData({ loading: true })
    }, LOADING_LAYOUT_DELAY_MS)
  },
  cancelLoadingTimer() {
    if (!this._loadingTimer) return
    clearTimeout(this._loadingTimer)
    this._loadingTimer = null
  },
  finishLoading() {
    this._webFinished = true
    this.cancelLoadingTimer()
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
  async loadOwnership() {
    try {
      const ownership = await books.ownership(this.book.slug)
      if (!this.book || ownership == null) return
      this.book.mine = ownership.mine
      this.book.hidden = ownership.hidden
      this.setData({ mine: ownership.mine, hidden: ownership.hidden })
    } catch (_) {
      // The shelf result is a usable first-frame fallback while offline.
    }
  },
  openActions() {
    if (!this.data.mine || this._changingHidden) return
    const hidden = this.data.hidden
    wx.showActionSheet({
      itemList: ['修改这本书', hidden ? '取消隐藏本书' : '隐藏本书'],
      success: (result) => {
        if (result.tapIndex === 0) {
          wx.navigateTo({ url: `/pages/book-revise/index?slug=${encodeURIComponent(this.book.slug)}&title=${encodeURIComponent(this.book.main || this.book.title || '')}` })
          return
        }
        this.confirmSetHidden(!hidden)
      }
    })
  },
  confirmSetHidden(hidden) {
    wx.showModal({
      title: hidden ? '隐藏本书？' : '取消隐藏本书？',
      content: hidden ? '隐藏后不会出现在公开书架，已有直链仍可阅读。' : '取消隐藏后会重新出现在公开书架。',
      confirmText: hidden ? '隐藏' : '取消隐藏',
      success: (result) => { if (result.confirm) this.setHidden(hidden) }
    })
  },
  async setHidden(hidden) {
    if (this._changingHidden) return
    this._changingHidden = true
    try {
      await books.setHidden(this.book.slug, hidden)
      if (!this.book) return
      this.book.hidden = hidden
      this.setData({ hidden })
      wx.showToast({ title: hidden ? '已隐藏，书架上看不到了' : '已取消隐藏', icon: 'none' })
      try { this.getOpenerEventChannel().emit('bookHiddenChanged') } catch (_) {}
    } catch (error) {
      wx.showToast({ title: error && error.statusCode === 403 ? '这不是你的书，改不了' : '没改成，过会儿再试', icon: 'none' })
      this.loadOwnership()
    } finally {
      this._changingHidden = false
    }
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
    this._webFinished = true
    this.cancelLoadingTimer()
    this.bookUrl = ''
    this.book = null
  }
})
