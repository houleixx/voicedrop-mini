const publicShare = require('../../services/public-share')
const library = require('../../services/library')
const articleUtil = require('../../utils/article')
const capsuleLayout = require('../../utils/capsule-layout')

function clampSection(value, articles) {
  const index = Number(value) || 0
  return Math.max(0, Math.min(index, Math.max(0, articles.length - 1)))
}

Page({
  data: {
    shareId: '', article: null, blocks: [], loading: true, error: '', section: 0,
    moreMenuOpen: false, toolbarTop: 0, toolbarHeight: 64,
    capsuleSafeRightPx: capsuleLayout.FALLBACK_SAFE_RIGHT_PX
  },

  onLoad(options) {
    this.openedFromShare = String(options.fromShare || '') === '1'
    const sysInfo = wx.getSystemInfoSync()
    const statusBarHeight = (sysInfo && sysInfo.statusBarHeight) || 0
    let toolbarTop = statusBarHeight
    let toolbarHeight = 64
    let capsuleSafeRightPx = capsuleLayout.FALLBACK_SAFE_RIGHT_PX
    try {
      const menu = wx.getMenuButtonBoundingClientRect()
      if (menu && menu.top != null && menu.height) {
        toolbarTop = menu.top
        toolbarHeight = menu.height
        capsuleSafeRightPx = capsuleLayout.safeRightPx(sysInfo, menu)
      }
    } catch (_) {}
    this.setData({
      shareId: decodeURIComponent(options.shareId || ''), section: Number(options.section) || 0,
      toolbarTop, toolbarHeight, capsuleSafeRightPx
    })
    this.load()
  },

  async load() {
    const result = await publicShare.read(this.data.shareId)
    if (!result.ok) {
      this.setData({ loading: false, error: '这篇分享已失效或暂不可读' })
      return
    }
    const index = clampSection(this.data.section, result.doc.articles)
    const current = result.doc.articles[index]
    const blocks = articleUtil.bodyBlocks(current.body).map((block) => {
      if (block.type !== 'photo') return block
      const key = articleUtil.resolvePhotoKey(block.key, result.doc.photos) || block.key
      return Object.assign({}, block, { key, url: library.photoUrl(key, result.doc.owner) })
    })
    this.setData({ loading: false, article: current, blocks, section: index })
  },

  onShareAppMessage() {
    if (this.data.moreMenuOpen && this.setData) this.setData({ moreMenuOpen: false })
    const cover = (this.data.blocks || []).find((block) => block && block.type === 'photo' && block.url)
    const payload = {
      title: this.data.article && this.data.article.title || 'VoiceDrop 文章',
      path: `/pages/shared-article/index?shareId=${encodeURIComponent(this.data.shareId)}&section=${this.data.section || 0}&fromShare=1`
    }
    if (cover) payload.imageUrl = cover.url
    return payload
  },

  onShareTimeline() {
    return {
      title: this.data.article && this.data.article.title || 'VoiceDrop 文章',
      query: `shareId=${encodeURIComponent(this.data.shareId)}&section=${this.data.section || 0}&fromShare=1`
    }
  },

  goBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (this.openedFromShare || !pages || pages.length <= 1) {
      wx.reLaunch({ url: '/pages/recordings/index' })
      return
    }
    wx.navigateBack()
  },

  showMoreActions() { this.setData({ moreMenuOpen: true }) },
  closeMoreMenu() { this.setData({ moreMenuOpen: false }) },
  noop() {}
})
