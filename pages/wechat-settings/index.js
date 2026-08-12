const settings = require('../../services/settings')

Page({
  data: {
    loading: true,
    connecting: false,
    disconnecting: false,
    connected: false,
    accountName: '',
    authorizerAppid: ''
  },

  onShow() {
    this.refreshStatus()
  },

  async refreshStatus() {
    this.setData({ loading: true })
    try {
      const status = await settings.wechatBindStatus()
      this.setData({
        connected: status.connected,
        accountName: status.accountName || '',
        authorizerAppid: status.authorizerAppid || ''
      })
    } catch (_) {
      this.setData({ connected: false, accountName: '', authorizerAppid: '' })
      wx.showToast({ title: '连接状态加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async connectWechat() {
    if (this.data.connecting || this.data.disconnecting) return
    this.setData({ connecting: true })
    wx.showLoading({ title: '正在生成链接' })
    try {
      const scanUrl = await settings.createWechatAuthorization()
      if (!scanUrl) {
        wx.showToast({ title: '暂时无法生成授权链接', icon: 'none' })
        return
      }
      wx.setClipboardData({
        data: scanUrl,
        success: () => wx.showToast({ title: '授权链接已复制', icon: 'success' }),
        fail: () => wx.showToast({ title: '授权链接复制失败，请重试', icon: 'none' })
      })
    } catch (_) {
      wx.showToast({ title: '暂时无法生成授权链接', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ connecting: false })
    }
  },

  async disconnectWechat() {
    if (this.data.connecting || this.data.disconnecting) return
    this.setData({ disconnecting: true })
    try {
      const ok = await settings.unbindWechat()
      if (!ok) {
        wx.showToast({ title: '取消连接失败', icon: 'none' })
        return
      }
      wx.showToast({ title: '已取消公众号连接', icon: 'success' })
      await this.refreshStatus()
    } catch (_) {
      wx.showToast({ title: '取消连接失败', icon: 'none' })
    } finally {
      this.setData({ disconnecting: false })
    }
  }
})
