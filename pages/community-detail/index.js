const community = require('../../services/community')
const library = require('../../services/library')
const audio = require('../../services/audio')
const articleUtil = require('../../utils/article')
const blockStore = require('../../utils/block-store')
const communityReply = require('../../utils/community-reply')
const pendingReplies = require('../../utils/pending-replies')
const recordingQuality = require('../../utils/recording-quality')
const prefs = require('../../utils/prefs')
const api = require('../../services/api')
const audioConsentFlow = require('../../utils/audio-consent-flow')
const recordPermission = require('../../utils/record-permission')
const capsuleLayout = require('../../utils/capsule-layout')
const promptStore = require('../../services/prompt-store')
const promptTree = require('../../utils/prompt-tree')

const app = getApp()
const REPLY_WAVE_PATTERN = [0.25, 0.62, 0.38, 0.9, 0.48, 0.72, 0.34, 0.58]
const TOOLBAR_ACTION_GAP_RPX = 14

function suanliText(value) {
  const number = Number(value) || 0
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

function waitForPendingCommunityLike() {
  const pending = app.globalData.communityLikePending
  if (!pending) return Promise.resolve()
  return Promise.resolve(pending).catch(() => false).then(() => {
    if (app.globalData.communityLikePending === pending) delete app.globalData.communityLikePending
  })
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
    fed: false,
    feeding: false,
    promptImported: false,
    promptImporting: false,
    loading: true,
    moreMenuOpen: false,
    toolbarTop: 0,
    toolbarHeight: 64,
    replyRecording: false,
    replyUploading: false,
    replyTimerDisplay: '00:00',
    replyWaveBars: REPLY_WAVE_PATTERN.map(() => 10),
    audioConsentVisible: false,
    capsuleSafeRightPx: capsuleLayout.FALLBACK_SAFE_RIGHT_PX
  },

  onLoad(options) {
    const shareId = decodeURIComponent(options.shareId || '')
    this.openedFromShare = String(options.fromShare || '') === '1'
    const post = app.globalData.currentCommunityPost
    const initialPost = post && (!shareId || post.shareId === shareId) ? post : null
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
        capsuleSafeRightPx = capsuleLayout.safeRightPx(
          sysInfo,
          menu,
          capsuleLayout.rpxToPx(sysInfo, TOOLBAR_ACTION_GAP_RPX)
        )
      }
    } catch (_) {
    }
    this.setData({ shareId, post: initialPost, toolbarTop, toolbarHeight, capsuleSafeRightPx })
    this.setData({ liked: prefs.likedCommunityPost(this.data.shareId || (post && post.shareId)) })
    this.bindReplyRecorder()
    this.load()
  },

  onUnload() {
    audioConsentFlow.dispose(this)
    this.communityPhotoLoadSeq = (this.communityPhotoLoadSeq || 0) + 1
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
      path: `/pages/community-detail/index?shareId=${encodeURIComponent(this.data.shareId || '')}&fromShare=1`
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
    const navigate = () => {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      const hasPreviousPage = pages && pages.length > 1
      // A share card opens this detail as the mini program root. Use the page
      // stack as a fallback when an external entry does not expose its source.
      if (this.openedFromShare || !hasPreviousPage) {
        wx.reLaunch({ url: '/pages/recordings/index?tab=community' })
        return
      }
      wx.navigateBack()
    }
    if (app.globalData.communityLikePending) {
      waitForPendingCommunityLike().then(navigate)
      return
    }
    navigate()
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
    const seq = (this._communityDetailLoadSeq || 0) + 1
    this._communityDetailLoadSeq = seq
    const summaryPost = this.data.post ? community.postFromDetail(this.data.post) : null
    const cachedPost = community.cachedPost ? community.cachedPost(shareId) : null
    let visiblePost = cachedPost || (summaryPost && summaryPost.doc &&
      summaryPost.doc.articles && summaryPost.doc.articles.length ? summaryPost : null)
    if (visiblePost) {
      const cachedSections = this.articleSections(visiblePost, visiblePost.doc)
      this.setData({
        post: visiblePost,
        article: articleUtil.firstArticle(visiblePost.doc),
        blocks: cachedSections.length ? cachedSections[0].blocks : [],
        sections: cachedSections,
        loading: false
      })
      if (this.loadCommunityPhotos) {
        this.loadCommunityPhotos(cachedSections, visiblePost.doc && visiblePost.doc.owner)
      }
    } else {
      this.setData({ loading: true })
    }
    const feedStatesPromise = community.feedStates([shareId]).catch(() => ({}))
    try {
      const fullPost = await community.get(shareId).catch(() => null)
      if (seq !== this._communityDetailLoadSeq) return
      const post = community.postFromDetail(fullPost || cachedPost || summaryPost)
      let doc = post.doc
      if ((!doc || !doc.articles || !doc.articles.length) && post.articleKey) {
        doc = await library.fetchDocByArticleKey(post.articleKey)
      }
      if (seq !== this._communityDetailLoadSeq) return
      if (doc && doc.articles && doc.articles.length) {
        post.doc = doc
        if (community.cachePost) visiblePost = community.cachePost(post)
      } else {
        visiblePost = post
      }
      const first = articleUtil.firstArticle(doc)
      const sections = this.articleSections(post, doc)
      const sameDocument = cachedPost && !articleUtil.shouldRebuild(cachedPost.doc, doc)
      const articleUpdate = {
        post: visiblePost,
        loading: false
      }
      if (!sameDocument) Object.assign(articleUpdate, {
        article: first,
        blocks: sections.length ? sections[0].blocks : [],
        sections
      })
      this.setData(articleUpdate)
      if (!sameDocument && this.loadCommunityPhotos) {
        this.loadCommunityPhotos(sections, doc && doc.owner)
      }
      community.engage(shareId, 'view')

      const repliesPromise = post.isPrompt
        ? Promise.resolve([])
        : this.loadFullReplies(shareId).catch(() => [])
      const replyToPromise = !post.isPrompt && post.replyTo
        ? community.get(post.replyTo).catch(() => null)
        : Promise.resolve(null)
      const [replies, replyToPost, feedStates] = await Promise.all([
        repliesPromise,
        replyToPromise,
        feedStatesPromise
      ])
      if (seq !== this._communityDetailLoadSeq) return
      this.setData({
        replies,
        replyToPost,
        fed: Boolean(feedStates[shareId] && feedStates[shareId].fed),
        promptImported: Boolean(post.isPrompt && post.promptCode && promptTree.containsImport(promptStore.items(), post.promptCode))
      })
    } finally {
      if (seq === this._communityDetailLoadSeq && this.data.loading) {
        this.setData({ loading: false })
      }
    }
  },

  async collectPrompt() {
    const post = this.data.post
    if (!post || !post.isPrompt || !post.promptCode || this.data.promptImported || this.data.promptImporting) return
    this.setData({ promptImporting: true })
    wx.showLoading({ title: '正在收下...' })
    try {
      const result = await promptStore.importCode(post.promptCode)
      if (result && result.ok) {
        this.setData({ promptImported: true })
        wx.showToast({ title: result.already ? '这条提示词你已经收下过了' : '已加入你的提示词', icon: 'none' })
      } else {
        wx.showToast({ title: '导入失败，请稍后再试', icon: 'none' })
      }
    } catch (error) {
      wx.showToast({ title: `导入失败：${error && error.message || '网络错误'}`, icon: 'none' })
    } finally {
      this.setData({ promptImporting: false })
      wx.hideLoading()
    }
  },

  articleSections(post, doc) {
    if (!doc || !doc.articles || !doc.articles.length) return []
    const scope = doc.owner || ''
    const previousPhotos = {}
    const previousSections = this && this.data && this.data.sections || []
    previousSections.forEach((section) => {
      ;(section.blocks || []).forEach((block) => {
        if (block && block.type === 'photo' && block.key && block.url) {
          const cacheKey = library.scopedPhotoKey
            ? library.scopedPhotoKey(block.key, block.photoScope || '')
            : `${block.photoScope || ''}${block.key}`
          previousPhotos[cacheKey] = block
        }
      })
    })
    return doc.articles.map((article) => ({
      title: article.title && article.title !== post.title ? article.title : '',
      blocks: articleUtil.bodyBlocks(article.body).map((block) => {
        if (block.type !== 'photo') return block
        const key = articleUtil.resolvePhotoKey(block.key, doc.photos || []) || block.key
        const cacheKey = library.scopedPhotoKey
          ? library.scopedPhotoKey(key, scope)
          : `${scope}${key}`
        const previous = previousPhotos[cacheKey]
        const next = Object.assign({}, block, {
          key,
          photoScope: scope,
          url: '',
          remoteUrl: library.photoUrl(key, scope),
          photoState: 'loading',
          loading: true,
          loaded: false,
          failed: false
        })
        if (previous && previous.loaded && previous.photoState === 'loaded') {
          Object.assign(next, {
            url: previous.url,
            photoState: 'loaded',
            loading: false,
            loaded: true,
            width: previous.width,
            height: previous.height
          })
        }
        return next
      })
    }))
  },

  loadCommunityPhotos(sections, scope) {
    const photoBlocks = []
    ;(sections || []).forEach((section, sectionIndex) => {
      ;(section.blocks || []).forEach((block, blockIndex) => {
        if (block && block.type === 'photo' && block.key && block.photoState === 'loading') {
          photoBlocks.push({ sectionIndex, blockIndex, block })
        }
      })
    })
    if (!photoBlocks.length || !library.downloadPhotoTemp) return
    this.communityPhotoLoadSeq = (this.communityPhotoLoadSeq || 0) + 1
    const seq = this.communityPhotoLoadSeq
    this.communityPhotoCache = this.communityPhotoCache || {}
    photoBlocks.forEach(({ sectionIndex, blockIndex, block }) => {
      const cacheKey = library.scopedPhotoKey
        ? library.scopedPhotoKey(block.key, scope)
        : `${scope || ''}${block.key}`
      const cached = this.communityPhotoCache[cacheKey]
      if (cached) {
        this.updateCommunityPhotoBlock(sectionIndex, blockIndex, {
          url: cached,
          loading: false,
          loaded: false,
          failed: false,
          photoState: 'loading'
        })
        return
      }
      library.downloadPhotoTemp(block.key, scope)
        .then((localPath) => {
          if (seq !== this.communityPhotoLoadSeq) return
          this.communityPhotoCache[cacheKey] = localPath
          this.updateCommunityPhotoBlock(sectionIndex, blockIndex, {
            url: localPath,
            loading: false,
            loaded: false,
            failed: false,
            photoState: 'loading'
          })
        })
        .catch(() => {
          if (seq !== this.communityPhotoLoadSeq) return
          this.updateCommunityPhotoBlock(sectionIndex, blockIndex, {
            loading: false,
            loaded: false,
            failed: true,
            photoState: 'loadFailed'
          })
        })
    })
  },

  updateCommunityPhotoBlock(sectionIndex, blockIndex, patch) {
    const sections = (this.data.sections || []).slice()
    const section = sections[sectionIndex]
    if (!section || !section.blocks || !section.blocks[blockIndex] ||
      section.blocks[blockIndex].type !== 'photo') return
    const blocks = section.blocks.slice()
    blocks[blockIndex] = Object.assign({}, blocks[blockIndex], patch)
    sections[sectionIndex] = Object.assign({}, section, { blocks })
    const update = { sections }
    if (sectionIndex === 0) update.blocks = blocks
    this.setData(update)
  },

  communityPhotoFromEvent(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset || {}
    const sectionIndex = Number(dataset.sectionIndex)
    const blockIndex = Number(dataset.blockIndex)
    if (!Number.isInteger(sectionIndex) || !Number.isInteger(blockIndex)) return null
    const section = (this.data.sections || [])[sectionIndex]
    const block = section && section.blocks && section.blocks[blockIndex]
    if (!block || block.type !== 'photo') return null
    if (dataset.key && dataset.key !== block.key) return null
    if (dataset.url && dataset.url !== block.url) return null
    return { sectionIndex, blockIndex, block }
  },

  onCommunityImageLoad(event) {
    const target = this.communityPhotoFromEvent(event)
    if (!target) return
    this.updateCommunityPhotoBlock(target.sectionIndex, target.blockIndex, {
      photoState: 'loaded',
      loading: false,
      loaded: true,
      failed: false,
      width: Number(event && event.detail && event.detail.width) || target.block.width,
      height: Number(event && event.detail && event.detail.height) || target.block.height
    })
  },

  onCommunityImageError(event) {
    const target = this.communityPhotoFromEvent(event)
    if (!target) return
    this.updateCommunityPhotoBlock(target.sectionIndex, target.blockIndex, {
      photoState: 'loadFailed',
      loading: false,
      loaded: false,
      failed: true
    })
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
    app.globalData.communityFeedDirty = true
    const previous = app.globalData.communityLikePending || Promise.resolve()
    const pending = Promise.resolve(previous)
      .then(() => community.engage(this.data.shareId, 'like', liked))
      .catch(() => false)
    app.globalData.communityLikePending = pending
  },

  async tip() {
    if (this.data.fed || this.data.feeding) return
    this.setData({ feeding: true })
    try {
      const result = await community.feed(this.data.shareId)
      if (result.ok || result.already) {
        this.setData({ fed: true })
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
    } finally {
      this.setData({ feeding: false })
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
          await waitForPendingCommunityLike()
          app.globalData.communityFeedDirty = true
          app.globalData.communityModeration = { type: 'report', shareId: this.data.shareId }
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
    return audioConsentFlow.request(this)
  },

  onAudioConsentAgree() {
    audioConsentFlow.agree(this)
  },

  onAudioConsentDecline() {
    audioConsentFlow.decline(this)
  },

  onAudioConsentViewAgreement() {
    audioConsentFlow.decline(this)
    wx.navigateTo({ url: '/pages/audio-consent/index' })
  },

  async startReplyRecording() {
    const shareId = this.data.shareId || (this.data.post && this.data.post.shareId)
    if (!shareId || this.data.replyRecording || this.data.replyUploading) return
    if (!await this.requestAudioConsent()) return
    if (!await recordPermission.ensure(wx)) return
    this.beginReplyRecording(shareId)
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
    const durationSeconds = recordingQuality.durationSeconds(
      res && res.duration,
      Date.now() - startedAt
    )
    const elapsed = Math.max(1, Math.round(durationSeconds))
    const name = audio.nameForSession(new Date(startedAt), elapsed)
    this._replyToShareId = null
    this._replyStartedAt = 0

    if (this._replyCanceled) {
      this._replyCanceled = false
      this.setData({ replyRecording: false, replyUploading: false })
      await audio.discardFile(res && res.tempFilePath)
      return
    }

    if (recordingQuality.isTooShort(durationSeconds)) {
      await audio.discardFile(res && res.tempFilePath)
      this.setData({ replyRecording: false, replyUploading: false })
      wx.showToast({ title: '时间太短，不足以产生文章', icon: 'none' })
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
        const applyBlock = () => {
          blockStore.block(author)
          app.globalData.communityFeedDirty = true
          app.globalData.communityModeration = { type: 'block', author }
          wx.showToast({ title: '已屏蔽，TA 的内容将不再显示' })
          wx.navigateBack()
        }
        if (app.globalData.communityLikePending) waitForPendingCommunityLike().then(applyBlock)
        else applyBlock()
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
