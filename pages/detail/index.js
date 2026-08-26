const auth = require('../../services/auth')
const library = require('../../services/library')
const community = require('../../services/community')
const wechatAuth = require('../../services/wechat-auth')
const articleEdit = require('../../services/article-edit')
const settings = require('../../services/settings')
const articleUtil = require('../../utils/article')
const recording = require('../../utils/recording')
const photoInsert = require('../../utils/photo-insert')
const playbackState = require('../../utils/audio-playback-state')
const communityTerms = require('../../utils/community-terms')
const styleRewrite = require('../../utils/style-rewrite')
const styleSelection = require('../../utils/style-selection')
const uiConfig = require('../../utils/ui-config')
const promptStore = require('../../services/prompt-store')
const versionNav = require('../../utils/version-navigation')
const asrDictation = require('../../services/asr-dictation')
const holdToTalk = require('../../utils/hold-to-talk')
const audioConsentFlow = require('../../utils/audio-consent-flow')
const recordPermission = require('../../utils/record-permission')
const capsuleLayout = require('../../utils/capsule-layout')
const audioSessionReset = require('../../utils/audio-session-reset')
const xhsExport = require('../../services/xhs-export')
const albumPermission = require('../../utils/album-permission')
const xhsCards = require('../../utils/xhs-cards')
const publicShare = require('../../services/public-share')

const app = getApp()
const ARTICLE_PHOTO_CONCURRENCY = 3
const TOOLBAR_ACTION_GAP_RPX = 14
const PLAYBACK_RING_CANVAS_SIZE = 40
const PLAYBACK_RING_LINE_WIDTH = 3

function xhsCardDate(rec) {
  const parsed = recording.parseStem(rec && rec.stem)
  return parsed && parsed.sessionTs ? parsed.sessionTs.slice(0, 10) : ''
}

function logPhotoInsert(stage, details) {
  if (typeof console === 'undefined' || !console.log) return
  try {
    console.log('[VoiceDrop detail photo]', stage, details || {})
  } catch (_) {
  }
}

function isPhotoInsertInstruction(instruction, images) {
  return Boolean((images && images.length) || /\[\[photo:[^\]]+\]\]/.test(String(instruction || '')))
}

function photoInsertPromptData(instruction) {
  return {
    photoInsertTip: '图片已上传，AI正在插入...',
    photoInsertInstruction: instruction || '',
    photoInsertPromptVisible: true
  }
}

function hiddenPhotoInsertPromptData() {
  return {
    photoInsertTip: '',
    photoInsertInstruction: '',
    photoInsertPromptVisible: false
  }
}

function longpressMenuHeight(menu, localRows) {
  const groups = uiConfig.renderableGroups(menu)
  const nodes = groups.flat()
  const customRows = nodes.filter((node) => node.origin !== 'system').length
  const rows = nodes.length + (localRows || []).length
  const separator = customRows && (localRows || []).length ? 1 : 0
  return Math.max(48, rows * 48 + separator)
}

