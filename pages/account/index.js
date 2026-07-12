const auth = require('../../services/auth')
const deviceLink = require('../../services/device-link')
const library = require('../../services/library')
const wechatAuth = require('../../services/wechat-auth')

Page({
  data: {
    anonId: '',
    accountIdDisplay: '',
    token: '',
    maskedToken: '',
    importToken: '',
    showImportDialog: false,
    wechatAuthed: false,
    wechatLoggingIn: false,
    loginStatusText: '未登录微信',
    recordCount: 0,
    articleCount: 0,
    pairing: null,
    pairingCode: ''
  },

  onShow() {
    this.refresh()
    this.loadStats()
  },

  refresh() {
    const token = auth.bearer()
    const wechatAuthed = auth.isWechatAuthenticated()
    this.setData({
      anonId: auth.anonId(),
      accountIdDisplay: displayAccountId(token),
      token,
      maskedToken: maskToken(token),
      wechatAuthed,
      loginStatusText: wechatAuthed ? '已用微信登录' : '未登录微信'
    })
  },

  async loadStats() {
    try {
      const records = await library.list()
      this.setData({
        recordCount: records.length,
        articleCount: records.filter((record) => record.hasArticles).length
      })
    } catch (error) {
    }
  },

  copyId() {
    wx.setClipboardData({ data: this.data.anonId })
  },

  copyToken() {
    wx.setClipboardData({ data: this.data.token })
  },

  openImportDialog() {
    this.setData({ showImportDialog: true })
  },

  onImportInput(event) {
    this.setData({ importToken: event.detail.value })
  },

  confirmImport() {
    const token = this.data.importToken.trim()
    const ok = auth.adoptToken(token)
    if (ok) {
      wx.showToast({ title: '已切换到已有账号', icon: 'success' })
      this.setData({ showImportDialog: false, importToken: '' })
      this.refresh()
      this.loadStats()
    } else {
      wx.showModal({
        title: '提示',
        content: '请粘贴以 anon_ 开头的访问令牌',
        showCancel: false
      })
    }
  },

  cancelImport() {
    this.setData({ showImportDialog: false, importToken: '' })
  },

  preventClose() {
    // Prevent tap inside card from closing dialog
  },

  wechatLogin() {
    if (this.data.wechatLoggingIn) return
    const startLogin = (userInfo) => this.exchangeWechat(userInfo || {})
    if (!wx.getUserProfile) {
      startLogin({})
      return
    }
    wx.getUserProfile({
      desc: '用于同步设备和参与社区',
      success: (profile) => startLogin(profile.userInfo || {}),
      fail: () => startLogin({})
    })
  },

  exchangeWechat(userInfo) {
    if (this.data.wechatLoggingIn) return
    this.setData({
      wechatLoggingIn: true,
      loginStatusText: '正在登录微信...'
    })
    wx.login({
      success: async (login) => {
        try {
          const result = await wechatAuth.exchangeCode(login.code, userInfo.nickName, userInfo.avatarUrl)
          if (result.ok) {
            const currentScope = await library.ownerScope({ anonymous: true })
            if (!currentScope) throw new Error('无法确认当前账号空间')
            if (normalizeScope(currentScope) === normalizeScope(result.scope)) {
              this.completeWechatLogin(result, false)
            } else {
              this.confirmWechatAccountSwitch(result)
            }
          } else {
            wx.showModal({
              title: '微信登录失败',
              content: result.detail || result.error || '登录失败',
              showCancel: false
            })
          }
        } catch (error) {
          wx.showModal({
            title: '微信登录失败',
            content: error && error.message || '登录失败',
            showCancel: false
          })
        } finally {
          this.setData({ wechatLoggingIn: false })
          this.refresh()
        }
      },
      fail: () => {
        this.setData({ wechatLoggingIn: false })
        this.refresh()
        wx.showToast({ title: '登录失败', icon: 'error' })
      }
    })
  },

  confirmWechatAccountSwitch(result) {
    wx.showModal({
      title: '该微信已关联另一个云端空间',
      content: '切换后将显示微信账号中的录音和文章。当前匿名账号的数据不会删除，退出微信登录后可以恢复。',
      confirmText: '切换账号',
      cancelText: '保留当前',
      success: (res) => {
        if (res.confirm) this.completeWechatLogin(result, true)
      },
      fail: () => wx.showToast({ title: '账号切换提示打开失败', icon: 'none' })
    })
  },

  completeWechatLogin(result, switched) {
    if (!auth.storeSession(result.session)) {
      wx.showModal({
        title: '微信登录失败',
        content: '无效会话',
        showCancel: false
      })
      return
    }
    if (switched) {
      wx.reLaunch({
        url: '/pages/recordings/index',
        success: () => wx.showToast({ title: '已切换到微信账号，请重新选择文章分享', icon: 'none' })
      })
      return
    }
    wx.showToast({ title: '已登录' })
    this.refresh()
    this.loadStats()
  },

  signOut() {
    auth.signOutWechat()
    this.refresh()
  },

  deleteAccount() {
    wx.showModal({
      title: '删除账户',
      content: '当前小程序端还没有接入永久删除接口。请先保留访问令牌，避免数据丢失。',
      confirmText: '知道了',
      showCancel: false
    })
  },

  async startDeviceLink() {
    try {
      const pairing = await deviceLink.start(auth.anonId(), 'mini-program')
      this.setData({ pairing })
      wx.showModal({
        title: '设备登录请求',
        content: `配对已发起。\n\n验证码：${pairing.code || pairing.pairingCode || '请查看另一台设备'}`,
        showCancel: false
      })
    } catch (error) {
      wx.showToast({ title: '发起失败', icon: 'error' })
    }
  },

  onPairingCodeInput(event) {
    this.setData({ pairingCode: event.detail.value })
  },

  async verifyDeviceLink() {
    if (!this.data.pairing || !this.data.pairingCode) return
    try {
      await deviceLink.verify(this.data.pairing.pairingId || this.data.pairing.id, this.data.pairingCode)
      wx.showToast({ title: '验证成功' })
    } catch (error) {
      wx.showToast({ title: '验证失败', icon: 'error' })
    }
  },

  async cancelDeviceLink() {
    if (this.data.pairing) await deviceLink.cancel(this.data.pairing.pairingId || this.data.pairing.id)
    this.setData({ pairing: null, pairingCode: '' })
  }
})

function displayAccountId(token) {
  const value = String(token || '').replace(/^anon_/, 'anon-')
  if (value.length <= 34) return value
  return `${value.slice(0, 18)}...${value.slice(-16)}`
}

function maskToken(token) {
  const value = String(token || '')
  if (value.length <= 18) return value
  return `${value.slice(0, 9)}••••••${value.slice(-6)}`
}

function normalizeScope(scope) {
  const value = String(scope || '').trim()
  if (!value) return ''
  return value.endsWith('/') ? value : `${value}/`
}
