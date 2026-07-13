const terms = require('../../utils/community-terms')
const blockStore = require('../../utils/block-store')
const audioConsent = require('../../utils/audio-consent')

Page({
  data: {
    supportEmail: terms.SUPPORT_EMAIL,
    blockedAuthors: [],
    audioConsentGranted: false
  },

  onShow() {
    this.setData({
      blockedAuthors: blockStore.blockedList(),
      audioConsentGranted: audioConsent.isGranted()
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

  withdrawAudioConsent() {
    if (!this.data.audioConsentGranted) return
    wx.showModal({
      title: '撤回音频授权？',
      content: '撤回后，再次使用语音功能需要重新授权。已有录音和处理结果不会自动删除；你仍可删除单条录音，或在账户页注销并删除全部数据。',
      confirmText: '撤回',
      confirmColor: '#c7432f',
      success: (res) => {
        if (!res.confirm) return
        if (!audioConsent.revoke()) {
          wx.showToast({ title: '撤回失败，请重试', icon: 'none' })
          return
        }
        this.setData({ audioConsentGranted: false })
        wx.showToast({ title: '已撤回' })
      }
    })
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
