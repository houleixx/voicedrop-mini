const books = require('../../services/books')
const articleUtil = require('../../utils/article')

const app = getApp()

const IDEA_PLACEHOLDER = '比如：为什么一切都在变乱？\n或：钱不脏，是我一直躲着它。'
const ARTICLE_PLACEHOLDER = '比如：写成给孩子的绘本。（可留空）'

Page({
  data: { seed: '', seedArticle: null, seedPlaceholderKey: IDEA_PLACEHOLDER, seedTitleKey: '中心思想', sending: false, submitted: false, message: '', error: false,
    price: books.BOOK_SUANLI, balance: null, balanceDisplay: '', invite: {}, shortfall: 0, feedTimes: '—', invitePeople: '—', canSubmit: false },
  async onLoad() {
    const candidate = app.globalData.bookSeedArticle
    app.globalData.bookSeedArticle = null
    const seedArticle = candidate && typeof candidate === 'object'
      ? { title: String(candidate.title || '无题').trim() || '无题', body: articleUtil.stripMarkers(candidate.body) }
      : null
    if (seedArticle) this.setData({ seedArticle, seedPlaceholderKey: ARTICLE_PLACEHOLDER, seedTitleKey: '补充要求（可选）' })
    const context = await books.writingContext()
    const balance = context.balance
    const invite = context.invite || {}
    const prices = context.prices || {}
    const price = Number(prices.book) > 0 ? Number(prices.book) : books.BOOK_SUANLI
    const shortfall = books.shortfall(balance, price)
    this.setData({ price, balance, balanceDisplay: books.formatBalance(balance), invite, shortfall,
      feedTimes: invite.suanliFeedAuthor ? Math.ceil(shortfall / invite.suanliFeedAuthor) : '—',
      invitePeople: invite.suanliInviter ? Math.ceil(shortfall / invite.suanliInviter) : '—' })
    this.updateSubmit()
  },
  onInput(event) { this.setData({ seed: String(event.detail.value || '').slice(0, 20000), message: '', error: false }); this.updateSubmit() },
  openShelf() { wx.navigateTo({ url: `/pages/web/index?url=${encodeURIComponent(books.shelfWebUrl())}&title=${encodeURIComponent('公开书架')}` }) },
  done() { wx.navigateBack() },
  updateSubmit() {
    this.setData({ canSubmit: Boolean(this.data.seed.trim() || this.data.seedArticle) && !this.data.sending && !this.data.submitted &&
      (this.data.balance == null || this.data.balance >= this.data.price) })
  },
  submissionSeed() {
    if (this.data.seedArticle) return articleUtil.bookSeed(this.data.seedArticle, this.data.seed)
    return this.data.seed.trim().slice(0, 20000)
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
    const seed = this.submissionSeed()
    if (!seed || this.data.sending || this.data.submitted) return
    this.setData({ sending: true, message: '', error: false }); this.updateSubmit()
    this.showSubmitLoading()
    let response
    try { response = await books.start(seed) } catch (_) {} finally { this.hideSubmitLoading() }
    const result = books.result(response)
    const balance = response && response.statusCode === 402 && Number(response.data && response.data.suanli)
    const next = { sending: false, submitted: result.accepted, message: result.message, error: !result.accepted }
    if (Number.isFinite(balance)) { next.balance = balance; next.balanceDisplay = books.formatBalance(balance); next.shortfall = books.shortfall(balance, this.data.price) }
    this.setData(next); this.updateSubmit()
  },
  onUnload() { this.hideSubmitLoading() }
})
