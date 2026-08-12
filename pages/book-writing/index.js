const books = require('../../services/books')

Page({
  data: { seed: '', sending: false, submitted: false, message: '', error: false },
  onInput(event) { this.setData({ seed: String(event.detail.value || '').slice(0, 20000), message: '', error: false }) },
  openShelf() { wx.navigateTo({ url: `/pages/web/index?url=${encodeURIComponent(books.SHELF)}&title=${encodeURIComponent('公开书架')}` }) },
  async start() {
    const seed = this.data.seed.trim()
    if (!seed || this.data.sending || this.data.submitted) return
    this.setData({ sending: true, message: '', error: false })
    let response
    try { response = await books.start(seed) } catch (_) {}
    const result = books.result(response)
    this.setData({ sending: false, submitted: result.accepted, message: result.message, error: !result.accepted })
  }
})
