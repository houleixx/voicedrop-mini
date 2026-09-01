const auth = require('../../services/auth')
const library = require('../../services/library')
const recordingUploads = require('../../services/recording-upload-queue')
const wechatAuth = require('../../services/wechat-auth')
const i18n = require('../../utils/i18n')

Page({
  data: {
    accountId: '',
    accountIdDisplay: '',
    token: '',
    maskedToken: '',
    importToken: '',
    showImportDialog: false,
    wechatAuthed: false,
    wechatLoggingIn: false,
    loginStatusText: '未登录微信',
    recordCount: 0,
    articleCount: 0
  },

  onShow() {
    this.refresh()
    this.loadStats()
  },

  async refresh() {
    const token = auth.anonymousBearer()
    const bearer = auth.bearer()
    const wechatAuthed = auth.isWechatAuthenticated()
    this.setData({
      accountId: '',
      accountIdDisplay: '',
      token,
      maskedToken: maskToken(token),
      wechatAuthed,
      loginStatusText: wechatAuthed ? '已用微信登录' : '未登录微信'
    })
    try {
      const scope = await library.ownerScope({ anonymous: true })
      if (auth.anonymousBearer() !== token || auth.bearer() !== bearer) return
      const accountId = accountIdFromScope(scope)
      this.setData({
        accountId,
        accountIdDisplay: accountId
      })
    } catch (error) {
      if (auth.anonymousBearer() === token && auth.bearer() === bearer) {
        this.setData({ accountId: '', accountIdDisplay: '' })
      }
    }
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
    if (this.data.accountId) wx.setClipboardData({ data: this.data.accountId })
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
      desc: i18n.ui('用于同步设备和参与社区'),
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
              this.completeWechatLogin(result)
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
      content: '是否切换到微信已绑定的云端空间？当前空间会保存在本机，退出微信登录后会恢复当前空间。',
      confirmText: '切换',
      cancelText: '保留当前',
      showCancel: true,
      success: (choice) => {
        if (choice.confirm) this.completeSwitchedWechatLogin(result)
      },
      fail: () => wx.showToast({ title: '账号切换提示打开失败', icon: 'none' })
    })
  },

  completeWechatLogin(result) {
    if (!auth.storeSession(result.session)) {
      wx.showModal({
        title: '微信登录失败',
        content: '无效会话',
        showCancel: false
      })
      return
    }
    wx.showToast({ title: '已登录' })
    this.refresh()
    this.loadStats()
  },

  completeSwitchedWechatLogin(result) {
    if (!auth.switchToWechatAccount(result.session)) {
      wx.showModal({
        title: '微信登录失败',
        content: '无效会话',
        showCancel: false
      })
      return
    }
    wx.showToast({ title: '已切换到微信空间' })
    wx.reLaunch({ url: '/pages/recordings/index' })
  },

  signOut() {
    auth.signOutWechat()
    this.refresh()
  },

  async deleteAccount() {
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '永久删除账户？',
        content: '将永久删除你的全部数据：云端录音、文章、照片、设置、社区分享和登录绑定，本机数据也会清空。此操作不可恢复。',
        confirmText: '永久删除',
        confirmColor: '#d8593b',
        cancelText: '取消',
        success: (result) => resolve(Boolean(result.confirm)),
        fail: () => resolve(false)
      })
    })
    if (!confirmed) return
    wx.showLoading({ title: '正在删除' })
    try {
      if (!await library.deleteAccount()) {
        wx.showToast({ title: '删除失败，请稍后再试', icon: 'none' })
        return
      }
      await recordingUploads.clearAll()
      auth.resetAnonymous()
      wx.showToast({ title: '账户已删除', icon: 'success' })
      wx.reLaunch({ url: '/pages/recordings/index' })
    } catch (_) {
      wx.showToast({ title: '删除失败，请稍后再试', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  }
})

function accountIdFromScope(scope) {
  return String(scope || '').trim().replace(/^users\//, '').replace(/\/$/, '')
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
