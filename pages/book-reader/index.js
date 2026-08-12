Page({
  data: { url: '', loading: false },
  onLoad(options) {
    const slug = String(options.slug || '').replace(/[^A-Za-z0-9_-]/g, '')
    this.bookUrl = `https://voicedrop.cn/books/${slug}/`
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
  onUnload() {
    this.bookUrl = ''
  }
})
