const blockStore = require('../../utils/block-store')

function markCommunityDirty() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null
    if (app && app.globalData) app.globalData.communityFeedDirty = true
  } catch (_) {
  }
}

Page({
  data: {
    blockedAuthors: []
  },

  onShow() {
    this.setData({ blockedAuthors: blockStore.blockedList() })
  },

  unblock(event) {
    const author = event.currentTarget.dataset.author
    if (!author) return

    blockStore.unblock(author)
    markCommunityDirty()
    this.setData({ blockedAuthors: blockStore.blockedList() })
    wx.showToast({ title: '已取消屏蔽' })
  }
})
