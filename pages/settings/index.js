const settings = require('../../services/settings')
const auth = require('../../services/auth')
const library = require('../../services/library')
const usage = require('../../services/usage')
const prefs = require('../../utils/prefs')
const appVersion = require('../../utils/app-version')
const cacheMaintenance = require('../../services/cache-maintenance')
const i18n = require('../../utils/i18n')

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
    // Keep the first rendered value in sync with the selected app language.
    // `load()` refreshes this after the account checks complete, but a literal
    // Chinese fallback visibly flashes before that work finishes in English.
    accountSubtitle: accountSubtitleFor(false),
    autoShareCommunity: false,
    followUpEnabled: true,
    wechatConfigured: false,
    cacheSizeText: '计算中',
    cacheCalculating: false,
    cacheClearing: false,
    joinCommunityUrl: 'https://work.weixin.qq.com/gm/28a6505fcd2fa4dd94b3b08f34fb2c5a',
    joinCommunityOpen: false,
    languageLabel: '跟随系统',
    appVersion: '开发版'
  },

  onShow() {
    this._settingsVisible = true
    this._settingsLifecycleGeneration = (this._settingsLifecycleGeneration || 0) + 1
    this.setData({ cacheClearing: false })
    this.refreshCacheSize()
    this.load()
  },

  onHide() {
    this.leaveSettingsPage()
  },

  onUnload() {
    this.leaveSettingsPage()
  },

  onLanguageChanged() {
    this.setData({
      languageLabel: i18n.languageLabel(i18n.selectedLanguage()),
      accountSubtitle: accountSubtitleFor(auth.isWechatAuthenticated()),
      appVersion: appVersion.label()
    })
  },

  leaveSettingsPage() {
    this._settingsVisible = false
    this._settingsLifecycleGeneration = (this._settingsLifecycleGeneration || 0) + 1
    this._cacheSizeRequest = (this._cacheSizeRequest || 0) + 1
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
      const [styleResult, configResult, balanceResult, wechatResult, anonymousScope] = await Promise.all([
        settings.loadStyle(),
        settings.loadConfig(),
        usage.balance(),
        settings.wechatBindStatus(),
        library.ownerScope({ anonymous: true }).catch(() => '')
      ])

      const wechatAuthed = auth.isWechatAuthenticated()
      const shortId = wechatAuthed ? '' : accountShortCode(anonymousScope)

      this.setData({
        style: styleResult.style || '',
        stylePreview: styleResult.style ? styleResult.style.slice(0, 20) : '',
        profileName: styleResult.name || '',
        nameInput: styleResult.name || '',
        balance: balanceResult,
        capacity: usage.articleCapacity(balanceResult.suanli || 0),
        shortAnonId: shortId,
        accountSubtitle: accountSubtitleFor(wechatAuthed),
        autoShareCommunity: Boolean(configResult.autoShareCommunity),
        followUpEnabled: prefs.followUpEnabled(),
        languageLabel: i18n.languageLabel(i18n.selectedLanguage()),
        wechatConfigured: Boolean(wechatResult && wechatResult.connected)
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

  openJoinCommunity() {
    this.setData({ joinCommunityOpen: true })
  },

  closeJoinCommunity() {
    this.setData({ joinCommunityOpen: false })
  },

  preventJoinCommunityClose() {
    // Keep taps inside the dialog from closing the overlay.
  },

  onJoinCommunityComplete(event) {
    const result = event && event.detail || {}
    const errcode = Number(result.errcode)
    if (!errcode || errcode === -3006) return
    wx.showToast({ title: joinCommunityErrorMessage(errcode), icon: 'none' })
  },

  onNameInput(event) {
    this.setData({ nameInput: event.detail.value })
  },

  onNameKeyboardHeightChange(event) {
    const height = Number(event && event.detail && event.detail.height) || 0
    const screenWidth = wx.getSystemInfoSync().windowWidth
    const rpxRatio = 750 / screenWidth
    this.setData({ nameKeyboardHeight: Math.max(0, Math.round(height * rpxRatio)) })
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

  async refreshCacheSize() {
    const request = (this._cacheSizeRequest || 0) + 1
    const lifecycle = this._settingsLifecycleGeneration || 0
    this._cacheSizeRequest = request
    this.setData({ cacheCalculating: true, cacheSizeText: '计算中' })
    try {
      const result = await cacheMaintenance.snapshot()
      if (!cacheUiActive(this, lifecycle, request)) return
      this.setData({ cacheCalculating: false, cacheSizeText: cacheMaintenance.formatBytes(result.bytes) })
    } catch (_) {
      if (cacheUiActive(this, lifecycle, request)) this.setData({ cacheCalculating: false, cacheSizeText: '暂不可用' })
    }
  },

  clearCache() {
    if (this.data.cacheClearing) return
    const lifecycle = this._settingsLifecycleGeneration || 0
    wx.showModal({
      title: '清除缓存？',
      content: '将清除可重新下载的文章、图片和社区详情缓存。不会删除录音、待上传内容、账户信息或服务器数据。',
      confirmText: '清除',
      confirmColor: '#d8593b',
      success: async (result) => {
        if (!result.confirm || this.data.cacheClearing || !cacheUiActive(this, lifecycle)) return
        this.setData({ cacheClearing: true, cacheCalculating: true, cacheSizeText: '计算中' })
        try {
          await cacheMaintenance.clear()
          if (!cacheUiActive(this, lifecycle)) return
          await this.refreshCacheSize()
          if (!cacheUiActive(this, lifecycle)) return
          wx.showToast({ title: '缓存已清除', icon: 'success' })
        } catch (_) {
          if (!cacheUiActive(this, lifecycle)) return
          await this.refreshCacheSize()
          if (!cacheUiActive(this, lifecycle)) return
          wx.showToast({ title: '清除失败，请重试', icon: 'none' })
        } finally {
          if (cacheUiActive(this, lifecycle)) this.setData({ cacheClearing: false })
        }
      }
    })
  },

  openPage(event) {
    wx.navigateTo({ url: event.currentTarget.dataset.url })
  }
})

function accountShortCode(scope) {
  const match = String(scope || '').trim().match(/^users\/anon-([0-9a-f]{6,})\/$/i)
  return match ? match[1].slice(0, 6).toUpperCase() : ''
}

function accountSubtitleFor(wechatAuthed) {
  return i18n.ui(wechatAuthed ? '已登录微信账号' : '匿名 ID 保存在本机')
}

function cacheUiActive(page, lifecycle, request) {
  if (page._settingsVisible === false) return false
  if ((page._settingsLifecycleGeneration || 0) !== lifecycle) return false
  return request == null || page._cacheSizeRequest === request
}

function joinCommunityErrorMessage(errcode) {
  const messages = {
    '-3009': '群聊已满员',
    '-3010': '群聊已解散',
    '-3011': '暂无法加入该群'
  }
  return messages[String(errcode)] || '加入社群失败，请重试'
}
