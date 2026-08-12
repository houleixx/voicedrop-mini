const books = require('../../services/books')

Page({
  data: { seed: '', sending: false, submitted: false, message: '', error: false,
    balance: null, balanceDisplay: '', invite: {}, shortfall: 0, feedTimes: '—', invitePeople: '—', canSubmit: false },
  async onLoad() {
    const context = await books.writingContext()
    const balance = context.balance
    const invite = context.invite || {}
    const shortfall = books.shortfall(balance)
    this.setData({ balance, balanceDisplay: books.formatBalance(balance), invite, shortfall,
      feedTimes: invite.suanliFeedAuthor ? Math.ceil(shortfall / invite.suanliFeedAuthor) : '—',
      invitePeople: invite.suanliInviter ? Math.ceil(shortfall / invite.suanliInviter) : '—' })
    this.updateSubmit()
  },
  onInput(event) { this.setData({ seed: String(event.detail.value || '').slice(0, 20000), message: '', error: false }); this.updateSubmit() },
  openShelf() { wx.navigateTo({ url: `/pages/web/index?url=${encodeURIComponent(books.SHELF)}&title=${encodeURIComponent('公开书架')}` }) },
  done() { wx.navigateBack() },
  updateSubmit() {
    this.setData({ canSubmit: Boolean(this.data.seed.trim()) && !this.data.sending && !this.data.submitted &&
      (this.data.balance == null || this.data.balance >= books.BOOK_SUANLI) })
  },
  shareInvite() {
    if (!this.data.invite || !this.data.invite.url) return
    wx.setClipboardData({ data: this.data.invite.url, success: () => wx.showToast({ title: '邀请链接已复制' }) })
  },
  showSubmitLoading() {
    this.submitLoading = true
    wx.showLoading({ title: '提交中…', mask: true })
  },
  hideSubmitLoading() {
    if (!this.submitLoading) return
    this.submitLoading = false
    wx.hideLoading()
  },
  async start() {
    const seed = this.data.seed.trim()
    if (!seed || this.data.sending || this.data.submitted) return
    this.setData({ sending: true, message: '', error: false }); this.updateSubmit()
    this.showSubmitLoading()
    let response
    try { response = await books.start(seed) } catch (_) {} finally { this.hideSubmitLoading() }
    const result = books.result(response)
    const balance = response && response.statusCode === 402 && Number(response.data && response.data.suanli)
    const next = { sending: false, submitted: result.accepted, message: result.message, error: !result.accepted }
    if (Number.isFinite(balance)) { next.balance = balance; next.balanceDisplay = books.formatBalance(balance); next.shortfall = books.shortfall(balance) }
    this.setData(next); this.updateSubmit()
  },
  onUnload() { this.hideSubmitLoading() }
})
