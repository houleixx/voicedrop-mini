const referral = require('../../services/referral')

Page({
  data: {
    loading: true,
    error: '',
    invite: null,
    rewardText: '朋友打开小程序，双方都得算力'
  },

  onLoad() {
    this.load()
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const invite = await referral.link()
      const sameReward = invite.suanliInviter > 0 && invite.suanliInviter === invite.suanliFriend
      this.setData({
        invite,
        rewardText: sameReward
          ? `朋友打开小程序，双方各得 ${invite.suanliInviter} 算力`
          : '朋友打开小程序，双方都得算力'
      })
    } catch (error) {
      this.setData({ error: error && error.message || '邀请链接加载失败' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onShareAppMessage() {
    const invite = this.data.invite || {}
    return {
      title: invite.name ? `${invite.name} 邀请你用 VoiceDrop` : '邀请你用 VoiceDrop',
      path: `/pages/recordings/index?inviteCode=${encodeURIComponent(invite.code || '')}`
    }
  },

  onShareTimeline() {
    const invite = this.data.invite || {}
    return {
      title: invite.name ? `${invite.name} 邀请你用 VoiceDrop` : '邀请你用 VoiceDrop',
      query: `inviteCode=${encodeURIComponent(invite.code || '')}`
    }
  },

  copyLink() {
    const url = this.data.invite && this.data.invite.url
    if (!url) return
    wx.setClipboardData({ data: url })
  }
})
