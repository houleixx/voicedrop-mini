const settings = require('../../services/settings')

Page({
  data: {
    appid: '',
    secret: '',
    enabled: false,
    secretHidden: true,
    canSave: false,
    saving: false,
    savedWechat: false,
    wechatConfigured: false
  },

  onLoad() {
    this.load()
  },

  async load() {
    const config = await settings.loadWechat()
    const appid = config.appid || ''
    const secret = config.secret || ''
    this.setData({
      appid,
      secret,
      enabled: Boolean(config.enabled),
      secretHidden: true,
      canSave: !settings.validateWechatCreds(appid, secret),
      savedWechat: false,
      wechatConfigured: this.hasWechatCredentials(appid, secret)
    })
  },

  toggleSecret() {
    this.setData({ secretHidden: !this.data.secretHidden })
  },

  onInput(event) {
    const next = {
      [event.currentTarget.dataset.key]: event.detail.value
    }
    this.setData(next)
    this.refreshFormState({ savedWechat: false })
  },

  onEnabled(event) {
    this.setData({ enabled: event.detail.value, savedWechat: false })
  },

  refreshCanSave() {
    this.refreshFormState()
  },

  refreshConfigured() {
    this.setData({
      wechatConfigured: this.hasWechatCredentials(this.data.appid, this.data.secret)
    })
  },

  refreshFormState(extra) {
    this.setData({
      canSave: !settings.validateWechatCreds(this.data.appid, this.data.secret),
      wechatConfigured: this.hasWechatCredentials(this.data.appid, this.data.secret),
      ...(extra || {})
    })
  },

  hasWechatCredentials(appid, secret) {
    return !!String(appid || '').trim() && !!String(secret || '').trim()
  },

  async save() {
    if (this.data.saving) return
    const appid = String(this.data.appid || '').trim()
    const secret = String(this.data.secret || '').trim()
    const message = settings.validateWechatCreds(appid, secret)
    if (message) {
      this.setData({ canSave: false, savedWechat: false })
      wx.showToast({ title: message, icon: 'error' })
      return
    }
    this.setData({ saving: true, canSave: false, savedWechat: false })
    try {
      const ok = await settings.saveWechat(appid, secret, this.data.enabled)
      if (ok) {
        this.setData({ appid, secret, savedWechat: true, wechatConfigured: true })
      }
      wx.showToast({ title: ok ? '已保存' : '保存失败', icon: ok ? 'success' : 'error' })
    } finally {
      this.setData({ saving: false })
      this.refreshCanSave()
    }
  },

  async disconnectWechat() {
    if (this.data.saving) return
    this.setData({ saving: true, savedWechat: false })
    try {
      const ok = await settings.saveWechat('', '', false)
      if (ok) {
        this.setData({
          appid: '',
          secret: '',
          enabled: false,
          canSave: false,
          wechatConfigured: false,
          savedWechat: true
        })
      }
      wx.showToast({ title: ok ? '已断开' : '保存失败', icon: ok ? 'success' : 'error' })
    } finally {
      this.setData({ saving: false })
    }
  },

  copyHelpLink() {
    wx.setClipboardData({ data: settings.WECHAT_CREDENTIAL_HELP_URL })
  },

  copyIp() {
    wx.setClipboardData({ data: '66.42.45.128' })
  }
})
