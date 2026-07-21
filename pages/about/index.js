const terms = require('../../utils/community-terms')
const blockStore = require('../../utils/block-store')
const audioConsent = require('../../utils/audio-consent')
const appVersion = require('../../utils/app-version')

Page({
  data: {
    supportEmail: terms.SUPPORT_EMAIL,
    blockedAuthors: [],
    audioConsentGranted: false,
    appVersion: '开发版'
  },

  onShow() {
    this.setData({
      blockedAuthors: blockStore.blockedList(),
      audioConsentGranted: audioConsent.isGranted(),
      appVersion: appVersion.label()
    })
  },

  privacy() {
    wx.showModal({
      title: '隐私说明',
      content: '录音、文章、图片、文风和公众号配置会按访问令牌同步到 VoiceDrop 后端。请妥善保存访问令牌。',
      showCancel: false
    })
  },

  communityTerms() {
    wx.showModal({
      title: '社区公约',
      content: terms.BODY,
      showCancel: false
    })
  },

  openAudioConsent() {
    wx.navigateTo({ url: '/pages/audio-consent/index' })
  },

  copyEmail() {
    wx.setClipboardData({ data: this.data.supportEmail })
  },

  unblock(event) {
    const author = event.currentTarget.dataset.author
    blockStore.unblock(author)
    this.setData({ blockedAuthors: blockStore.blockedList() })
    wx.showToast({ title: '已取消屏蔽' })
  }
})
