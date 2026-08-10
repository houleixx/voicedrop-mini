const books = require('../../services/books')

Page({
  data: { seed: '', sending: false, submitted: false, message: '', error: false },
  onInput(event) { this.setData({ seed: String(event.detail.value || '').slice(0, 20000), message: '', error: false }) },
  openShelf() { wx.navigateTo({ url: `/pages/web/index?url=${encodeURIComponent(books.SHELF)}&title=${encodeURIComponent('公开书架')}` }) },
  async start() {
    const seed = this.data.seed.trim()
    if (!seed || this.data.sending || this.data.submitted) return
    this.setData({ sending: true, message: '', error: false })
    let statusCode = 0
    try { statusCode = (await books.start(seed)).statusCode || 0 } catch (_) {}
    this.setData({ sending: false, submitted: statusCode === 202, message: books.message(statusCode), error: statusCode !== 202 })
  }
})
