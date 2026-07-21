const settings = require('../../services/settings')
const auth = require('../../services/auth')
const usage = require('../../services/usage')
const prefs = require('../../utils/prefs')
const appVersion = require('../../utils/app-version')

Page({
  data: {
    style: '',
    stylePreview: '',
    profileName: '',
    nameInput: '',
    nameEditorOpen: false,
    nameSaving: false,
    nameKeyboardHeight: 0,
    balance: null,
    capacity: 0,
    shortAnonId: '',
    autoShareCommunity: false,
    followUpEnabled: true,
    wechatConfigured: false,
    appVersion: '开发版'
  },

  onShow() {
    this.load()
  },

  onShareAppMessage() {
    return {
      title: 'VoiceDrop 设置',
      path: '/pages/settings/index'
    }
  },

  onShareTimeline() {
    return {
      title: 'VoiceDrop 设置',
      query: ''
    }
  },

  async load() {
    this.setData({ appVersion: appVersion.label() })
    try {
      const [styleResult, configResult, balanceResult, wechatResult] = await Promise.all([
        settings.loadStyle(),
        settings.loadConfig(),
        usage.balance(),
        settings.loadWechat()
      ])

      const anonId = auth.anonId()
      const shortId = anonId ? anonId.slice(-6).toUpperCase() : ''

      this.setData({
        style: styleResult.style || '',
        stylePreview: styleResult.style ? styleResult.style.slice(0, 20) : '',
        profileName: styleResult.name || '',
        nameInput: styleResult.name || '',
        balance: balanceResult,
        capacity: usage.articleCapacity(balanceResult.suanli || 0),
        shortAnonId: shortId,
        autoShareCommunity: Boolean(configResult.autoShareCommunity),
        followUpEnabled: prefs.followUpEnabled(),
        wechatConfigured: !!(wechatResult && wechatResult.appid && wechatResult.secret)
      })
    } catch (error) {
      wx.showToast({ title: '加载失败', icon: 'error' })
    }
  },

  toggleAutoShare(event) {
    const autoShareCommunity = event.detail.value
    this.setData({ autoShareCommunity })
    settings.saveConfig(autoShareCommunity)
  },

  toggleFollowUp(event) {
    const followUpEnabled = event.detail.value
    prefs.setFollowUpEnabled(followUpEnabled)
    this.setData({ followUpEnabled })
  },

  openNameEditor() {
    this.setData({
      nameEditorOpen: true,
      nameInput: this.data.profileName || ''
    })
  },

  closeNameEditor() {
    if (this.data.nameSaving) return
    this.setData({
      nameEditorOpen: false,
      nameInput: this.data.profileName || '',
      nameKeyboardHeight: 0
    })
  },

  preventNameEditorClose() {
    // Keep taps inside the dialog from closing the overlay.
  },

  onNameInput(event) {
    this.setData({ nameInput: event.detail.value })
  },

  onNameKeyboardHeightChange(event) {
    const height = Number(event && event.detail && event.detail.height) || 0
    this.setData({ nameKeyboardHeight: Math.max(0, height) })
  },

  async saveName() {
    if (this.data.nameSaving) return
    const name = String(this.data.nameInput || '').trim().slice(0, 20)
    this.setData({ nameSaving: true })
    try {
      const ok = await settings.saveName(name)
      if (!ok) throw new Error('save name failed')
      this.setData({
        profileName: name,
        nameInput: name,
        nameEditorOpen: false,
        nameKeyboardHeight: 0,
        nameSaving: false
      })
      wx.showToast({ title: '名字已保存', icon: 'success' })
    } catch (error) {
      this.setData({ nameSaving: false })
      wx.showToast({ title: '名字保存失败', icon: 'error' })
    }
  },

  openPage(event) {
    wx.navigateTo({ url: event.currentTarget.dataset.url })
  }
})
