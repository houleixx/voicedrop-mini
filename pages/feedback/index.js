const settings = require('../../services/settings')
const appVersion = require('../../utils/app-version')

Page({
  data: { draft: '', sending: false, failed: false },
  onInput(event) { this.setData({ draft: String(event.detail.value || '').slice(0, 2000), failed: false }) },
  async send() {
    const text = this.data.draft.trim()
    if (!text || this.data.sending) return
    this.setData({ sending: true, failed: false })
    wx.showLoading({ title: '提交中…', mask: true })
    let ok = false
    try {
      const profile = await settings.loadStyle()
      ok = await settings.sendFeedback(text, profile.name || '', appVersion.label())
    } catch (_) {
      ok = false
    } finally {
      wx.hideLoading()
    }
    if (ok) {
      this.setData({ sending: false })
      wx.navigateBack({
        delta: 1,
        success() {
          wx.showToast({ title: '提交成功', icon: 'success' })
        }
      })
      return
    }
    this.setData({ sending: false, failed: true })
  }
})
