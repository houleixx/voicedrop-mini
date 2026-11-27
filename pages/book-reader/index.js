const books = require('../../services/books')
const offline = require('../../services/book-offline')
const apiRoute = require('../../services/api-route')

const LOADING_OVERLAY_DELAY_MS = 350

function decoded(value) {
  try { return decodeURIComponent(String(value || '')) } catch (_) { return String(value || '') }
}

Page({
  data: { url: '', readerReady: false, webPending: false, loading: false, title: '', author: '', cover: false, mine: false, hidden: false, moreMenuOpen: false,
    offline: false, chapterLoading: false, offlineAvailable: false, offlineProgress: -1, chapters: [], chapterIndex: 0, chapterScrollTarget: '',
    blocks: [], pageIndex: null, pageMeta: '', audioPath: '', missingChapterAudio: false, playing: false, audioTime: 0, audioDuration: 0, videoPath: '', hasAnimation: false },
  onLoad(options) {
    const slug = String(options.slug || '').replace(/[^A-Za-z0-9_-]/g, '')
    const book = {
      slug,
      title: decoded(options.title),
      main: decoded(options.main || options.title),
      author: decoded(options.author),
      cover: String(options.cover || '') === '1',
      coverAt: Math.max(0, Number(options.coverAt) || 0),
      mine: String(options.mine || '') === '1',
      hidden: String(options.hidden || '') === '1'
    }
    this.book = book
    this.bookUrl = books.readerPageUrl(book, decoded(options.page))
    const forceOnline = String(options.online || '') === '1'
    this.localBook = offline.get(slug)
    const useLocal = Boolean(this.localBook) && !forceOnline
    this._webFinished = useLocal
    this.initialOfflineUrl = useLocal ? this.bookUrl : ''
    this.setData({ url: useLocal ? '' : this.bookUrl, webPending: !useLocal, offline: useLocal, chapterLoading: useLocal, title: book.main, author: book.author, cover: book.cover,
      mine: book.mine, hidden: book.hidden, offlineAvailable: Boolean(this.localBook),
      offlineProgress: offline.downloadProgress(slug) })
    this.scheduleLoadingOverlay()
    this.stopDownloadUpdates = offline.subscribeDownloads((changedSlug, progress) => {
      if (changedSlug !== slug || this.book !== book) return
      if (progress >= 0) {
        this.setData({ offlineProgress: progress })
        return
      }
      this.localBook = offline.get(slug)
      this.setData({ offlineProgress: -1, offlineAvailable: Boolean(this.localBook) })
    })
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
  },
  onReady() {
    if (!this.book) return
    this.setData({ readerReady: true })
    this.loadOwnership()
    if (this.initialOfflineUrl) {
      const url = this.initialOfflineUrl
      this.initialOfflineUrl = ''
      return this.openOffline(url)
    }
  },
  scheduleLoadingOverlay() {
    this.cancelLoadingTimer()
    if (this._webFinished) return
    this._loadingTimer = setTimeout(() => {
      this._loadingTimer = null
      if (!this._webFinished) {
        this.setData({ loading: true })
      }
    }, LOADING_OVERLAY_DELAY_MS)
  },
  cancelLoadingTimer() {
    if (!this._loadingTimer) return
    clearTimeout(this._loadingTimer)
    this._loadingTimer = null
  },
  finishLoading() {
    this._webFinished = true
    this.cancelLoadingTimer()
    if (!this.data.webPending && !this.data.loading) return
    this.setData({ webPending: false, loading: false })
  },
  onWebLoad(event) {
    const source = event && event.detail && event.detail.src
    this.bookUrl = books.readerPageUrl(this.book, source || this.bookUrl)
    this.finishLoading()
  },
  onWebError() {
    this.finishLoading()
    wx.showToast({ title: '书籍加载失败', icon: 'none' })
  },
  async loadOwnership() {
    try {
      const ownership = await books.ownership(this.book.slug)
      if (!this.book || ownership == null) return
      this.book.mine = ownership.mine
      this.book.hidden = ownership.hidden
      this.setData({ mine: ownership.mine, hidden: ownership.hidden })
    } catch (_) {
      // The shelf result is a usable first-frame fallback while offline.
    }
  },
  openActions() {
    if (!this.book || this._changingHidden) return
    this.setData({ moreMenuOpen: true })
  },
  closeMoreMenu() {
    if (this.data.moreMenuOpen) this.setData({ moreMenuOpen: false })
  },
  noop() {},
  runMoreMenuAction(event) {
    const action = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.action
    this.closeMoreMenu()
    if (action === 'offline-download') { this.downloadOffline(); return }
    if (action === 'offline-toggle') {
      if (this.data.offline) this.openOnlineBook()
      else this.readLocalCopy()
      return
    }
    if (action === 'offline-remove') { this.confirmRemoveOffline(); return }
    if (!this.data.mine) return
    if (action === 'revise') {
      wx.navigateTo({ url: `/pages/book-revise/index?slug=${encodeURIComponent(this.book.slug)}&title=${encodeURIComponent(this.book.main || this.book.title || '')}` })
      return
    }
    if (action === 'visibility') this.confirmSetHidden(!this.data.hidden)
  },
  async downloadOffline() {
    if (!this.book || offline.downloadProgress(this.book.slug) >= 0 || this.data.offlineProgress >= 0) return
    const book = this.book
    const root = `${apiRoute.publicWebBase()}/books/${encodeURIComponent(book.slug)}/`
    this.setData({ offlineProgress: 0 })
    try {
      const local = await offline.download(book.slug, root, (progress) => {
        if (this.book === book) this.setData({ offlineProgress: progress })
      })
      if (this.book !== book) return
      this.localBook = local
      this.setData({ offlineAvailable: true })
      if (this.data.offline) this.openOffline(this.bookUrl)
      const missingMedia = local.missingAudio || (local.missingFiles || []).some((path) => /\.(?:png|jpe?g|gif|webp|svg|mp4)$/i.test(path))
      wx.showToast({ title: missingMedia ? '书籍已下载，部分媒体未下载' : '已下载到本地', icon: 'none' })
    } catch (_) {
      if (this.book === book) wx.showToast({ title: '下载失败，请检查网络或存储空间', icon: 'none' })
    } finally {
      if (this.book === book) this.setData({ offlineProgress: -1 })
    }
  },
  readLocalCopy() { if (this.localBook) this.openOffline(this.bookUrl) },
  async openOffline(url) {
    const root = books.readerUrl(this.book)
    try {
      const chapters = offline.chapters(this.localBook)
      if (chapters.length === 0) throw new Error('No chapters')
      const current = decodeURIComponent(books.readerPageUrl(this.book, url).slice(root.length).split(/[?#]/)[0])
      this.finishLoading()
      this.setData({ url: '', offline: true, offlineAvailable: true, chapters,
        hasAnimation: Boolean(this.localBook.hasAnimation),
        videoPath: this.localBook.video ? this.localBook.root + '/' + this.localBook.video : '' })
      await this.showOfflineChapter(Math.max(0, chapters.findIndex(({ path }) => path === current)), true)
    } catch (_) {
      wx.showToast({ title: '本地副本无法读取，请重新下载', icon: 'none' })
      this.openOnlineBook()
    }
  },
  async showOfflineChapter(index, opening = false) {
    const chapter = this.data.chapters[index]
    if (!chapter || !this.localBook) return
    this.stopOfflineAudio()
    const root = books.readerUrl(this.book)
    const request = {}
    this.chapterRequest = request
    this.setData({ chapterLoading: true })
    let result
    try {
      result = await offline.loadLocalPage(this.localBook, chapter.path, root)
    } catch (error) {
      if (this.chapterRequest !== request) return
      this.setData({ chapterLoading: false })
      if (opening) throw error
      wx.showToast({ title: '本地章节无法读取', icon: 'none' })
      return
    }
    if (this.chapterRequest !== request) return
    const stem = chapter.path.replace(/\.html?$/i, '')
    this.bookUrl = chapter.path === 'index.html' ? root : root + encodeURIComponent(chapter.path)
    const audioPath = this.localBook.audio.includes(stem) ? `${this.localBook.root}/audio/${stem}.mp3` : ''
    const expected = this.localBook.audioExpected || []
    const missingChapterAudio = !audioPath && (expected.includes(stem) ||
      (!expected.length && this.localBook.missingAudio > 0 && !/^(index|intro)$/.test(stem)))
    const chapters = this.data.chapters.slice()
    if (index > 0 && result.title) chapters[index] = { ...chapter, title: result.title }
    this.setData({ chapterLoading: false, chapters, ...this.presentation(result, chapters), chapterIndex: index, audioPath, missingChapterAudio, audioTime: 0, audioDuration: 0, playing: false, chapterScrollTarget: '' }, () => {
      if (this.chapterRequest === request && this.data.offline) {
        this.setData({ chapterScrollTarget: 'reader-chapter-start' })
      }
    })
  },
  presentation(result, chapters) {
    const index = result.index
    if (!index) return { blocks: result.blocks, pageIndex: null, pageMeta: result.meta || '' }
    const rows = new Map(index.rows.map((row) => [row.path, row]))
    const entries = chapters.map((chapter, position) => {
      const row = rows.get(chapter.path)
      return { ...chapter, ...(row || {}), position, number: chapter.path.replace(/\.html?$/i, '') }
    })
    return { blocks: result.blocks, pageMeta: '', pageIndex: {
      ...index, introPosition: entries.findIndex((chapter) => chapter.path === 'intro.html'),
      entries: entries.filter(({ path }) => path !== 'index.html' && path !== 'intro.html')
    } }
  },
  selectChapter(index) {
    this.showOfflineChapter(index)
  },
  openChapter(event) { this.selectChapter(Number(event.currentTarget.dataset.index)) },
  pickOfflineChapter(event) { this.selectChapter(Number(event.detail.value)) },
  stepOfflineChapter(event) {
    this.selectChapter(this.data.chapterIndex + Number(event.currentTarget.dataset.step))
  },
  openOnlineBook() {
    if (!this.book) return
    this.stopOfflineAudio()
    this._webFinished = false
    this.initialOfflineUrl = ''
    this.chapterRequest = null
    this.setData({ url: this.bookUrl, webPending: true, offline: false, chapterLoading: false, blocks: [], audioPath: '', playing: false })
    this.scheduleLoadingOverlay()
  },
  goBack() { wx.navigateBack() },
  toggleOfflineAudio() {
    if (!this.data.audioPath) return
    if (!this.offlineAudio) {
      const audio = wx.createInnerAudioContext()
      audio.src = this.data.audioPath
      audio.onPlay(() => this.setData({ playing: true }))
      audio.onPause(() => this.setData({ playing: false }))
      audio.onEnded(() => this.setData({ playing: false, audioTime: 0 }))
      audio.onTimeUpdate(() => this.setData({ audioTime: audio.currentTime, audioDuration: audio.duration }))
      audio.onError(() => {
        this.stopOfflineAudio()
        this.setData({ playing: false })
        wx.showToast({ title: '本地音频无法播放', icon: 'none' })
      })
      this.offlineAudio = audio
    }
    if (this.data.playing) this.offlineAudio.pause()
    else this.offlineAudio.play()
  },
  seekOfflineAudio(event) {
    if (this.offlineAudio) this.offlineAudio.seek(Number(event.detail.value))
  },
  stopOfflineAudio() {
    if (!this.offlineAudio) return
    const audio = this.offlineAudio
    this.offlineAudio = null
    audio.destroy()
  },
  confirmRemoveOffline() {
    if (!this.localBook || this.data.offlineProgress >= 0) return
    const book = this.book
    wx.showModal({
      title: '删除本地副本？', confirmText: '删除',
      success: ({ confirm }) => {
        if (!confirm || this.book !== book) return
        try {
          this.stopOfflineAudio()
          offline.remove(book.slug)
          this.localBook = null
          this.setData({ offlineAvailable: false })
          if (this.data.offline) this.openOnlineBook()
        } catch (_) { wx.showToast({ title: '删除失败', icon: 'none' }) }
      }
    })
  },
  confirmSetHidden(hidden) {
    wx.showModal({
      title: hidden ? '隐藏本书？' : '取消隐藏本书？',
      content: hidden ? '隐藏后不会出现在公开书架，已有直链仍可阅读。' : '取消隐藏后会重新出现在公开书架。',
      confirmText: hidden ? '隐藏' : '取消隐藏',
      success: (result) => { if (result.confirm) this.setHidden(hidden) }
    })
  },
  async setHidden(hidden) {
    if (this._changingHidden) return
    this._changingHidden = true
    try {
      await books.setHidden(this.book.slug, hidden)
      if (!this.book) return
      this.book.hidden = hidden
      this.setData({ hidden })
      wx.showToast({ title: hidden ? '已隐藏，书架上看不到了' : '已取消隐藏', icon: 'none' })
      try { this.getOpenerEventChannel().emit('bookHiddenChanged') } catch (_) {}
    } catch (error) {
      wx.showToast({ title: error && error.statusCode === 403 ? '这不是你的书，改不了' : '没改成，过会儿再试', icon: 'none' })
      this.loadOwnership()
    } finally {
      this._changingHidden = false
    }
  },
  sharePayload() {
    const book = this.book || {}
    const payload = {
      title: books.shareTitle(book),
      path: `/pages/book-reader/index?slug=${encodeURIComponent(book.slug || '')}&title=${encodeURIComponent(book.title || '')}&main=${encodeURIComponent(book.main || book.title || '')}&author=${encodeURIComponent(book.author || '')}&cover=${book.cover ? '1' : '0'}&coverAt=${encodeURIComponent(String(book.coverAt || 0))}`
    }
    const root = books.readerUrl(book)
    payload.path += '&details=1'
    if (this.bookUrl && this.bookUrl !== root) payload.path += `&page=${encodeURIComponent(this.bookUrl)}`
    if (book.cover) payload.imageUrl = books.coverUrl(book)
    return payload
  },
  onShareAppMessage() { return this.sharePayload() },
  onShareTimeline() {
    const payload = this.sharePayload()
    return { title: payload.title, query: payload.path.split('?')[1] || '', imageUrl: payload.imageUrl }
  },
  onUnload() {
    this.chapterRequest = null
    if (this.stopDownloadUpdates) this.stopDownloadUpdates()
    this._webFinished = true
    this.cancelLoadingTimer()
    this.stopOfflineAudio()
    this.bookUrl = ''
    this.book = null
  }
})
