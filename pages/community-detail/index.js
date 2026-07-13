const community = require('../../services/community')
const library = require('../../services/library')
const audio = require('../../services/audio')
const articleUtil = require('../../utils/article')
const blockStore = require('../../utils/block-store')
const communityReply = require('../../utils/community-reply')
const pendingReplies = require('../../utils/pending-replies')
const prefs = require('../../utils/prefs')
const api = require('../../services/api')

const app = getApp()
const REPLY_WAVE_PATTERN = [0.25, 0.62, 0.38, 0.9, 0.48, 0.72, 0.34, 0.58]

function suanliText(value) {
  const number = Number(value) || 0
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

Page({
  data: {
    shareId: '',
    post: null,
    article: null,
    blocks: [],
    sections: [],
    replies: [],
    replyToPost: null,
    liked: false,
    loading: true,
    moreMenuOpen: false,
    toolbarTop: 0,
    toolbarHeight: 64,
    replyRecording: false,
    replyUploading: false,
    replyTimerDisplay: '00:00',
    replyWaveBars: REPLY_WAVE_PATTERN.map(() => 10)
  },

  onLoad(options) {
    const shareId = decodeURIComponent(options.shareId || '')
    const post = app.globalData.currentCommunityPost
    const initialPost = post && (!shareId || post.shareId === shareId) ? post : null
    const sysInfo = wx.getSystemInfoSync()
    const statusBarHeight = (sysInfo && sysInfo.statusBarHeight) || 0
    let toolbarTop = statusBarHeight
    let toolbarHeight = 64
    try {
      const menu = wx.getMenuButtonBoundingClientRect()
      if (menu && menu.top != null && menu.height) {
        toolbarTop = menu.top
        toolbarHeight = menu.height
      }
    } catch (_) {
    }
    this.setData({ shareId, post: initialPost, toolbarTop, toolbarHeight })
    this.setData({ liked: prefs.likedCommunityPost(this.data.shareId || (post && post.shareId)) })
    this.bindReplyRecorder()
    this.load()
  },

  onUnload() {
    this.clearReplyTimer()
    const active = app.globalData.activeRecorderSession || {}
    if (active.type === 'community-reply' && active.id === this._replySessionId) {
      this._replyCanceled = true
      app.globalData.activeRecorderSession = null
      audio.stop()
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.article && this.data.article.title || this.data.post && this.data.post.title || '社区文章',
      path: `/pages/community-detail/index?shareId=${encodeURIComponent(this.data.shareId || '')}`
    }
  },

  onShareTimeline() {
    return {
      title: this.data.article && this.data.article.title || this.data.post && this.data.post.title || '社区文章',
      query: `shareId=${encodeURIComponent(this.data.shareId || '')}`
    }
  },

  goBack() {
    if (this.data.replyRecording) {
      this.cancelReplyRecording()
      return
    }
    wx.navigateBack()
  },

  showMoreActions() {
    this.setData({ moreMenuOpen: true })
  },

  closeMoreMenu() {
    this.setData({ moreMenuOpen: false })
  },

  noop() {},

  async runMoreMenuAction(event) {
    const action = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.action
    const actions = {
      reply: () => this.reply(),
      report: () => this.report(),
      blockAuthor: () => this.blockAuthor()
    }
    this.setData({ moreMenuOpen: false })
    if (actions[action]) await actions[action]()
  },

  async load() {
    const shareId = this.data.shareId || (this.data.post && this.data.post.shareId)
    if (!shareId) {
      this.setData({ loading: false })
      return
    }
    this.setData({ loading: true })
    try {
      const cachedPost = this.data.post ? community.postFromDetail(this.data.post) : null
      const fullPost = await community.get(shareId).catch(() => null)
      const post = community.postFromDetail(fullPost || cachedPost)
      let doc = post.doc
      if ((!doc || !doc.articles || !doc.articles.length) && post.articleKey) {
        doc = await library.fetchDocByArticleKey(post.articleKey)
      }
      const first = articleUtil.firstArticle(doc)
      const sections = this.articleSections(post, doc)
      const replies = await this.loadFullReplies(shareId)
      const replyToPost = post && post.replyTo ? await community.get(post.replyTo) : null
      this.setData({
        post,
        article: first,
        blocks: sections.length ? sections[0].blocks : [],
        sections,
        replies,
        replyToPost
      })
      community.engage(shareId, 'view')
    } finally {
      this.setData({ loading: false })
    }
  },

  articleSections(post, doc) {
    if (!doc || !doc.articles || !doc.articles.length) return []
    return doc.articles.map((article) => ({
      title: article.title && article.title !== post.title ? article.title : '',
      blocks: articleUtil.bodyBlocks(article.body).map((block) => {
        if (block.type !== 'photo') return block
        const key = articleUtil.resolvePhotoKey(block.key, doc.photos || []) || block.key
        return Object.assign({}, block, {
          key,
          url: library.photoUrl(key, doc.owner)
        })
      })
    }))
  },

  async loadFullReplies(shareId) {
    const replies = await community.replies(shareId)
    const full = await Promise.all(replies.map(async (reply) => {
      if (reply.doc && reply.doc.articles && reply.doc.articles.length) return reply
      return await community.get(reply.shareId).catch(() => null) || reply
    }))
    return full.map((reply) => communityReply.viewModel(reply))
  },

  toggleLike() {
    const liked = !this.data.liked
    this.setData({ liked })
    prefs.setLikedCommunityPost(this.data.shareId, liked)
    community.engage(this.data.shareId, 'like', liked)
  },

  async tip() {
    try {
      const result = await community.feed(this.data.shareId)
      if (result.ok || result.already) {
        if (result.already) {
          wx.showToast({ title: '已经投过这篇了' })
        } else {
          wx.showToast({ title: `已投币：你 +${suanliText(result.feederSuanli)}，作者 +${suanliText(result.authorSuanli)} 算力` })
        }
      } else if (result.error === 'cannot_feed_own') {
        wx.showToast({ title: '不能给自己的文章投币' })
      } else if (result.error === 'pool_exhausted') {
        wx.showToast({ title: '今日算力池已发完，明天再来' })
      } else if (result.needsWechatSignin) {
        wx.showToast({ title: '投币需要先用微信登录' })
      } else {
        wx.showToast({ title: '投币失败，稍后再试', icon: 'none' })
      }
    } catch (error) {
      wx.showToast({ title: `投币失败：${error && error.message || '网络错误'}`, icon: 'none' })
    }
  },

  suanliText(value) {
    return suanliText(value)
  },

  report() {
    wx.showModal({
      title: '举报这篇分享？',
      content: '举报后这篇会立即从社区下架，并在 24 小时内由人工审核处理。',
      confirmText: '举报',
      confirmColor: '#c7432f',
      success: async (res) => {
        if (!res.confirm) return
        const ok = await community.report(this.data.shareId)
        if (ok) {
          wx.showToast({ title: '已举报，内容已下架待审核' })
          wx.navigateBack()
        } else {
          wx.showToast({ title: '举报失败', icon: 'error' })
        }
      }
    })
  },

  reply() {
    return this.startReplyRecording()
  },

  requestAudioConsent() {
    const dialog = this.selectComponent && this.selectComponent('#audio-consent-dialog')
    return dialog && dialog.request ? dialog.request() : Promise.resolve(false)
  },

  async startReplyRecording() {
    const shareId = this.data.shareId || (this.data.post && this.data.post.shareId)
    if (!shareId || this.data.replyRecording || this.data.replyUploading) return
    if (!await this.requestAudioConsent()) return
    wx.authorize({
      scope: 'scope.record',
      complete: (res) => {
        if (res.errMsg && res.errMsg.indexOf('authorize:ok') < 0) {
          wx.showModal({
            title: '需要录音权限',
            content: '请允许使用麦克风写回应',
            confirmText: '去设置',
            success: (modalRes) => {
              if (modalRes.confirm) wx.openSetting()
            }
          })
          return
        }
        this.beginReplyRecording(shareId)
      }
    })
  },

  beginReplyRecording(shareId) {
    this._replySessionId = `community-reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this._replyToShareId = shareId
    this._replyStartedAt = Date.now()
    app.globalData.activeRecorderSession = { type: 'community-reply', id: this._replySessionId }
    this.setData({
      replyRecording: true,
      replyUploading: false,
      replyTimerDisplay: '00:00',
      replyWaveBars: REPLY_WAVE_PATTERN.map(() => 10)
    })
    this.startReplyTimer()
    audio.start()
  },

  bindReplyRecorder() {
    const manager = audio.recorder()
    manager.onStop((res) => {
      const active = app.globalData.activeRecorderSession || {}
      if (active.type !== 'community-reply' || active.id !== this._replySessionId) return
      app.globalData.activeRecorderSession = null
      this.finishReplyRecording(res)
    })
    manager.onError(() => {
      const active = app.globalData.activeRecorderSession || {}
      if (active.type !== 'community-reply' || active.id !== this._replySessionId) return
      app.globalData.activeRecorderSession = null
      this.clearReplyTimer()
      this._replyToShareId = null
      this.setData({ replyRecording: false, replyUploading: false })
      wx.showToast({ title: '录音失败', icon: 'error' })
    })
  },

  stopReplyRecording() {
    if (!this.data.replyRecording || this.data.replyUploading) return
    audio.stop()
  },

  cancelReplyRecording() {
    if (!this.data.replyRecording || this.data.replyUploading) return
    this._replyCanceled = true
    this.clearReplyTimer()
    audio.stop()
  },

  async finishReplyRecording(res) {
    this.clearReplyTimer()
    const replyTo = this._replyToShareId
    const startedAt = this._replyStartedAt || Date.now()
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
    const name = audio.nameForSession(new Date(startedAt), elapsed)
    this._replyToShareId = null

    if (this._replyCanceled) {
      this._replyCanceled = false
      this.setData({ replyRecording: false, replyUploading: false })
      return
    }

    this.setData({ replyUploading: true })
    try {
      await audio.uploadFile(res.tempFilePath, name)
      if (replyTo) pendingReplies.put(name, replyTo)
      this.setData({ replyRecording: false, replyUploading: false })
      wx.showToast({ title: '回应已保存，正在生成文章', icon: 'none' })
    } catch (error) {
      this.setData({ replyRecording: false, replyUploading: false })
      wx.showToast({ title: '回应上传失败', icon: 'error' })
    }
  },

  startReplyTimer() {
    this.clearReplyTimer()
    this._replyTimer = setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - (this._replyStartedAt || Date.now())) / 1000))
      this.setData({
        replyTimerDisplay: this.formatReplyTime(elapsed),
        replyWaveBars: this.replyWaveBars(elapsed)
      })
    }, 200)
  },

  clearReplyTimer() {
    if (!this._replyTimer) return
    clearInterval(this._replyTimer)
    this._replyTimer = null
  },

  replyWaveBars(elapsed) {
    return REPLY_WAVE_PATTERN.map((pattern, index) => {
      const pulse = Math.sin(elapsed * 1.8 + index * 0.72) * 0.28 + 0.72
      return Math.max(8, Math.round(12 + pattern * pulse * 46))
    })
  },

  formatReplyTime(seconds) {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  },

  blockAuthor() {
    const author = (this.data.post && (this.data.post.author || this.data.post.authorName)) || ''
    if (!author) return
    wx.showModal({
      title: '屏蔽此用户？',
      content: `屏蔽后，你将不再看到 ${author} 的任何社区内容。可在「设置」>「关于」中取消屏蔽。`,
      confirmText: '屏蔽',
      confirmColor: '#c7432f',
      success: (res) => {
        if (!res.confirm) return
        blockStore.block(author)
        wx.showToast({ title: '已屏蔽，TA 的内容将不再显示' })
        wx.navigateBack()
      }
    })
  },

  shareLink() {
    if (this.setData) this.setData({ moreMenuOpen: false })
    wx.setClipboardData({ data: api.sharePage(this.data.shareId) })
  },

  openReply(event) {
    const index = Number(event.currentTarget.dataset.index)
    const reply = this.data.replies[index]
    if (!reply || !reply.shareId) return
    app.globalData.currentCommunityPost = reply
    wx.navigateTo({ url: `/pages/community-detail/index?shareId=${encodeURIComponent(reply.shareId)}` })
  },

  openReplyTo() {
    if (!this.data.replyToPost || !this.data.replyToPost.shareId) return
    app.globalData.currentCommunityPost = this.data.replyToPost
    wx.navigateTo({ url: `/pages/community-detail/index?shareId=${encodeURIComponent(this.data.replyToPost.shareId)}` })
  }
})
