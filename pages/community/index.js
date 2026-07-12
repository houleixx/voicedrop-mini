Page({
  onLoad() {
    this.openHomeCommunity()
  },

  onShow() {
    this.openHomeCommunity()
  },

  openHomeCommunity() {
    if (this.redirecting) return
    this.redirecting = true
    wx.redirectTo({ url: '/pages/recordings/index?tab=community' })
  },

  onShareAppMessage() {
    return {
      title: 'VD社区',
      path: '/pages/recordings/index?tab=community'
    }
  },

  onShareTimeline() {
    return {
      title: 'VD社区',
      query: 'tab=community'
    }
  }
})