function coordinate(...values) {
  for (const value of values) {
    if (value == null || value === '') continue
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return null
}

function longpressAnchor(block, kind, rect, detail, systemInfo, menu, localRows) {
  const sys = systemInfo || {}
  const point = detail || {}
  const windowWidth = Number(sys.windowWidth) || 375
  const windowHeight = Number(sys.windowHeight) || 667
  const measuredWidth = rect && Number(rect.width)
  const measuredHeight = rect && Number(rect.height)
  const width = kind === 'image'
    ? Math.min(windowWidth - 32, measuredWidth || Number(block.width) || windowWidth - 48)
    : windowWidth - 48
  const height = kind === 'image'
    ? measuredHeight || Number(block.height) || Math.min(width * .72, 280)
    : 76
  const viewportInset = 16
  const rawLeft = rect && Number.isFinite(Number(rect.left)) ? Number(rect.left) : Number(point.x) || 24
  const rawTop = rect && Number.isFinite(Number(rect.top)) ? Number(rect.top) : Number(point.y) || 160
  const left = Math.max(16, Math.min(rawLeft, windowWidth - width - 16))
  // A tall image cannot fit inside the viewport. Clamping it as if it could
  // turns its maximum top into a negative value and snaps the menu target to
  // the viewport top, even when the user held the image lower on the page.
  const hasMeasuredImageHeight = kind !== 'image' || measuredHeight > 0 || Number(block.height) > 0
  const anchorFitsViewport = hasMeasuredImageHeight && height <= windowHeight - 32 &&
    rawTop >= viewportInset && rawTop + height <= windowHeight - viewportInset
  const top = anchorFitsViewport
    ? Math.max(16, Math.min(rawTop, windowHeight - height - 16))
    : rawTop
  const menuCapacity = Math.min(520, Math.round(windowHeight * .68))
  const menuHeight = Math.min(longpressMenuHeight(menu, localRows), menuCapacity)
  const menuWidth = Math.min(340, windowWidth - 32)
  const menuGap = 12
  let menuTop
  let menuMaxHeight
  if (kind === 'image' && anchorFitsViewport) {
    menuTop = Math.max(viewportInset, Math.min(top + menuGap, windowHeight - menuHeight - viewportInset))
    menuMaxHeight = Math.min(menuCapacity, windowHeight - menuTop - viewportInset)
  } else if (kind === 'image') {
    // For a long image its document top may be above the viewport. Place the
    // menu around the actual hold point instead of that invisible top edge.
    const fallbackY = rawTop >= viewportInset && rawTop <= windowHeight - viewportInset
      ? rawTop + Math.min(Math.max(height, 0), windowHeight) / 2
      : windowHeight / 2
    const measuredTouchY = coordinate(point.y)
    // A few Mini Program runtimes expose clientY as 0 for this gesture even
    // when the finger is visibly lower on the page. Treat that impossible
    // value as missing so the menu cannot be placed at the viewport top.
    const touchY = measuredTouchY == null || measuredTouchY <= 0 ? fallbackY : measuredTouchY
    const holdTop = Math.max(viewportInset, Math.min(touchY, windowHeight - viewportInset))
    const belowTop = holdTop + menuGap
    const belowHeight = Math.max(0, windowHeight - belowTop - viewportInset)
    const aboveHeight = Math.max(0, holdTop - menuGap - viewportInset)
    const placeBelow = menuHeight <= belowHeight || belowHeight >= aboveHeight
    const availableHeight = placeBelow ? belowHeight : aboveHeight
    menuMaxHeight = Math.max(48, Math.min(menuCapacity, availableHeight))
    menuTop = placeBelow
      ? belowTop
      : Math.max(viewportInset, holdTop - menuGap - Math.min(menuHeight, menuMaxHeight))
    if (menuTop <= viewportInset) {
      const centeredHeight = Math.min(menuHeight, menuCapacity)
      menuTop = Math.max(viewportInset, Math.min(
        (windowHeight - centeredHeight) / 2,
        windowHeight - centeredHeight - viewportInset
      ))
      menuMaxHeight = Math.min(menuCapacity, windowHeight - menuTop - viewportInset)
    }
  } else {
    const belowTop = top + height + menuGap
    const belowHeight = Math.max(0, windowHeight - belowTop - viewportInset)
    const aboveHeight = Math.max(0, top - menuGap - viewportInset)
    const placeBelow = menuHeight <= belowHeight || belowHeight >= aboveHeight
    const availableHeight = placeBelow ? belowHeight : aboveHeight
    menuMaxHeight = Math.max(48, Math.min(menuCapacity, availableHeight))
    menuTop = placeBelow
      ? belowTop
      : Math.max(viewportInset, top - menuGap - Math.min(menuHeight, menuMaxHeight))
  }
  return {
    top,
    left,
    width,
    height,
    menuTop,
    menuMaxHeight,
    menuWidth,
    menuLeft: Math.min(Math.max(16, left), windowWidth - menuWidth - 16),
    url: block.url || '',
    text: block.text || ''
  }
}

function inspectPhotoInsertPromptLayout(page, stage) {
  if (!page || typeof wx === 'undefined' || !wx.createSelectorQuery) return
  try {
    wx.createSelectorQuery()
      .in(page)
      .select('.photo-insert-tip')
      .boundingClientRect((rect) => {
        logPhotoInsert('prompt-layout', {
          stage,
          visible: !!(page.data && page.data.photoInsertPromptVisible),
          hasRect: !!rect,
          rect,
          tip: page.data && page.data.photoInsertTip || '',
          instructionLength: String(page.data && page.data.photoInsertInstruction || '').length
        })
      })
      .exec()
  } catch (error) {
    logPhotoInsert('prompt-layout-fail', { stage, error })
  }
}

function photoInsertPromptKey(stem) {
  return `voicedrop.photoInsertPrompt.${stem || ''}`
}

function savePhotoInsertPrompt(stem, data) {
  if (!stem || typeof wx === 'undefined' || !wx.setStorageSync) {
    logPhotoInsert('prompt-save-skip', { stem, hasWx: typeof wx !== 'undefined', hasSetStorage: typeof wx !== 'undefined' && !!wx.setStorageSync })
    return
  }
  try {
    const key = photoInsertPromptKey(stem)
    const payload = JSON.stringify({
      tip: data.photoInsertTip || '',
      instruction: data.photoInsertInstruction || '',
      ts: Date.now()
    })
    wx.setStorageSync(key, payload)
    logPhotoInsert('prompt-save', {
      stem,
      storageKey: key,
      tip: data.photoInsertTip || '',
      instructionLength: String(data.photoInsertInstruction || '').length,
      markerCount: (String(data.photoInsertInstruction || '').match(/\[\[photo:/g) || []).length
    })
  } catch (error) {
    logPhotoInsert('prompt-save-fail', { stem, error })
  }
}

function loadPhotoInsertPrompt(stem) {
  if (!stem || typeof wx === 'undefined' || !wx.getStorageSync) {
    logPhotoInsert('prompt-load-skip', { stem, hasWx: typeof wx !== 'undefined', hasGetStorage: typeof wx !== 'undefined' && !!wx.getStorageSync })
    return null
  }
  try {
    const key = photoInsertPromptKey(stem)
    const raw = wx.getStorageSync(key)
    logPhotoInsert('prompt-load-raw', { stem, storageKey: key, hasRaw: !!raw, rawLength: String(raw || '').length })
    if (!raw) return null
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!obj || !obj.instruction) {
      logPhotoInsert('prompt-load-empty', { stem, hasObject: !!obj })
      return null
    }
    logPhotoInsert('prompt-load-hit', {
      stem,
      tip: obj.tip || '',
      instructionLength: String(obj.instruction || '').length,
      markerCount: (String(obj.instruction || '').match(/\[\[photo:/g) || []).length
    })
    return {
      photoInsertTip: obj.tip || '图片已上传，AI正在插入...',
      photoInsertInstruction: obj.instruction,
      photoInsertPromptVisible: true
    }
  } catch (error) {
    logPhotoInsert('prompt-load-fail', { stem, error })
    return null
  }
}

function clearPhotoInsertPrompt(stem) {
  if (!stem || typeof wx === 'undefined' || !wx.removeStorageSync) {
    logPhotoInsert('prompt-clear-skip', { stem, hasWx: typeof wx !== 'undefined', hasRemoveStorage: typeof wx !== 'undefined' && !!wx.removeStorageSync })
    return
  }
  try {
    const key = photoInsertPromptKey(stem)
    wx.removeStorageSync(key)
    logPhotoInsert('prompt-clear', { stem, storageKey: key })
  } catch (error) {
    logPhotoInsert('prompt-clear-fail', { stem, error })
  }
}

function detailPhotoPickerDraftStem(page) {
  return page && page.data && page.data.rec && page.data.rec.stem || ''
}

function saveDetailPhotoPickerDraft(page, photos) {
  const stem = detailPhotoPickerDraftStem(page)
  if (!stem) return
  app.globalData.detailPhotoPickerDraft = {
    stem,
    photos: (photos || []).slice()
  }
}

function clearDetailPhotoPickerDraft(page) {
  const stem = detailPhotoPickerDraftStem(page)
  const draft = app.globalData.detailPhotoPickerDraft
  if (!draft || !stem || draft.stem === stem) {
    app.globalData.detailPhotoPickerDraft = null
  }
}

function visibleDetailPageForStem(stem, sourcePage) {
  if (!stem || typeof getCurrentPages !== 'function') return null
  try {
    const pages = getCurrentPages()
    const top = pages && pages.length ? pages[pages.length - 1] : null
    if (!top || top === sourcePage || top.route !== 'pages/detail/index') return null
    const topStem = top.data && top.data.rec && top.data.rec.stem || ''
    return topStem === stem && typeof top.setData === 'function' ? top : null
  } catch (_) {
    return null
  }
}

function applyPhotoPickerPhotosToPage(page, photos) {
  if (!page || typeof page.setData !== 'function') return false
  page.setData({
    photoSheetOpen: true,
    photoPickerPhotos: (photos || []).slice(),
    photoPickerCount: (photos || []).length,
    photoUploading: false,
    photoUploadFailed: false,
    photoSheetStatus: ''
  })
  return true
}

function photoPickerPaths(photos) {
  return (photos || []).map((file) => file && (file.path || file.tempFilePath) || '').filter(Boolean)
}

Page({
  data: {
    rec: null,
    doc: null,
    current: null,
    articleIndex: 0,
    articleTabs: [],
    styleLabel: '选风格',
    blocks: [],
    loading: true,
    versionHead: 0,
    editText: '',
    editPanelOpen: false,
    editState: '',
    editQueue: [],
    editFeedbackQueue: [],
    editReply: '',
    editReplyOk: true,
    moreMenuOpen: false,
    hasWechatDraft: false,
    publishingWechat: false,
    sharingCommunity: false,
    xhsPreparing: false,
    wechatSharePreparing: false,
    wechatSharePath: '',
    wechatShareFailed: false,
    menus: { text: promptStore.menu('text'), image: promptStore.menu('image') },
    longpressMenuOpen: false,
    longpressMenu: null,
    longpressTarget: null,
    longpressAnchor: null,
    longpressLocalRows: [],
    inlineEditing: false,
    inlineEditSaving: false,
    inlineEditText: '',
    inlineEditOriginal: '',
    inlineEditLineNo: 0,
    inlineEditHeightPx: 0,
    inlineEditArticleIndex: 0,
    history: null,
    historyOpen: false,
    styleSheetOpen: false,
    styleSheetLoading: false,
    styleSheetRows: [],
    styleSheetSelectedVersion: null,
    styleSheetGenerated: {},
    styleSheetButtonText: '选一个版本',
    versionNav: { head: 0, canUndo: false, canRedo: false, undoHead: null, redoHead: null },
    statusBarHeight: 0,
    toolbarTop: 0,
    toolbarHeight: 64,
    playing: false,
    playback: playbackState.initial(),
    playbackProgress: 0,
    playbackMode: playbackState.MODE_IDLE,
    communityShareId: '',
    sharedToCommunity: false,
    wechatLoggingIn: false,
    photoScope: '',
    photoSheetOpen: false,
    photoPickerPhotos: [],
    photoPickerCount: 0,
    photoUploading: false,
    photoUploadFailed: false,
    photoSheetStatus: '',
    photoSheetTopPadding: 88,
    photoSheetToolbarRightPadding: 110,
    capsuleSafeRightPx: capsuleLayout.FALLBACK_SAFE_RIGHT_PX,
    photoInsertTip: '',
    photoInsertInstruction: '',
    photoInsertPromptVisible: false,
    holdEditState: 'idle',
    holdEditButtonText: '按住说话，修改文章',
    holdEditBubbleVisible: false,
    holdEditTranscriptText: '',
    holdEditLocatorsVisible: false,
    audioConsentVisible: false
  },

  onLoad(options) {
    const stem = decodeURIComponent(options.stem || '')
    const localRecording = app.globalData.currentRecording
    this.openedFromSharedArticle = String(options.fromShare || '') === '1' || !localRecording || localRecording.stem !== stem || app.globalData.sharedArticleStem === stem
    if (app.globalData.sharedArticleStem === stem) app.globalData.sharedArticleStem = ''
    const rec = localRecording || {
      stem,
      audioName: stem ? `${stem}.m4a` : ''
    }
    clearPhotoInsertPrompt(rec.stem)
    const sysInfo = wx.getSystemInfoSync()
    const statusBarHeight = (sysInfo && sysInfo.statusBarHeight) || 0
    let toolbarTop = statusBarHeight
    let toolbarHeight = 64
    let photoSheetToolbarRightPadding = 110
    let capsuleSafeRightPx = capsuleLayout.FALLBACK_SAFE_RIGHT_PX
    try {
      const menu = wx.getMenuButtonBoundingClientRect()
      if (menu && menu.top != null && menu.height) {
        toolbarTop = menu.top
        toolbarHeight = menu.height
        const windowWidth = (sysInfo && sysInfo.windowWidth) || 0
        if (windowWidth && menu.left != null) {
          capsuleSafeRightPx = capsuleLayout.safeRightPx(
            sysInfo,
            menu,
            capsuleLayout.rpxToPx(sysInfo, TOOLBAR_ACTION_GAP_RPX)
          )
          photoSheetToolbarRightPadding = capsuleSafeRightPx
        }
      }
    } catch (_) {
    }
    logPhotoInsert('on-load', {
      optionStem: stem,
      recStem: rec.stem,
      restoredPrompt: false,
      restoredInstructionLength: 0
    })
    const photoSheetTopPadding = toolbarTop + toolbarHeight + 12
    this.setData(Object.assign({
      rec,
      statusBarHeight,
      toolbarTop,
      toolbarHeight,
      capsuleSafeRightPx,
      photoSheetTopPadding,
      photoSheetToolbarRightPadding
    }, hiddenPhotoInsertPromptData()), () => {
      logPhotoInsert('on-load-setdata', {
        recStem: this.data.rec && this.data.rec.stem,
        photoInsertTip: this.data.photoInsertTip || '',
        instructionLength: String(this.data.photoInsertInstruction || '').length,
        promptVisible: !!this.data.photoInsertPromptVisible,
        loading: this.data.loading,
        hasCurrent: !!this.data.current
      })
      inspectPhotoInsertPromptLayout(this, 'on-load')
      this.restorePhotoPickerDraft()
    })
    this.createEditSession(rec.stem)
    this.loadMenus()
    this.load()
  },

  async loadMenus() {
    await promptStore.refresh()
    this.setData({ menus: { text: promptStore.menu('text'), image: promptStore.menu('image') } })
  },

  onUnload() {
    audioConsentFlow.dispose(this)
    this.photoLoadSeq = (this.photoLoadSeq || 0) + 1
    this.longpressQuerySeq = (this.longpressQuerySeq || 0) + 1
    if (this.finishImageLongpress) this.finishImageLongpress()
    if (this.stopPhotoMaking) this.stopPhotoMaking()
    this.stopPlayback()
    this.stopHoldArticleEdit()
    if (this.editSession) this.editSession.close()
  },

  onHide() {
    this._detailHidden = true
  },

  onShow() {
    if (this._detailHidden) {
      this._detailHidden = false
      if (this.editSession && this.editSession.connect) this.editSession.connect()
    }
    logPhotoInsert('on-show', {
      recStem: this.data.rec && this.data.rec.stem,
      photoInsertTip: this.data.photoInsertTip || '',
      instructionLength: String(this.data.photoInsertInstruction || '').length,
      promptVisible: !!this.data.photoInsertPromptVisible,
      hasPending: !!app.globalData.pendingPhotoInsert,
      hasPendingDoc: !!app.globalData.pendingPhotoInsertDoc
    })
    if (this.restorePhotoPickerDraft) this.restorePhotoPickerDraft()
    const updated = app.globalData.pendingPhotoInsertDoc
    if (updated && this.data.rec && updated.stem === this.data.rec.stem) {
      app.globalData.pendingPhotoInsertDoc = null
      if (updated.doc) this.applyDoc(updated.doc)
      this.refreshVersionNav()
      return
    }
    const pending = app.globalData.pendingPhotoInsert
    if (!pending || !this.data.rec || pending.stem !== this.data.rec.stem) return
    app.globalData.pendingPhotoInsert = null
    this.enqueueInstruction(pending.instruction, this.data.articleIndex || 0, pending.images)
  },

  goBack() {
    if (this.openedFromSharedArticle) {
      wx.reLaunch({ url: '/pages/recordings/index?tab=community' })
      return
    }
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    const previous = pages && pages.length > 1 ? pages[pages.length - 2] : null
    if (previous && previous.route === 'pages/insert-photo/index') {
      if (pages.length > 2) {
        wx.navigateBack({ delta: 2 })
        return
      }
      wx.redirectTo({ url: '/pages/recordings/index' })
      return
    }
    // After choosing photos on iOS, the system photo picker may push
    // an extra entry onto the page stack. navigateBack would pop that
    // entry and leave the user staring at the same detail page again.
    // Guard against this by checking whether the previous page is
    // actually the detail page itself.
    if (previous && previous.route === 'pages/detail/index') {
      if (pages.length > 2) {
        wx.navigateBack({ delta: 2 })
        return
      }
      wx.redirectTo({ url: '/pages/recordings/index' })
      return
    }
    // A detail page opened from a WeChat share is the root page of the
    // mini program. There is no page for navigateBack to pop, so return to
    // the VD community feed where shared articles are discovered.
    if (!previous) {
      wx.reLaunch({ url: '/pages/recordings/index?tab=community' })
      return
    }
    wx.navigateBack()
  },

  onShareAppMessage() {
    if (this.data.moreMenuOpen && this.setData) this.setData({ moreMenuOpen: false })
    const cover = (this.data.blocks || []).find((block) => block && block.type === 'photo' && block.url && !block.failed)
    const payload = {
      title: this.data.current && this.data.current.title || 'VoiceDrop 文章',
      path: this.data.wechatSharePath || '/pages/recordings/index'
    }
    if (cover) payload.imageUrl = cover.url
    return payload
  },

  onShareTimeline() {
    return {
      title: this.data.current && this.data.current.title || 'VoiceDrop 文章',
      query: this.data.wechatSharePath ? this.data.wechatSharePath.split('?')[1] : ''
    }
  },

  createEditSession(stem) {
    if (!stem) return
    this.editSession = articleEdit.createSession(stem, {
      onUpdated: (doc) => {
        if (library.cacheDoc) library.cacheDoc(stem, doc)
        this.applyRealtimeDoc(doc)
      },
      onQueueChanged: (queue) => this.onEditQueueChanged(queue),
      onReply: (text, ok) => this.onEditReply(text, ok),
      onResolved: () => this.refreshResolvedDoc(),
      onPreviewDone: (ok) => {
        if (ok) this.refreshResolvedDoc()
      },
      onState: (state) => this.setData({ editState: state }),
      onError: (message) => wx.showToast({ title: message || '修改失败', icon: 'error' })
    })
    this.editSession.connect()
  },

  ensureEditSession(stem) {
    const targetStem = stem || (this.data.rec && this.data.rec.stem)
    if (!targetStem) return null
    if (!this.editSession) this.createEditSession(targetStem)
    else if (this.editSession.connect) this.editSession.connect()
    return this.editSession
  },

  applyRealtimeDoc(doc) {
    if (!articleUtil.shouldRebuild(this.data.doc, doc)) {
      this.setData({ doc: articleUtil.parseDoc(doc) })
      return false
    }
    this.applyDoc(doc)
    return true
  },

  applyDoc(doc, photoScope, options) {
    if (this.data.inlineEditing) {
      this.pendingInlineEditDoc = doc
      return
    }
    this.longpressQuerySeq = (this.longpressQuerySeq || 0) + 1
    const pendingPhotoEdits = Object.keys(this.photoMakingTasks || {}).map((key) => {
      const block = (this.data.blocks || []).find((item) => item && item.type === 'photo' && item.key === key)
      const task = this.photoMakingTasks[key]
      return block ? {
        key,
        imageNo: block.imageNo,
        photoState: block.photoState,
        deadline: task && task.deadline
      } : null
    }).filter(Boolean)
    if (this.stopPhotoMaking) this.stopPhotoMaking()
    const articles = doc && doc.articles || []
    const articleIndex = Math.min(this.data.articleIndex || 0, Math.max(0, articles.length - 1))
    const current = articles[articleIndex] || null
    const articleTabs = articles.map((article, index) => ({
      index,
      title: article.title || `文章 ${index + 1}`,
      active: index === articleIndex
    }))
    const hasWechatDraft = articles.some((article) => article && article.wechatMediaId)
    const styleLabel = current && current.style != null ? `v${current.style} 风格` : '选风格'
    const body = current && current.body ? articleUtil.bodyWithoutDuplicateTitle(current) : ''
    const rawBlocks = body ? articleUtil.bodyBlocks(body) : []
    const deferPhotos = Boolean(options && options.deferPhotos)
    const scope = doc.owner || photoScope || (deferPhotos ? '' : this.data.photoScope) || ''
    const previousBlocks = this.data.photoScope === scope ? (this.data.blocks || []) : []
    let lineNo = 0
    let imageNo = 0
    const blocks = rawBlocks.map((block) => {
      lineNo += 1
      if (block.type !== 'photo') return Object.assign({}, block, { lineNo })
      imageNo += 1
      const key = articleUtil.resolvePhotoKey(block.key, doc.photos || []) || block.key
      const pending = pendingPhotoEdits.find((item) => item.imageNo === imageNo && item.key !== key)
      const previous = previousBlocks.find((item) =>
        item && item.type === 'photo' && item.key === key && item.imageNo === imageNo)
      const next = Object.assign({}, block, {
        key,
        lineNo,
        imageNo,
        url: '',
        previewUrl: '',
        imageVariant: '',
        remoteUrl: deferPhotos ? '' : library.photoUrl(key, scope),
        loading: true,
        loaded: false,
        photoState: pending && pending.photoState === 'making' ? 'making' : (pending ? 'grace' : 'loading')
      })
      if (!pending && previous && previous.url && previous.loaded && previous.photoState === 'loaded') {
        Object.assign(next, {
          url: previous.url,
          previewUrl: previous.previewUrl || '',
          imageVariant: previous.imageVariant || '',
          loading: false,
          loaded: true,
          failed: false,
          photoState: 'loaded',
          width: previous.width,
          height: previous.height
        })
      }
      return next
    })
    const update = {
      doc,
      current,
      articleIndex,
      articleTabs,
      hasWechatDraft,
      styleLabel,
      blocks,
      photoScope: scope
    }
    if (this.data.photoInsertPromptVisible) {
      clearPhotoInsertPrompt(this.data.rec && this.data.rec.stem)
      Object.assign(update, hiddenPhotoInsertPromptData())
    }
    this.setData(update)
    if (!deferPhotos && this.loadArticlePhotos) this.loadArticlePhotos(blocks, scope)
    pendingPhotoEdits.forEach((pending) => {
      const replacement = blocks.find((block) => block.type === 'photo' && block.imageNo === pending.imageNo && block.key !== pending.key)
      if (replacement) {
        this.startPhotoMaking(replacement.key, {
          poll: true,
          skipGrace: pending.photoState === 'making',
          deadline: pending.deadline
        })
      }
    })
  },

  loadArticlePhotos(blocks, scope) {
    const photoBlocks = (blocks || [])
      .map((block, index) => Object.assign({ index }, block))
      .filter((block) => block.type === 'photo' && block.key && block.photoState === 'loading')
    if (!photoBlocks.length || !library.downloadPhotoTemp) return
    this.photoLoadSeq = (this.photoLoadSeq || 0) + 1
    const seq = this.photoLoadSeq
    this.articlePhotoCache = this.articlePhotoCache || {}
    const pending = photoBlocks.slice()
    const loadNext = () => {
      if (seq !== this.photoLoadSeq) return Promise.resolve()
      const block = pending.shift()
      if (!block) return Promise.resolve()
      return this.loadArticlePhoto(seq, block, scope).finally(loadNext)
    }
    const workerCount = Math.min(ARTICLE_PHOTO_CONCURRENCY, pending.length)
    for (let index = 0; index < workerCount; index += 1) loadNext()
  },

  loadArticlePhoto(seq, block, scope) {
    const cacheKey = library.scopedPhotoKey
      ? library.scopedPhotoKey(block.key, scope)
      : `${scope || ''}${block.key}`
    const memoryCached = this.articlePhotoCache[cacheKey]
    const diskCached = !memoryCached && library.cachedPhotoPath
      ? library.cachedPhotoPath(block.key, scope)
      : ''
    const originalPath = memoryCached || diskCached
    if (originalPath) {
      this.articlePhotoCache[cacheKey] = originalPath
      this.updateArticlePhotoBlock(seq, block.index, {
        url: originalPath,
        previewUrl: '',
        imageVariant: 'original',
        loading: false,
        loaded: false,
        failed: false,
        photoState: 'loading'
      }, block.key)
      return Promise.resolve()
    }

    const previewPath = library.cachedPhotoPath
      ? library.cachedPhotoPath(block.key, scope, { preferThumb: true })
      : ''
    if (previewPath) {
      this.updateArticlePhotoBlock(seq, block.index, {
        url: previewPath,
        previewUrl: previewPath,
        imageVariant: 'thumbnail',
        loading: false,
        loaded: false,
        failed: false,
        photoState: 'loading'
      }, block.key)
      this.loadArticleOriginalPhoto(seq, block.index, block.key, scope, previewPath)
      return Promise.resolve()
    }

    return library.downloadPhotoTemp(block.key, scope)
      .then((tempPath) => {
        if (!tempPath) throw new Error('empty photo path')
        this.articlePhotoCache[cacheKey] = tempPath
        if (this.inspectDownloadedArticlePhoto) this.inspectDownloadedArticlePhoto(tempPath, block.key, scope)
        this.updateArticlePhotoBlock(seq, block.index, {
          url: tempPath,
          previewUrl: '',
          imageVariant: 'original',
          loading: false,
          loaded: false,
          failed: false,
          photoState: 'loading'
        }, block.key)
      })
      .catch((error) => {
        logPhotoInsert('render-download-fail', { key: block.key, scope, error })
        this.updateArticlePhotoBlock(seq, block.index, {
          loading: false,
          failed: true,
          photoState: 'loadFailed'
        }, block.key)
      })
  },

  loadArticleOriginalPhoto(seq, index, key, scope, previewPath) {
    const cacheKey = library.scopedPhotoKey
      ? library.scopedPhotoKey(key, scope)
      : `${scope || ''}${key}`
    return library.downloadPhotoTemp(key, scope)
      .then((originalPath) => {
        if (!originalPath || seq !== this.photoLoadSeq) return
        const block = (this.data.blocks || [])[index]
        if (!block || block.type !== 'photo' || block.key !== key) return
        this.articlePhotoCache[cacheKey] = originalPath
        if (!wx.getImageInfo) return
        wx.getImageInfo({
          src: originalPath,
          success: (info) => {
            this.updateArticlePhotoBlock(seq, index, {
              url: originalPath,
              previewUrl: previewPath,
              imageVariant: 'original',
              photoState: 'loaded',
              loading: false,
              loaded: true,
              failed: false,
              width: Number(info && info.width) || block.width,
              height: Number(info && info.height) || block.height
            }, key)
          },
          fail: () => {
            // Keep the rendered thumbnail. The original remains cached for next time.
          }
        })
      })
      .catch(() => {
        // A thumbnail is already visible, so original-image failure is not terminal.
      })
  },

  inspectDownloadedArticlePhoto(filePath, key, scope) {
    if (!wx.getImageInfo || !filePath) return
    wx.getImageInfo({
      src: filePath,
      success: (info) => {
        logPhotoInsert('downloaded-image-info', {
          key,
          scope,
          filePath,
          width: info.width,
          height: info.height,
          type: info.type,
          path: info.path
        })
      },
      fail: (error) => {
        logPhotoInsert('downloaded-image-info-fail', { key, scope, filePath, error })
      }
    })
  },

  updateArticlePhotoBlock(seq, index, patch, expectedKey) {
    if (seq !== this.photoLoadSeq) return
    const current = (this.data.blocks || []).slice()
    if (!current[index] || current[index].type !== 'photo') return
    if (expectedKey && current[index].key !== expectedKey) return
    current[index] = Object.assign({}, current[index], patch)
    this.setData({ blocks: current })
  },

  updatePhotoMakingBlock(key, patch) {
    const blocks = (this.data.blocks || []).slice()
    const index = blocks.findIndex((block) => block && block.type === 'photo' && block.key === key)
    if (index < 0) return false
    blocks[index] = Object.assign({}, blocks[index], patch)
    this.setData({ blocks })
    return true
  },

  startPhotoMakingForInstruction(instruction) {
    const match = /\[\[photo:([^\]]+)\]\]/.exec(String(instruction || ''))
    if (match) this.startPhotoMaking(match[1], { poll: false })
  },

  startPhotoMaking(key, options) {
    const shouldPoll = !options || options.poll !== false
    const skipGrace = Boolean(options && options.skipGrace)
    this.photoLoadSeq = (this.photoLoadSeq || 0) + 1
    if (!key || !this.updatePhotoMakingBlock(key, {
      photoState: skipGrace ? 'making' : 'grace',
      url: '',
      previewUrl: '',
      imageVariant: '',
      loaded: false,
      failed: false
    })) return
    const cacheKey = library.scopedPhotoKey ? library.scopedPhotoKey(key, this.data.photoScope) : `${this.data.photoScope || ''}${key}`
    if (library.removeCachedPhotos) library.removeCachedPhotos([cacheKey])
    if (this.articlePhotoCache) delete this.articlePhotoCache[cacheKey]
    this.stopPhotoMaking(key)
    this.photoMakingTasks = this.photoMakingTasks || {}
    const generation = (this.photoMakingGeneration || 0) + 1
    this.photoMakingGeneration = generation
    const task = {
      generation,
      deadline: Number(options && options.deadline) || Date.now() + 300000,
      timer: null,
      shouldPoll
    }
    this.photoMakingTasks[key] = task
    if (skipGrace) {
      if (task.shouldPoll) this.pollMakingPhoto(key, generation)
      return
    }
    task.timer = setTimeout(() => {
      if (this.photoMakingTasks && this.photoMakingTasks[key] === task) {
        this.updatePhotoMakingBlock(key, { photoState: 'making' })
        if (task.shouldPoll) this.pollMakingPhoto(key, generation)
        else task.timer = setTimeout(() => {
          if (this.photoMakingTasks && this.photoMakingTasks[key] === task) {
            this.updatePhotoMakingBlock(key, { photoState: 'failed', failed: true })
            this.stopPhotoMaking(key)
          }
        }, Math.max(0, task.deadline - Date.now()))
      }
    }, 900)
  },

  async pollMakingPhoto(key, generation) {
    const task = this.photoMakingTasks && this.photoMakingTasks[key]
    if (!task || task.generation !== generation) return
    if (Date.now() >= task.deadline) {
      this.updatePhotoMakingBlock(key, { photoState: 'failed', failed: true })
      this.stopPhotoMaking(key)
      return
    }
    try {
      const url = await library.downloadPhotoTemp(key, this.data.photoScope, { cacheBust: Date.now() })
      const current = this.photoMakingTasks && this.photoMakingTasks[key]
      if (!current || current.generation !== generation) return
      if (Date.now() >= current.deadline) {
        this.updatePhotoMakingBlock(key, { photoState: 'failed', failed: true })
        this.stopPhotoMaking(key)
        return
      }
      this.articlePhotoCache = this.articlePhotoCache || {}
      const cacheKey = library.scopedPhotoKey ? library.scopedPhotoKey(key, this.data.photoScope) : `${this.data.photoScope || ''}${key}`
      this.articlePhotoCache[cacheKey] = url
      this.updatePhotoMakingBlock(key, {
        photoState: 'loading',
        url,
        previewUrl: '',
        imageVariant: 'original',
        loading: false,
        loaded: false,
        failed: false
      })
      this.stopPhotoMaking(key)
    } catch (_) {
      const current = this.photoMakingTasks && this.photoMakingTasks[key]
      if (!current || current.generation !== generation) return
      current.timer = setTimeout(() => this.pollMakingPhoto(key, generation), 3000)
    }
  },

  retryMakingPhoto(event) {
    const key = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.key
    if (key) this.startPhotoMaking(key, { poll: true })
  },

  stopPhotoMaking(key) {
    const tasks = this.photoMakingTasks || {}
    const keys = key ? [key] : Object.keys(tasks)
    keys.forEach((itemKey) => {
      const task = tasks[itemKey]
      if (task && task.timer != null) clearTimeout(task.timer)
      delete tasks[itemKey]
    })
  },

  onArticleImageLoad(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset || {}
    const index = Number(dataset.index)
    const block = Number.isInteger(index) ? (this.data.blocks || [])[index] : null
    logPhotoInsert('image-load', {
      index,
      key: block && block.key,
      url: block && block.url,
      width: event && event.detail && event.detail.width,
      height: event && event.detail && event.detail.height
    })
    if (!block) return
    if (dataset.key && dataset.key !== block.key) return
    if (dataset.url && dataset.url !== block.url) return
    const retryKey = `${block.key || ''}|${block.remoteUrl || ''}`
    if (this.articlePhotoTriedRemote) delete this.articlePhotoTriedRemote[retryKey]
    this.updateArticlePhotoBlock(this.photoLoadSeq, index, {
      photoState: 'loaded',
      loading: false,
      loaded: true,
      failed: false,
      width: Number(event && event.detail && event.detail.width) || block.width,
      height: Number(event && event.detail && event.detail.height) || block.height
    })
  },

  onArticleImageError(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset || {}
    const index = Number(dataset.index)
    const block = Number.isInteger(index) ? (this.data.blocks || [])[index] : null
    const url = block && block.url
    logPhotoInsert('image-error', {
      index,
      key: block && block.key,
      url,
      remoteUrl: block && block.remoteUrl,
      detail: event && event.detail
    })
    if (!block || block.failed) return
    if (dataset.key && dataset.key !== block.key) return
    if (dataset.url && dataset.url !== block.url) return
    if (block.imageVariant === 'original' && block.previewUrl && block.previewUrl !== url) {
      this.updateArticlePhotoBlock(this.photoLoadSeq, index, {
        url: block.previewUrl,
        imageVariant: 'thumbnail',
        photoState: 'loaded',
        loading: false,
        loaded: true,
        failed: false
      }, block.key)
      return
    }
    const retryKey = `${block.key || ''}|${block.remoteUrl || ''}`
    this.articlePhotoTriedRemote = this.articlePhotoTriedRemote || {}
    const canTryRemote = block.remoteUrl && block.remoteUrl !== url && !this.articlePhotoTriedRemote[retryKey]
    if (canTryRemote) {
      this.articlePhotoTriedRemote[retryKey] = true
      this.updateArticlePhotoBlock(this.photoLoadSeq, index, {
        url: block.remoteUrl,
        photoState: 'loading',
        loading: false,
        loaded: false,
        failed: false
      })
      return
    }
    delete this.articlePhotoTriedRemote[retryKey]
    this.updateArticlePhotoBlock(this.photoLoadSeq, index, {
      url: '',
      photoState: 'loadFailed',
      loading: false,
      loaded: false,
      failed: true
    })
  },

  selectArticle(event) {
    if (this.data.inlineEditing) return
    const index = Number(event.currentTarget.dataset.index)
    if (!this.data.doc || !this.data.doc.articles || !Number.isInteger(index)) return
    if (index < 0 || index >= this.data.doc.articles.length || index === this.data.articleIndex) return
    this.setData({ articleIndex: index })
    this.applyDoc(this.data.doc)
    this._wechatShareRequestId = (this._wechatShareRequestId || 0) + 1
    this._wechatShareStem = ''
    this._wechatShareSection = -1
    this.setData({ wechatSharePreparing: false, wechatSharePath: '', wechatShareFailed: false })
  },

  async load() {
    const rec = this.data.rec
    if (!rec || !rec.stem) return
    const seq = (this._detailLoadSeq || 0) + 1
    this._detailLoadSeq = seq
    let resolvedPhotoScope = ''
    const scopeTask = library.ownerScope()
      .then((scope) => {
        resolvedPhotoScope = scope || ''
        return resolvedPhotoScope
      })
      .catch(() => '')
    const cached = library.cachedDoc ? library.cachedDoc(rec.stem) : null
    if (cached) {
      this.applyDoc(cached, cached.owner || '', { deferPhotos: !cached.owner })
      this.setData({ loading: false })
    } else {
      this.setData({ loading: true })
    }
    const earlyScopeRender = scopeTask.then((photoScope) => {
      if (seq !== this._detailLoadSeq || !photoScope || !this.data.doc ||
          !this.data.rec || this.data.rec.stem !== rec.stem) return photoScope
      if (photoScope !== this.data.photoScope) this.applyDoc(this.data.doc, photoScope)
      return photoScope
    })
    try {
      const doc = await library.fetchDoc(rec.stem)
      if (seq !== this._detailLoadSeq || !this.data.rec || this.data.rec.stem !== rec.stem) return
      if (doc) {
        const knownScope = doc.owner || resolvedPhotoScope || this.data.photoScope || ''
        this.applyDoc(doc, knownScope, { deferPhotos: !knownScope })
        this.setData({ loading: false })
      }
    } catch (error) {
      if (!cached) wx.showToast({ title: '加载失败', icon: 'error' })
    } finally {
      if (seq === this._detailLoadSeq && !cached) this.setData({ loading: false })
    }
    this.refreshVersionNav()
    this.refreshCommunityShareState()
    const photoScope = await earlyScopeRender
    if (seq !== this._detailLoadSeq || !photoScope || !this.data.doc ||
        !this.data.rec || this.data.rec.stem !== rec.stem) return
    if (photoScope !== this.data.photoScope) this.applyDoc(this.data.doc, photoScope)
  },

  async refreshResolvedDoc() {
    const rec = this.data.rec
    if (!rec || !rec.stem) return
    const fresh = await library.fetchDoc(rec.stem).catch(() => null)
    if (!fresh || !this.data.rec || this.data.rec.stem !== rec.stem) return
    this.applyRealtimeDoc(fresh)
    await this.refreshVersionNav()
  },

  async shareArticle() {
    const url = await library.shareUrl(this.data.rec, 0)
    if (!url) {
      wx.showToast({ title: '分享失败', icon: 'error' })
      return
    }
    wx.setClipboardData({ data: url })
  },

  copyArticleText() {
    if (!this.data.doc || !this.data.doc.articles) return
    wx.setClipboardData({ data: articleUtil.shareText(this.data.doc.articles) })
  },

  async copyArticleWithLink() {
    if (!this.data.doc || !this.data.doc.articles) return
    const url = await library.shareUrl(this.data.rec, 0)
    if (!url) {
      wx.showToast({ title: '分享失败', icon: 'error' })
      return
    }
    const text = articleUtil.shareText(this.data.doc.articles)
    wx.setClipboardData({
      data: articleUtil.shareTextForTarget(text, url, 'wechat'),
      success: () => {
        if (wx.hideToast) wx.hideToast()
      }
    })
  },

  async prepareWechatShareCard(sectionOverride) {
    const rec = this.data.rec
    const section = Number.isInteger(sectionOverride) ? sectionOverride : (this.data.articleIndex || 0)
    if (!rec || !rec.stem || this.data.wechatSharePreparing) return
    if (this._wechatShareStem === rec.stem && this._wechatShareSection === section && this.data.wechatSharePath) return
    const cachedShareId = publicShare.cachedId(rec.stem)
    if (cachedShareId) {
      this._wechatShareStem = rec.stem
      this._wechatShareSection = section
      this.setData({
        wechatSharePreparing: false,
        wechatShareFailed: false,
        wechatSharePath: `/pages/shared-article/index?shareId=${encodeURIComponent(cachedShareId)}&section=${section}&fromShare=1`
      })
      return
    }
    const requestId = (this._wechatShareRequestId || 0) + 1
    this._wechatShareRequestId = requestId
    this.setData({ wechatSharePreparing: true, wechatSharePath: '', wechatShareFailed: false })
    try {
      const url = await library.shareUrl(rec, section)
      const shareId = publicShare.shareIdFromUrl(url)
      if (!shareId) {
        if (requestId === this._wechatShareRequestId) this.setData({ wechatShareFailed: true })
        return
      }
      if (requestId !== this._wechatShareRequestId) return
      publicShare.storeId(rec.stem, shareId)
      this._wechatShareStem = rec.stem
      this._wechatShareSection = section
      this.setData({ wechatSharePath: `/pages/shared-article/index?shareId=${encodeURIComponent(shareId)}&section=${section}&fromShare=1` })
    } catch (_) {
      if (requestId === this._wechatShareRequestId) this.setData({ wechatShareFailed: true })
    } finally {
      if (requestId === this._wechatShareRequestId) this.setData({ wechatSharePreparing: false })
    }
  },

  async shareToXhs() {
    if (this.data.xhsPreparing) {
      wx.showToast({ title: '正在准备小红书素材…', icon: 'none' })
      return
    }
    const rec = this.data.rec
    if (!rec || !rec.stem) return
    this.setData({ xhsPreparing: true })
    if (wx.showLoading) wx.showLoading({ title: '正在准备素材…', mask: true })
    try {
      const prepared = await xhsExport.prepare(rec.stem)
      if (!prepared.ok) {
        wx.showToast({ title: '小红书文案生成失败', icon: 'none' })
        return
      }
      if (wx.setClipboardData) wx.setClipboardData({ data: prepared.clipboardText })

      const canSaveToAlbum = await albumPermission.ensure(wx)
      if (!canSaveToAlbum) {
        this.showXhsPrepared(0, false)
        return
      }

      const originalPhotos = await this.downloadXhsPhotos(prepared.pack.photoKeys)
      const cardSlots = xhsExport.generatedCardSlots(originalPhotos.length)
      const textCards = await this.renderXhsCards(prepared.pack, cardSlots)
      const saved = await this.saveXhsImages(originalPhotos.concat(textCards).slice(0, xhsExport.MAX_IMAGES))
      this.showXhsPrepared(saved, true)
    } catch (_) {
      wx.showToast({ title: '小红书素材准备失败', icon: 'none' })
    } finally {
      if (wx.hideLoading) wx.hideLoading()
      this.setData({ xhsPreparing: false })
    }
  },

  async downloadXhsPhotos(photoKeys) {
    const paths = []
    const scope = this.data.photoScope || await library.ownerScope().catch(() => '')
    for (const key of photoKeys || []) {
      if (paths.length >= xhsExport.MAX_IMAGES) break
      try {
        const path = await library.downloadPhotoTemp(key, scope, { preferThumb: false })
        if (path) paths.push(path)
      } catch (_) {
        // A missing original photo should not prevent the user from getting copy and text cards.
      }
    }
    return paths
  },

  async renderXhsCards(pack, maxCards) {
    if (!maxCards || !wx.createCanvasContext || !wx.canvasToTempFilePath) return []
    const measureContext = wx.createCanvasContext('xhsExportCanvas', this)
    xhsCards.applyCanvasFont(measureContext, xhsCards.BODY_FONT_SIZE, 400)
    const measureBodyText = (value) => {
      try {
        const result = measureContext.measureText && measureContext.measureText(String(value || ''))
        if (result && Number.isFinite(Number(result.width))) return Number(result.width)
      } catch (_) {
      }
      return xhsCards.estimatedWidth(value, xhsCards.BODY_FONT_SIZE)
    }
    const cards = xhsCards.buildCards(
      pack.title,
      pack.body,
      xhsCardDate(this.data.rec),
      maxCards,
      measureBodyText
    )
    const paths = []
    for (let index = 0; index < cards.length; index += 1) {
      try {
        const path = await this.renderXhsCard(cards[index], index + 1, cards.length)
        if (path) paths.push(path)
      } catch (_) {
        break
      }
    }
    return paths
  },

  renderXhsCard(card, page, total) {
    return new Promise((resolve, reject) => {
      const ctx = wx.createCanvasContext('xhsExportCanvas', this)
      if (!ctx) return reject(new Error('canvas unavailable'))
      const width = xhsCards.CARD_WIDTH
      const height = xhsCards.CARD_HEIGHT
      if (ctx.setTextBaseline) ctx.setTextBaseline('top')
      if (ctx.setTextAlign) ctx.setTextAlign('left')
      ctx.setFillStyle('#f5f1e8')
      ctx.fillRect(0, 0, width, height)
      if (card.kind === 'title') {
        ctx.setFillStyle('#8d8372')
        xhsCards.applyCanvasFont(ctx, 30, 400)
        if (card.date) ctx.fillText(card.date, 112, 200)
        ctx.setFillStyle('#b9502e')
        ctx.fillRect(112, 286, 76, 8)
        ctx.setFillStyle('#3a352e')
        xhsCards.applyCanvasFont(ctx, 78, 600)
        const measureTitleText = (value) => {
          try {
            const result = ctx.measureText && ctx.measureText(String(value || ''))
            if (result && Number.isFinite(Number(result.width))) return Number(result.width)
          } catch (_) {
          }
          return xhsCards.estimatedWidth(value, 78)
        }
        const titleLines = xhsCards.titleLines(card.title, measureTitleText).slice(0, 8)
        titleLines.forEach((line, index) => ctx.fillText(line, 110, 380 + index * 104))
      } else {
        ctx.setFillStyle('#3a352e')
        xhsCards.applyCanvasFont(ctx, 42, 400)
        ;(card.lines || []).forEach((line) => ctx.fillText(line.text, xhsCards.BODY_LEFT, line.y))
      }
      ctx.setFillStyle('#8d8372')
      xhsCards.applyCanvasFont(ctx, 26, 500)
      const pageLabel = `${page} / ${total}`
      let pageWidth = xhsCards.estimatedWidth(pageLabel, 26)
      try {
        const measured = ctx.measureText && ctx.measureText(pageLabel)
        if (measured && Number.isFinite(Number(measured.width))) pageWidth = Number(measured.width)
      } catch (_) {
      }
      ctx.fillText(pageLabel, (width - pageWidth) / 2, height - 84)
      ctx.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: 'xhsExportCanvas',
          x: 0,
          y: 0,
          width,
          height,
          destWidth: width,
          destHeight: height,
          fileType: 'jpg',
          quality: 0.92,
          success: (result) => resolve(result.tempFilePath),
          fail: reject
        }, this)
      })
    })
  },

  async saveXhsImages(paths) {
    if (!wx.saveImageToPhotosAlbum) return 0
    let saved = 0
    for (const filePath of paths || []) {
      try {
        await new Promise((resolve, reject) => {
          wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject })
        })
        saved += 1
      } catch (_) {
        // Preserve successful images when an individual image cannot be written.
      }
    }
    return saved
  },

  showXhsPrepared(saved, galleryAllowed) {
    const content = !galleryAllowed
      ? '文案已复制。相册权限未开启，请手动打开小红书后粘贴文案。'
      : saved > 0
        ? `文案已复制，${saved} 张图片已保存到相册。请打开小红书，选中这些图片并粘贴文案发布。`
        : '文案已复制，但图片未能保存。请稍后重试，或直接在小红书粘贴文案。'
    if (wx.showModal) {
      wx.showModal({ title: '小红书素材已准备', content, showCancel: false })
    } else {
      wx.showToast({ title: saved > 0 ? '文案和图片已准备' : '文案已复制', icon: 'none' })
    }
  },

  async togglePlayback() {
    if (this.data.playbackMode !== playbackState.MODE_IDLE) {
      this.stopPlayback()
      return
    }
    const request = playbackState.requestPlay(this.data.playback)
    if (!request.accepted) return
    this.applyPlayback(request.state)
    if (!this.data.rec || !this.data.rec.audioName) {
      this.applyPlayback(playbackState.failed())
      wx.showToast({ title: '没有音频', icon: 'error' })
      return
    }
    audioSessionReset.preparePlayback()
    wx.showLoading({ title: '加载音频' })
    try {
      const filePath = this._playbackFilePath || await library.downloadAudioFile(this.data.rec.audioName)
      this._playbackFilePath = filePath
      this.audioContext = wx.createInnerAudioContext()
      this.audioContext.src = filePath
      this.audioContext.onCanplay(() => this.applyPlayback(playbackState.started()))
      this.audioContext.onTimeUpdate(() => this.updatePlaybackProgress())
      this.audioContext.onEnded(() => this.applyPlayback(playbackState.completed()))
      this.audioContext.onStop(() => this.applyPlayback(playbackState.completed()))
      this.audioContext.onError(() => this.applyPlayback(playbackState.failed()))
      this.audioContext.play()
      this.applyPlayback(playbackState.started())
    } catch (error) {
      this.applyPlayback(playbackState.failed())
      wx.showToast({ title: '播放失败', icon: 'error' })
    } finally {
      wx.hideLoading()
    }
  },

  stopPlayback() {
    if (this.audioContext) {
      this.audioContext.stop()
      this.audioContext.destroy()
      this.audioContext = null
    }
    if (this.data) this.applyPlayback(playbackState.requestStop(this.data.playback).state)
  },

  updatePlaybackProgress() {
    if (!this.audioContext) return
    const progress = playbackState.progress(this.audioContext.currentTime, this.audioContext.duration)
    this.applyPlayback({ mode: playbackState.MODE_PLAYING, progress })
  },

  applyPlayback(state) {
    const next = state || playbackState.initial()
    this.setData({
      playback: next,
      playbackMode: next.mode,
      playbackProgress: Math.round(next.progress * 100),
      playing: next.mode === playbackState.MODE_PLAYING
    })
    this.drawPlaybackRing(next.progress)
  },

  drawPlaybackRing(progress) {
    if (!wx.createCanvasContext) return
    const ctx = wx.createCanvasContext('playbackRingCanvas', this)
    if (!ctx) return
    const clamped = Math.max(0, Math.min(1, Number(progress) || 0))
    const ringSize = PLAYBACK_RING_CANVAS_SIZE
    const lineWidth = PLAYBACK_RING_LINE_WIDTH
    const center = ringSize / 2
    const radius = center - lineWidth / 2
    ctx.clearRect(0, 0, ringSize, ringSize)
    ctx.setLineWidth(lineWidth)
    ctx.setLineCap('round')
    ctx.setStrokeStyle('#eadfce')
    ctx.beginPath()
    ctx.arc(center, center, radius, 0, Math.PI * 2)
    ctx.stroke()
    if (clamped > 0) {
      ctx.setStrokeStyle('#d8593b')
      ctx.beginPath()
      ctx.arc(center, center, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamped)
      ctx.stroke()
    }
    ctx.draw()
  },

  async publishWechat() {
    if (this.data.publishingWechat) return
    this.setData({ publishingWechat: true })
    wx.showLoading({ title: this.data.hasWechatDraft ? '正在更新' : '正在发布' })
    try {
      const binding = await settings.wechatBindStatus()
      if (!binding.connected) {
        wx.navigateTo({ url: '/pages/wechat-settings/index' })
        return
      }
      const result = await library.publishWechat(this.data.rec)
      if (result.ok) {
        this.setData({ hasWechatDraft: true })
        wx.showToast({ title: result.updated ? '草稿已更新' : '草稿已创建' })
      } else if (result.notConfigured) {
        wx.navigateTo({ url: '/pages/wechat-settings/index' })
      } else {
        wx.showModal({ title: '发布失败', content: result.message || '发布失败', showCancel: false })
      }
    } catch (_) {
      wx.showModal({ title: '发布失败', content: '网络异常，请稍后再试', showCancel: false })
    } finally {
      this.setData({ publishingWechat: false })
      wx.hideLoading()
    }
  },

  async restyle() {
    wx.showLoading({ title: '已提交' })
    try {
      await library.restyle(this.data.rec)
      wx.showToast({ title: '正在改写' })
    } finally {
      wx.hideLoading()
    }
  },

  async chooseStyleRewrite() {
    return this.openStyleSheet()
  },

  async openStyleSheet() {
    if (this.data.inlineEditing) return
    this.setData({
      styleSheetOpen: true,
      styleSheetLoading: true,
      styleSheetRows: [],
      styleSheetButtonText: '加载中...'
    })
    try {
      const styleHistory = await settings.loadStyleHistory()
      const articleHistory = this.data.history || await library.versionHistory(this.data.rec)
      const versions = styleHistory.versions || []
      const generated = styleRewrite.generatedVersions(articleHistory)
      if (!versions.length) {
        this.setData({
          styleSheetOpen: false,
          styleSheetLoading: false,
          styleSheetRows: [],
          styleSheetGenerated: {},
          styleSheetSelectedVersion: null,
          styleSheetButtonText: '选一个版本'
        })
        wx.showToast({ title: '暂无文风版本', icon: 'error' })
        return
      }
      const currentVersion = this.data.current && this.data.current.style != null
        ? Number(this.data.current.style)
        : null
      const rows = styleSelection.selectedRows(versions, currentVersion)
        .map((row) => Object.assign({}, row, {
          generated: !!generated[row.v],
          actionText: styleRewrite.buttonText(row.v, generated)
        }))
      const selectedVersion = rows.some((row) => row.v === currentVersion)
        ? currentVersion
        : rows[0].v
      const selectedRows = rows.map((row) => Object.assign({}, row, {
        selected: row.v === selectedVersion
      }))
      this.setData({
        styleSheetLoading: false,
        styleSheetRows: selectedRows,
        styleSheetGenerated: generated,
        styleSheetSelectedVersion: selectedVersion,
        styleSheetButtonText: styleRewrite.buttonText(selectedVersion, generated)
      })
    } catch (error) {
      this.setData({ styleSheetOpen: false, styleSheetLoading: false })
      wx.showToast({ title: '文风加载失败', icon: 'error' })
    }
  },

  closeStyleSheet() {
    this.setData({ styleSheetOpen: false, styleSheetLoading: false })
  },

  selectStyleSheetVersion(event) {
    const version = Number(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.version)
    if (Number.isNaN(version)) return
    const generated = this.data.styleSheetGenerated || {}
    this.setData({
      styleSheetSelectedVersion: version,
      styleSheetRows: (this.data.styleSheetRows || []).map((row) => Object.assign({}, row, {
        selected: row.v === version
      })),
      styleSheetButtonText: styleRewrite.buttonText(version, generated)
    })
  },

  async submitStyleSheet() {
    const version = Number(this.data.styleSheetSelectedVersion)
    if (Number.isNaN(version)) {
      wx.showToast({ title: '请选择文风', icon: 'error' })
      return
    }
    this.setData({ styleSheetOpen: false, styleSheetLoading: false })
    await this.requestStyleRewriteOrSwitch(version, this.data.styleSheetGenerated || {})
  },

  async chooseStyleRewriteLegacy() {
    wx.showLoading({ title: '加载文风' })
    try {
      const styleHistory = await settings.loadStyleHistory()
      const articleHistory = this.data.history || await library.versionHistory(this.data.rec)
      const versions = styleHistory.versions || []
      const generated = styleRewrite.generatedVersions(articleHistory)
      if (!versions.length) {
        wx.showToast({ title: '暂无文风版本', icon: 'error' })
        return
      }
      wx.showActionSheet({
        itemList: versions.slice().reverse().map((item, index) => {
          const fallbackV = versions.length - 1 - index
          return styleRewrite.choiceLabel(Object.assign({ v: fallbackV }, item), generated)
        }),
        success: async (res) => {
          const item = versions.slice().reverse()[res.tapIndex]
          const fallbackV = versions.length - 1 - res.tapIndex
          const styleVersion = Number(item && item.v != null ? item.v : fallbackV)
          await this.requestStyleRewriteOrSwitch(styleVersion, generated)
        }
      })
    } catch (error) {
      wx.showToast({ title: '文风加载失败', icon: 'error' })
    } finally {
      wx.hideLoading()
    }
  },

  async requestStyleRewriteOrSwitch(styleVersion, generated) {
    const existing = generated && generated[styleVersion]
    if (existing) {
      await this.switchArticleHead(Number(existing.v || 0))
      return
    }
    wx.showLoading({ title: '正在重写' })
    try {
      const result = library.restyleResult
        ? await library.restyleResult(this.data.rec, styleVersion)
        : { ok: await library.restyle(this.data.rec, styleVersion) }
      if (result.ok) {
        await this.refreshResolvedDoc()
        this.setData({ styleLabel: `v${styleVersion} 风格` })
        wx.showToast({ title: '重写成功', icon: 'success' })
      } else {
        wx.showModal({
          title: '提交失败',
          content: result.message || '提交失败',
          showCancel: false
        })
      }
    } finally {
      wx.hideLoading()
    }
  },

  async toggleHistory() {
    if (this.data.historyOpen) {
      this.setData({ historyOpen: false })
      return
    }
    try {
      const history = await library.versionHistory(this.data.rec)
      this.setData({
        history,
        historyOpen: true,
        versionNav: versionNav.state(history, this.data.editQueue.length > 0)
      })
    } catch (error) {
      wx.showToast({ title: '历史加载失败', icon: 'error' })
    }
  },

  async switchVersion(event) {
    const head = Number(event.currentTarget.dataset.head)
    await this.switchArticleHead(head)
  },

  async switchArticleHead(head) {
    if (this.data.editQueue.length) {
      wx.showToast({ title: '修改完成后再切换', icon: 'error' })
      return
    }
    const ok = await library.patchHead(this.data.rec, head)
    if (ok) {
      wx.showToast({ title: '已切换版本' })
      await this.load()
      this.setData({ historyOpen: false })
    } else {
      wx.showToast({ title: '切换失败', icon: 'error' })
    }
  },

  async navigateVersion(event) {
    const direction = Number(event.currentTarget.dataset.direction)
    const target = direction < 0 ? this.data.versionNav.undoHead : this.data.versionNav.redoHead
    if (target == null) {
      wx.showToast({ title: direction < 0 ? '没有更早版本' : '没有更新版本', icon: 'error' })
      return
    }
    await this.switchArticleHead(target)
  },

  async refreshVersionNav() {
    try {
      const history = await library.versionHistory(this.data.rec)
      this.setData({
        history,
        versionNav: versionNav.state(history, this.data.editQueue.length > 0)
      })
    } catch (error) {
    }
  },

  onEditQueueChanged(queue) {
    const nextQueue = queue || []
    const firstId = nextQueue[0] && nextQueue[0].id
    const editFeedbackQueue = nextQueue.slice().reverse().map((item) => ({
      id: item.id,
      text: item.text || '',
      inFlight: item.id === firstId
    }))
    const talking = this.data.holdEditState === 'talking' || this.data.holdEditState === 'canceling' || this.data.holdEditState === 'finishing'
    this.setData({
      editQueue: nextQueue,
      editFeedbackQueue,
      holdEditButtonText: talking
        ? this.data.holdEditButtonText
        : (nextQueue.length ? '正在改…按住继续说' : '按住说话，修改文章'),
      versionNav: versionNav.state(this.data.history, nextQueue.length > 0)
    })
  },

  onEditReply(text, ok) {
    this.setData({
      editReply: text || (ok ? '已更新' : '修改失败'),
      editReplyOk: ok !== false
    })
  },

  onEditInput(event) {
    this.setData({ editText: event.detail.value })
  },

  submitEdit() {
    const session = this.ensureEditSession()
    if (!session || !this.data.editText.trim()) return
    session.enqueue(this.data.editText, this.data.articleIndex || 0)
    this.setData({ editText: '', editPanelOpen: false })
  },

  openEditPanel() {
    this.setData({ editPanelOpen: true })
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

  async startHoldArticleEdit(event) {
    if (this._holdEditFinishing || this._holdEditTouchActive) return
    const touch = event && event.touches && event.touches[0]
    this._holdEditStartY = touch ? touch.clientY : 0
    this._holdEditTouchActive = true
    this._pendingHoldEditStart = true
    this.setData({
      holdEditState: 'talking',
      holdEditButtonText: '松开 发送 · 上滑取消',
      holdEditBubbleVisible: true,
      holdEditTranscriptText: '正在连接…',
      holdEditLocatorsVisible: true
    })
    if (!await this.requestAudioConsent() || !this._holdEditTouchActive) {
      this._pendingHoldEditStart = false
      this.resetHoldArticleEdit()
      return
    }
    if (!await recordPermission.ensure(wx) || !this._holdEditTouchActive) {
      this._pendingHoldEditStart = false
      this.resetHoldArticleEdit()
      return
    }
    this._pendingHoldEditStart = false
    this.beginHoldArticleEdit()
  },

  beginHoldArticleEdit() {
    if (!this._holdEditTouchActive) return
    const sessionId = (this._holdEditSessionId || 0) + 1
    this._holdEditSessionId = sessionId
    this._activeHoldEditSessionId = sessionId
    this._holdEditCanceled = false
    this._holdEditFinishing = false
    this.holdEditTranscript = holdToTalk.createTranscript()
    const transcript = this.holdEditTranscript
    const session = asrDictation.createSession({
      onText: (text, isFinal) => {
        if (this._activeHoldEditSessionId !== sessionId) return
        transcript.accept(text, isFinal)
        if (!this._holdEditCanceled && !this._holdEditFinishing) {
          this.setData({
            holdEditBubbleVisible: true,
            holdEditTranscriptText: transcript.bubbleText()
          })
        }
      },
      onState: (state) => {
        if (this._activeHoldEditSessionId !== sessionId || this._holdEditFinishing) return
        if (state === '正在听写…' && !transcript.bestText()) {
          this.setData({ holdEditTranscriptText: '在听…' })
        }
      },
      onError: (message) => {
        if (this._activeHoldEditSessionId !== sessionId || this._holdEditFinishing) return
        this.resetHoldArticleEdit()
        wx.showToast({ title: message || '听写失败', icon: 'none' })
      }
    })
    this.holdEditAsrSession = session
    session.connect()

    const recorder = wx.getRecorderManager()
    this.holdEditRecorder = recorder
    app.globalData.activeRecorderSession = { type: 'detail-asr', id: sessionId }
    this.unbindHoldEditRecorderEvents()
    this._holdEditRecorderManager = recorder
    this._holdEditFrameHandler = (res) => {
      if (this._activeHoldEditSessionId !== sessionId || this._holdEditCanceled) return
      session.sendAudio(res.frameBuffer, false)
    }
    this._holdEditErrorHandler = () => {
      if (this._activeHoldEditSessionId !== sessionId || this._holdEditFinishing) return
      this.resetHoldArticleEdit()
      wx.showToast({ title: '录音失败', icon: 'none' })
    }
    recorder.onFrameRecorded(this._holdEditFrameHandler)
    recorder.onError(this._holdEditErrorHandler)
    recorder.start({
      duration: 60 * 60 * 1000,
      sampleRate: 16000,
      numberOfChannels: 1,
      format: 'PCM',
      frameSize: 3
    })
  },

  moveHoldArticleEdit(event) {
    if (!this._holdEditTouchActive || !this.holdEditAsrSession || this._holdEditFinishing) return
    const touch = event && event.touches && event.touches[0]
    if (!touch) return
    const canceled = holdToTalk.shouldCancel(this._holdEditStartY, touch.clientY, 64)
    if (canceled === this._holdEditCanceled) return
    this._holdEditCanceled = canceled
    this.setData({
      holdEditState: canceled ? 'canceling' : 'talking',
      holdEditButtonText: canceled ? '上滑取消 · 松开放弃' : '松开 发送 · 上滑取消'
    })
  },

  finishHoldArticleEdit() {
    this._holdEditTouchActive = false
    this.setData({ holdEditLocatorsVisible: false })
    if (this._pendingHoldEditStart && !this.holdEditAsrSession) {
      this.resetHoldArticleEdit()
      return Promise.resolve()
    }
    return this.finishHoldArticleEditSession(Boolean(this._holdEditCanceled))
  },

  cancelHoldArticleEdit() {
    this._holdEditTouchActive = false
    this.setData({ holdEditLocatorsVisible: false })
    return this.finishHoldArticleEditSession(true)
  },

  async finishHoldArticleEditSession(cancel) {
    if (!this.holdEditAsrSession || this._holdEditFinishing) {
      if (!this.holdEditAsrSession) this.resetHoldArticleEdit()
      return
    }
    this._holdEditFinishing = true
    const sessionId = this._activeHoldEditSessionId
    const session = this.holdEditAsrSession
    const transcript = this.holdEditTranscript
    const recorder = this.holdEditRecorder
    this.holdEditRecorder = null

    if (cancel) {
      if (recorder) recorder.stop()
      this.unbindHoldEditRecorderEvents()
      session.close()
      this.resetHoldArticleEdit()
      wx.showToast({ title: '已取消语音修改', icon: 'none' })
      return
    }

    this.setData({
      holdEditState: 'finishing',
      holdEditButtonText: '正在整理…'
    })
    await holdToTalk.stopRecorderAndWait(recorder, 500)
    this.unbindHoldEditRecorderEvents()
    const finalText = transcript.waitForFinalText(1500)
    session.finish()
    const text = await finalText
    if (this._activeHoldEditSessionId !== sessionId) return
    session.close()
    await audioSessionReset.resetAfterRecording()
    if (this._activeHoldEditSessionId !== sessionId) return
    const articleIndex = this.data.articleIndex || 0
    this.resetHoldArticleEdit()
    if (!text) {
      wx.showToast({ title: '没有识别到语音', icon: 'none' })
      return
    }
    this.enqueueInstruction(text, articleIndex)
    wx.showToast({ title: `已发送修改：${text}`, icon: 'none' })
  },

  unbindHoldEditRecorderEvents() {
    const recorder = this._holdEditRecorderManager
    if (recorder) {
      if (recorder.offFrameRecorded && this._holdEditFrameHandler) {
        recorder.offFrameRecorded(this._holdEditFrameHandler)
      }
      if (recorder.offError && this._holdEditErrorHandler) {
        recorder.offError(this._holdEditErrorHandler)
      }
    }
    this._holdEditRecorderManager = null
    this._holdEditFrameHandler = null
    this._holdEditErrorHandler = null
  },

  resetHoldArticleEdit() {
    this._holdEditTouchActive = false
    this._pendingHoldEditStart = false
    this._holdEditCanceled = false
    this._holdEditFinishing = false
    this._activeHoldEditSessionId = null
    if (this.holdEditRecorder) this.holdEditRecorder.stop()
    this.holdEditRecorder = null
    if (this.unbindHoldEditRecorderEvents) this.unbindHoldEditRecorderEvents()
    if (this.holdEditAsrSession) this.holdEditAsrSession.close()
    this.holdEditAsrSession = null
    this.holdEditTranscript = null
    if (app.globalData.activeRecorderSession && app.globalData.activeRecorderSession.type === 'detail-asr') {
      app.globalData.activeRecorderSession = null
    }
    this.setData({
      holdEditState: 'idle',
      holdEditButtonText: this.data.editQueue && this.data.editQueue.length ? '正在改…按住继续说' : '按住说话，修改文章',
      holdEditBubbleVisible: false,
      holdEditTranscriptText: '',
      holdEditLocatorsVisible: false
    })
  },

  stopHoldArticleEdit() {
    this.resetHoldArticleEdit()
  },

  showMoreActions() {
    this.setData({ moreMenuOpen: true })
    if (this.prepareWechatShareCard) this.prepareWechatShareCard()
  },

  closeMoreMenu() {
    this.setData({ moreMenuOpen: false })
  },

  noop() {
  },

  async runMoreMenuAction(event) {
    const action = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.action
    this.setData({ moreMenuOpen: false })
    if (action === 'publishWechat') {
      await this.publishWechat()
    } else if (action === 'community') {
      await this.shareCommunity()
    } else if (action === 'expandBook') {
      this.expandToBook()
    } else if (action === 'xhs') {
      await this.shareToXhs()
    } else if (action === 'share') {
      await this.copyArticleWithLink()
    } else if (action === 'delete') {
      await this.confirmDelete()
    }
  },

  expandToBook() {
    const article = this.data.current
    if (!article) {
      wx.showToast({ title: '文章还没生成', icon: 'none' })
      return
    }
    app.globalData.bookSeedArticle = {
      title: String(article.title || '无题'),
      body: articleUtil.stripMarkers(article.body)
    }
    wx.navigateTo({ url: '/pages/book-writing/index' })
  },

  startImageLongpress(event) {
    this.finishImageLongpress()
    const index = Number(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index)
    const touch = event && event.touches && event.touches[0]
    if (!Number.isInteger(index) || !touch) return
    const point = {
      x: coordinate(touch.clientX, touch.pageX, touch.x),
      y: coordinate(touch.clientY, touch.pageY, touch.y)
    }
    this.imageLongpressStart = point
    this.imageLongpressRect = null
    if (wx.createSelectorQuery) {
      try {
        wx.createSelectorQuery()
          .in(this)
          .select(`#article-photo-${index}`)
          .boundingClientRect()
          .exec((results) => {
            if (this.imageLongpressStart === point) this.imageLongpressRect = results && results[0] || null
          })
      } catch (_) {}
    }
    this.imageLongpressTimer = setTimeout(() => {
      this.imageLongpressTimer = null
      this.imageLongpressStart = null
      const rect = this.imageLongpressRect
      this.imageLongpressRect = null
      this.longpressBlock({ currentTarget: { dataset: { index } }, detail: Object.assign({ rect }, point) })
    }, 350)
  },

  moveImageLongpress(event) {
    const start = this.imageLongpressStart
    const touch = event && event.touches && event.touches[0]
    if (!start || !touch) return
    const dx = Number(touch.clientX) - start.x
    const dy = Number(touch.clientY) - start.y
    if (Math.sqrt(dx * dx + dy * dy) > 10) this.finishImageLongpress()
  },

  finishImageLongpress() {
    if (this.imageLongpressTimer != null) clearTimeout(this.imageLongpressTimer)
    this.imageLongpressTimer = null
    this.imageLongpressStart = null
    this.imageLongpressRect = null
  },

  longpressBlock(event) {
    if (this.data.inlineEditing) return
    this.longpressQuerySeq = (this.longpressQuerySeq || 0) + 1
    const querySeq = this.longpressQuerySeq
    const index = Number(event.currentTarget.dataset.index)
    const block = this.data.blocks[index]
    if (!block) return
    if (block.type === 'photo' && (!block.key || !block.url || block.failed)) return
    if (block.type !== 'photo' && !String(block.text || '').trim()) return
    const kind = block.type === 'photo' ? 'image' : 'text'
    const menu = this.data.menus && this.data.menus[kind]
    const localRows = kind === 'text'
      ? [{ id: 'copy', label: '拷贝' }, { id: 'edit', label: '编辑' }]
      : []
    if (!uiConfig.renderableGroups(menu).length && !localRows.length) return
    const detail = event.detail || {}
    const sys = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}
    const isCurrentTarget = () => {
      const currentBlock = (this.data.blocks || [])[index]
      if (querySeq !== this.longpressQuerySeq || !currentBlock || currentBlock.key !== block.key) return false
      return kind !== 'image' || (currentBlock.url && !currentBlock.failed)
    }
    const openMenu = (rect) => {
      if (!isCurrentTarget()) return
      this.setData({
        longpressMenuOpen: true,
        longpressMenu: menu,
        longpressTarget: { kind, block: Object.assign({}, block, { blockIndex: index }) },
        longpressAnchor: longpressAnchor(block, kind, rect, detail, sys, menu, localRows),
        longpressLocalRows: localRows
      })
    }
    openMenu(detail.rect || null)
  },

  closeLongpressMenu() {
    this.longpressQuerySeq = (this.longpressQuerySeq || 0) + 1
    this.setData({ longpressMenuOpen: false, longpressMenu: null, longpressTarget: null, longpressAnchor: null, longpressLocalRows: [] })
  },

  onLongpressPick(event) {
    const node = event && event.detail && event.detail.node
    const target = this.data.longpressTarget
    if (!node || !node.instruction || !target || !target.block) return
    const instruction = target.kind === 'image'
      ? uiConfig.fill(node.instruction, 'KEY', target.block.key)
      : uiConfig.fill(node.instruction, 'LINE', target.block.lineNo, 'QUOTE', uiConfig.quotePrefix(target.block.text))
    const articleIndex = this.data.articleIndex || 0
    const anchor = target.kind === 'image'
      ? { type: 'image', key: target.block.key }
      : { type: 'line', line: target.block.lineNo, text: target.block.text }
    this.closeLongpressMenu()
    this.enqueueInstruction(instruction, articleIndex, null, anchor, node.id)
  },

  onLongpressLocalPick(event) {
    const target = this.data.longpressTarget
    const id = event && event.detail && event.detail.id
    if (id === 'copy' && target && target.kind === 'text') {
      wx.setClipboardData({ data: target.block.text })
    }
    const editBlock = id === 'edit' && target && target.kind === 'text' ? target.block : null
    this.closeLongpressMenu()
    if (editBlock) this.beginInlineParagraphEdit(editBlock)
  },

  beginInlineParagraphEdit(block) {
    if (!block || block.type && block.type !== 'paragraph') return
    const measuredHeight = Number(block.editorHeightPx)
    if (!(measuredHeight > 0) && Number.isInteger(block.blockIndex) && wx.createSelectorQuery) {
      try {
        wx.createSelectorQuery()
          .in(this)
          .select(`#article-paragraph-${block.blockIndex}`)
          .boundingClientRect((rect) => {
            this.beginInlineParagraphEdit(Object.assign({}, block, {
              editorHeightPx: rect && Number(rect.height) || this.inlineParagraphFallbackHeight(block.text)
            }))
          })
          .exec()
        return
      } catch (_) {
      }
    }
    this.pendingInlineEditDoc = null
    this.setData({
      inlineEditing: true,
      inlineEditSaving: false,
      inlineEditText: String(block.text || ''),
      inlineEditOriginal: String(block.text || ''),
      inlineEditLineNo: Number(block.lineNo) || 0,
      inlineEditHeightPx: measuredHeight > 0 ? measuredHeight : this.inlineParagraphFallbackHeight(block.text),
      inlineEditArticleIndex: this.data.articleIndex || 0
    })
  },

  inlineParagraphFallbackHeight(text) {
    const lineCount = Math.max(1, String(text || '').split('\n').length)
    return Math.ceil(lineCount * 34.2)
  },

  onInlineEditInput(event) {
    this.setData({ inlineEditText: event && event.detail ? event.detail.value : '' })
  },

  cancelInlineEdit() {
    if (this.data.inlineEditSaving) return
    const pending = this.pendingInlineEditDoc
    this.pendingInlineEditDoc = null
    this.setData({
      inlineEditing: false,
      inlineEditText: '',
      inlineEditOriginal: '',
      inlineEditLineNo: 0,
      inlineEditHeightPx: 0
    })
    if (pending) this.applyDoc(pending)
  },

  async saveInlineEdit() {
    if (!this.data.inlineEditing || this.data.inlineEditSaving) return
    const replacement = String(this.data.inlineEditText || '').trim()
    if (!replacement) {
      wx.showToast({ title: '内容不能为空', icon: 'none' })
      return
    }
    if (replacement === String(this.data.inlineEditOriginal || '').trim()) {
      this.cancelInlineEdit()
      return
    }
    const index = this.data.inlineEditArticleIndex || 0
    const articles = this.data.doc && this.data.doc.articles ? this.data.doc.articles.slice() : []
    const current = articles[index]
    const body = articleUtil.replaceRenderedBodyLine(current, this.data.inlineEditLineNo, replacement)
    if (!current || body == null) {
      wx.showToast({ title: '这段内容已变化，请重试', icon: 'none' })
      return
    }
    articles[index] = Object.assign({}, current, { body })
    this.setData({ inlineEditSaving: true })
    try {
      const saved = await library.saveArticles(this.data.rec.stem, articles)
      this.pendingInlineEditDoc = null
      this.setData({
        inlineEditing: false,
        inlineEditSaving: false,
        inlineEditText: '',
        inlineEditOriginal: '',
        inlineEditLineNo: 0,
        inlineEditHeightPx: 0
      })
      this.applyDoc(saved)
      await this.refreshVersionNav()
    } catch (error) {
      this.setData({ inlineEditSaving: false })
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    }
  },

  enqueueInstruction(instruction, articleIndex, images, anchor, itemId) {
    const session = this.ensureEditSession()
    if (!session || !instruction) {
      logPhotoInsert('enqueue-skip', { hasSession: !!session, hasInstruction: !!instruction })
      return
    }
    session.enqueue(instruction, articleIndex != null ? articleIndex : 0, images, anchor, itemId)
    if (anchor && anchor.type === 'image' && anchor.key && this.startPhotoMaking) {
      this.startPhotoMaking(anchor.key, { poll: false })
    } else if (this.startPhotoMakingForInstruction) {
      this.startPhotoMakingForInstruction(instruction)
    }
    if (isPhotoInsertInstruction(instruction, images)) {
      const data = photoInsertPromptData(instruction)
      logPhotoInsert('prompt-from-enqueue', {
        recStem: this.data.rec && this.data.rec.stem,
        articleIndex: articleIndex != null ? articleIndex : 0,
        imageCount: images && images.length || 0,
        instructionLength: String(instruction || '').length
      })
      this.setData(data, () => {
        logPhotoInsert('prompt-setdata-from-enqueue', {
          photoInsertTip: this.data.photoInsertTip || '',
          instructionLength: String(this.data.photoInsertInstruction || '').length,
          promptVisible: !!this.data.photoInsertPromptVisible
        })
        inspectPhotoInsertPromptLayout(this, 'enqueue')
      })
      savePhotoInsertPrompt(this.data.rec && this.data.rec.stem, data)
    }
    wx.showToast({ title: '已提交修改' })
  },

  insertPhoto() {
    logPhotoInsert('insert-photo-open', {
      recStem: this.data.rec && this.data.rec.stem,
      existingTip: this.data.photoInsertTip || '',
      existingInstructionLength: String(this.data.photoInsertInstruction || '').length
    })
    clearPhotoInsertPrompt(this.data.rec && this.data.rec.stem)
    clearDetailPhotoPickerDraft(this)
    this.setData({
      photoSheetOpen: true,
      photoPickerPhotos: [],
      photoPickerCount: 0,
      photoUploading: false,
      photoUploadFailed: false,
      photoSheetStatus: '',
      ...hiddenPhotoInsertPromptData()
    })
  },

  restorePhotoPickerDraft() {
    const draft = app.globalData.detailPhotoPickerDraft
    const stem = detailPhotoPickerDraftStem(this)
    if (!draft || !stem || draft.stem !== stem || !draft.photos || !draft.photos.length) return false
    const draftPaths = photoPickerPaths(draft.photos)
    const currentPaths = photoPickerPaths(this.data && this.data.photoPickerPhotos)
    const alreadyOpen = !!(this.data && this.data.photoSheetOpen)
    if (alreadyOpen && draftPaths.join('\n') === currentPaths.join('\n')) return false
    const update = {
      photoPickerPhotos: draft.photos.slice(),
      photoPickerCount: draft.photos.length,
      photoUploading: false,
      photoUploadFailed: false,
      photoSheetStatus: ''
    }
    if (!alreadyOpen) update.photoSheetOpen = true
    this.setData(update)
    return true
  },

  photoPickerUpdateForPhotos(photos) {
    const update = {
      photoPickerPhotos: photos,
      photoPickerCount: photos.length
    }
    if (!this.data || !this.data.photoSheetOpen) update.photoSheetOpen = true
    return update
  },

  closePhotoSheet() {
    if (this.data.photoUploading) return
    clearDetailPhotoPickerDraft(this)
    this.setData({
      photoSheetOpen: false,
      photoPickerPhotos: [],
      photoPickerCount: 0,
      photoUploadFailed: false,
      photoSheetStatus: ''
    })
  },

  chooseDetailPhoto(event) {
    const source = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.source || 'album'
    const sourceType = source === 'camera' ? ['camera'] : ['album']
    const current = this.data.photoPickerPhotos || []
    const remaining = Math.max(0, 9 - current.length)
    if (!remaining) {
      wx.showToast({ title: '最多选择 9 张图片', icon: 'none' })
      return Promise.resolve(false)
    }
    const appendPhotos = (files) => {
      const selected = (files || [])
        .map((file) => Object.assign({}, file, { path: file.tempFilePath || file.path || '' }))
        .filter((file) => file.path)
      const known = new Set(current.map((file) => file.path || file.tempFilePath))
      const additions = selected.filter((file) => !known.has(file.path))
      const photos = current.concat(additions).slice(0, 9)
      saveDetailPhotoPickerDraft(this, photos)
      this.setData(this.photoPickerUpdateForPhotos
        ? this.photoPickerUpdateForPhotos(photos)
        : { photoPickerPhotos: photos, photoPickerCount: photos.length })
      applyPhotoPickerPhotosToPage(visibleDetailPageForStem(detailPhotoPickerDraftStem(this), this), photos)
    }
    const count = source === 'camera' ? 1 : remaining
    if (!wx.chooseImage && !wx.chooseMedia) {
      wx.showToast({ title: '当前微信不支持选图', icon: 'none' })
      return Promise.resolve(false)
    }
    if (wx.chooseImage) {
      return new Promise((resolve) => {
        wx.chooseImage({
          count,
          sourceType,
          sizeType: ['compressed'],
          success: (res) => {
            const tempFiles = res.tempFiles && res.tempFiles.length
              ? res.tempFiles
              : (res.tempFilePaths || []).map((path) => ({ path }))
            appendPhotos(tempFiles)
            resolve(true)
          },
          fail: () => resolve(false)
        })
      })
    }
    return new Promise((resolve) => {
      wx.chooseMedia({
        count,
        mediaType: ['image'],
        sourceType,
        sizeType: ['compressed'],
        success: (res) => {
          appendPhotos(res.tempFiles || [])
          resolve(true)
        },
        fail: () => resolve(false)
      })
    })
  },

  removeDetailPhoto(event) {
    if (this.data.photoUploading) return
    const index = Number(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) return
    const photos = (this.data.photoPickerPhotos || []).slice()
    if (index >= photos.length) return
    photos.splice(index, 1)
    if (photos.length) saveDetailPhotoPickerDraft(this, photos)
    else clearDetailPhotoPickerDraft(this)
    this.setData({ photoPickerPhotos: photos, photoPickerCount: photos.length })
  },

  async uploadDetailPhotos() {
    const photos = this.data.photoPickerPhotos || []
    logPhotoInsert('upload-detail-photos-start', {
      recStem: this.data.rec && this.data.rec.stem,
      photoCount: photos.length,
      alreadyUploading: this.data.photoUploading,
      pageTipBefore: this.data.photoInsertTip || '',
      instructionLengthBefore: String(this.data.photoInsertInstruction || '').length
    })
    if (!photos.length || this.data.photoUploading) return false
    const parsed = recording.parseStem(this.data.rec && this.data.rec.stem)
    if (!parsed || !parsed.sessionTs) {
      wx.showToast({ title: '无法识别录音时间', icon: 'error' })
      return false
    }
    this.setData({
      photoUploading: true,
      photoUploadFailed: false,
      photoSheetStatus: '正在上传图片...',
      photoInsertTip: '正在上传图片...',
      photoInsertInstruction: '',
      photoInsertPromptVisible: true
    })
    inspectPhotoInsertPromptLayout(this, 'uploading')
    try {
      const keys = []
      const images = []
      for (let index = 0; index < photos.length; index += 1) {
        const photo = photos[index]
        const key = recording.photoKey(parsed.sessionTs, photoInsert.photoOffsetForFile(parsed.sessionTs, photo, index))
        const path = photo.path || photo.tempFilePath
        await this.uploadDetailPhoto(path, key)
        keys.push(key)
        const thumb = await this.makeThumbSafe(path)
        if (thumb) images.push({ key, base64: thumb })
      }
      const instruction = photoInsert.instructionForKeys(keys)
      const session = this.ensureEditSession()
      if (!session) throw new Error('文章编辑器未连接')
      session.enqueue(instruction, this.data.articleIndex || 0, images)
      logPhotoInsert('upload-detail-photos-enqueued', {
        recStem: this.data.rec && this.data.rec.stem,
        keyCount: keys.length,
        imageCount: images.length,
        instructionLength: instruction.length,
        markerCount: (instruction.match(/\[\[photo:/g) || []).length
      })
      const promptData = photoInsertPromptData(instruction)
      savePhotoInsertPrompt(this.data.rec && this.data.rec.stem, promptData)
      clearDetailPhotoPickerDraft(this)
      this.setData({
        photoSheetOpen: false,
        photoPickerPhotos: [],
        photoPickerCount: 0,
        photoUploading: false,
        photoUploadFailed: false,
        photoSheetStatus: '',
        ...promptData
      }, () => {
        logPhotoInsert('prompt-setdata-from-upload', {
          recStem: this.data.rec && this.data.rec.stem,
          photoSheetOpen: this.data.photoSheetOpen,
          photoInsertTip: this.data.photoInsertTip || '',
          instructionLength: String(this.data.photoInsertInstruction || '').length,
          promptVisible: !!this.data.photoInsertPromptVisible,
          loading: this.data.loading,
          hasCurrent: !!this.data.current
        })
        inspectPhotoInsertPromptLayout(this, 'upload')
      })
      return true
    } catch (error) {
      logPhotoInsert('upload-fail', { error })
      this.setData({
        photoUploading: false,
        photoUploadFailed: true,
        photoSheetStatus: '上传失败，请重试',
        photoInsertTip: '上传失败，请重试',
        photoInsertInstruction: '',
        photoInsertPromptVisible: true
      }, () => {
        inspectPhotoInsertPromptLayout(this, 'upload-fail')
      })
      wx.showToast({ title: '照片上传失败', icon: 'error' })
      return false
    }
  },

  async uploadDetailPhoto(path, key) {
    let uploadPath = await this.makeUploadImage(path, 1080)
    try {
      return await library.uploadPhoto(uploadPath, key)
    } catch (error) {
      if (this.shouldRetryOriginalPhotoUpload(uploadPath, path, error)) {
        return library.uploadPhoto(path, key)
      }
      throw error
    }
  },

  shouldRetryOriginalPhotoUpload(uploadPath, originalPath, error) {
    if (!uploadPath || uploadPath === originalPath) return false
    const message = String(error && (error.errMsg || error.message) || '')
    return /^http:\/\/tmp\//.test(uploadPath) && /not found|no such file|saveFile/i.test(message)
  },

  shouldRetrySmallerUpload(error) {
    const message = String(error && (error.errMsg || error.message) || '')
    const status = error && error.details && error.details.statusCode
    return status === 413 || /HTTP 413|too large|request entity/i.test(message)
  },

  async makeThumbSafe(path) {
    try {
      return await this.makeThumb(path)
    } catch (error) {
      logPhotoInsert('thumb-fail', { error })
      return null
    }
  },

  async makeThumb(path) {
    const thumbPath = await this.makeUploadImage(path, 320)
    return this.readFileBase64(thumbPath)
  },

  readFileBase64(path) {
    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager && wx.getFileSystemManager()
      if (!fs || !fs.readFile) {
        reject(new Error('readFile unavailable'))
        return
      }
      fs.readFile({
        filePath: path,
        encoding: 'base64',
        success: (res) => resolve(res.data || ''),
        fail: reject
      })
    })
  },

  async makeUploadImage(path, maxSide) {
    try {
      const rendered = await this.renderSquareJpeg(path, maxSide)
      if (/^http:\/\/tmp\//.test(rendered || '')) return await this.saveReadableTempPath(rendered)
      return rendered
    } catch (error) {
      logPhotoInsert('render-upload-image-fallback', { path, maxSide, error })
      if (this.compressImage) return this.compressImage(path)
      return new Promise((resolve, reject) => {
        if (!wx.compressImage) {
          resolve(path)
          return
        }
        wx.compressImage({
          src: path,
          quality: 86,
          success: (res) => resolve(res.tempFilePath || path),
          fail: reject
        })
      })
    }
  },

  saveReadableTempPath(path) {
    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager && wx.getFileSystemManager()
      const saveFile = fs && fs.saveFile ? fs.saveFile.bind(fs) : wx.saveFile
      if (!saveFile) {
        reject(new Error('saveFile unavailable'))
        return
      }
      saveFile({
        tempFilePath: path,
        success: (res) => resolve(res.savedFilePath || res.tempFilePath || path),
        fail: reject
      })
    })
  },

  compressImage(path) {
    return new Promise((resolve, reject) => {
      if (!wx.compressImage) {
        resolve(path)
        return
      }
      wx.compressImage({
        src: path,
        quality: 86,
        success: (res) => resolve(res.tempFilePath || path),
        fail: reject
      })
    })
  },

  renderSquareJpeg(path, maxSide) {
    return new Promise((resolve, reject) => {
      if (!wx.getImageInfo || !wx.createSelectorQuery || !wx.canvasToTempFilePath) {
        reject(new Error('canvas unavailable'))
        return
      }
      wx.getImageInfo({
        src: path,
        success: (info) => {
          const side = Math.min(info.width || 0, info.height || 0)
          if (!side) {
            reject(new Error('invalid image bounds'))
            return
          }
          const outSide = Math.min(Math.max(1, maxSide || 1080), side)
          const left = Math.max(0, Math.floor(((info.width || side) - side) / 2))
          const top = Math.max(0, Math.floor(((info.height || side) - side) / 2))
          const query = wx.createSelectorQuery().in(this)
          query.select('#detailPhotoCanvas').fields({ node: true, size: true }).exec((res) => {
            const canvas = res && res[0] && res[0].node
            if (canvas && canvas.getContext) {
              const dpr = wx.getSystemInfoSync ? (wx.getSystemInfoSync().pixelRatio || 1) : 1
              canvas.width = outSide * dpr
              canvas.height = outSide * dpr
              const ctx = canvas.getContext('2d')
              const img = canvas.createImage()
              img.onload = () => {
                ctx.drawImage(img, left, top, side, side, 0, 0, outSide * dpr, outSide * dpr)
                wx.canvasToTempFilePath({
                  canvas,
                  fileType: 'jpg',
                  quality: 0.86,
                  success: (file) => resolve(file.tempFilePath),
                  fail: reject
                }, this)
              }
              img.onerror = reject
              img.src = info.path || path
              return
            }
            const ctx = wx.createCanvasContext && wx.createCanvasContext('detailPhotoCanvas', this)
            if (!ctx) {
              reject(new Error('canvas context unavailable'))
              return
            }
            ctx.drawImage(info.path || path, left, top, side, side, 0, 0, outSide, outSide)
            ctx.draw(false, () => {
              wx.canvasToTempFilePath({
                canvasId: 'detailPhotoCanvas',
                x: 0,
                y: 0,
                width: outSide,
                height: outSide,
                destWidth: outSide,
                destHeight: outSide,
                fileType: 'jpg',
                quality: 0.86,
                success: (file) => resolve(file.tempFilePath),
                fail: reject
              }, this)
            })
          })
        },
        fail: reject
      })
    })
  },

  shareCommunity() {
    if (this.data.sharedToCommunity && this.data.communityShareId) {
      return this.hideCommunity()
    }
    if (!auth.isWechatAuthenticated()) {
      this.promptWechatLogin()
      return
    }
    return this.continueCommunityShare()
  },

  continueCommunityShare() {
    if (!communityTerms.agreed()) {
      wx.showModal({
        title: '社区公约',
        content: communityTerms.BODY,
        confirmText: '同意发布',
        success: (res) => {
          if (!res.confirm) return
          communityTerms.setAgreed(true)
          this.doShareCommunity()
        },
        fail: () => wx.showToast({ title: '社区公约打开失败', icon: 'none' })
      })
      return
    }
    return this.doShareCommunity()
  },

  promptWechatLogin() {
    wx.showModal({
      title: '需要微信登录',
      content: '发布到 VD 社区需要先用微信登录，登录后才能发布。是否现在登录？',
      confirmText: '微信登录',
      cancelText: '取消',
      showCancel: true,
      success: (result) => {
        if (result.confirm) this.loginForCommunity()
      },
      fail: () => wx.showToast({ title: '登录提示打开失败', icon: 'none' })
    })
  },

  loginForCommunity() {
    if (this.data.wechatLoggingIn) return
    this.setData({ wechatLoggingIn: true })
    const startLogin = (userInfo) => {
      wx.login({
        success: async (login) => {
          try {
            const result = await wechatAuth.exchangeCode(login.code, userInfo.nickName, userInfo.avatarUrl)
            if (!result.ok) {
              wx.showModal({
                title: '微信登录失败',
                content: result.detail || result.error || '请稍后重试',
                showCancel: false
              })
              return
            }
            const currentScope = await library.ownerScope({ anonymous: true })
            if (!currentScope) throw new Error('无法确认当前账号空间')
            if (normalizeScope(currentScope) !== normalizeScope(result.scope)) {
              this.promptWechatAccountSwitch(result)
              return
            }
            if (!auth.storeSession(result.session)) throw new Error('无效微信会话')
            wx.showToast({ title: '已登录' })
            await this.continueCommunityShare()
          } catch (error) {
            wx.showModal({
              title: '微信登录失败',
              content: error && error.message || '请稍后重试',
              showCancel: false
            })
          } finally {
            this.setData({ wechatLoggingIn: false })
          }
        },
        fail: () => {
          this.setData({ wechatLoggingIn: false })
          wx.showToast({ title: '登录失败', icon: 'error' })
        }
      })
    }
    if (!wx.getUserProfile) {
      startLogin({})
      return
    }
    wx.getUserProfile({
      desc: '用于参与 VD 社区',
      success: (profile) => startLogin(profile.userInfo || {}),
      fail: () => startLogin({})
    })
  },

  promptWechatAccountSwitch(result) {
    wx.showModal({
      title: '该微信已关联另一个云端空间',
      content: '是否切换到微信已绑定的云端空间？当前空间会保存在本机，登录后将重新打开首页。',
      confirmText: '切换',
      cancelText: '保留当前',
      showCancel: true,
      success: (choice) => {
        if (!choice.confirm) return
        if (!auth.switchToWechatAccount(result.session)) {
          wx.showToast({ title: '切换失败，请稍后重试', icon: 'error' })
          return
        }
        wx.reLaunch({ url: '/pages/recordings/index' })
      },
      fail: () => wx.showToast({ title: '账号切换提示打开失败', icon: 'none' })
    })
  },

  async doShareCommunity() {
    if (this.data.sharingCommunity) return
    this.setData({ sharingCommunity: true })
    wx.showLoading({ title: '正在发布', mask: true })
    let result = null
    try {
      result = await community.shareResult(this.data.rec)
    } catch (error) {
    } finally {
      wx.hideLoading()
      this.setData({ sharingCommunity: false })
    }
    if (!result) {
      wx.showToast({ title: '网络异常，请稍后重试', icon: 'error' })
    } else if (result.ok) {
      this.setData({ sharedToCommunity: true, communityShareId: result.shareId })
      wx.showToast({ title: '已在 VD 社区可见' })
    } else if (result.needsWechatSignin) {
      this.promptWechatLogin()
    } else if (result.articleNotFound) {
      wx.showToast({ title: '该文章不属于当前微信账号', icon: 'error' })
    } else {
      wx.showToast({ title: '分享失败', icon: 'error' })
    }
  },

  async hideCommunity() {
    const ok = await community.unshare(this.data.communityShareId)
    if (ok) {
      this.setData({ sharedToCommunity: false, communityShareId: '' })
      wx.showToast({ title: '已从社区隐藏' })
    } else {
      wx.showToast({ title: '操作失败', icon: 'error' })
    }
  },

  async refreshCommunityShareState() {
    try {
      const shareId = await community.sharedShareId(this.data.rec)
      this.setData({
        sharedToCommunity: Boolean(shareId),
        communityShareId: shareId || ''
      })
    } catch (error) {
    }
  },

  confirmDelete() {
    wx.showModal({
      title: '删除录音和文章？',
      content: '会删除音频、文章、字幕和标签文件。',
      confirmText: '删除',
      confirmColor: '#c7432f',
      success: async (res) => {
        if (!res.confirm) return
        await library.deleteRecording(this.data.rec)
        wx.navigateBack()
      }
    })
  }
})

function normalizeScope(scope) {
  const value = String(scope || '').trim()
  if (!value) return ''
  return value.endsWith('/') ? value : `${value}/`
}
