const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

test('audio detail loading state shows a spinner above the text', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/detail/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/detail/index.wxss'), 'utf8')

  assert.match(wxml, /<view wx:if="\{\{loading\}\}" class="loading-state">\s*<view class="loading-spinner" aria-hidden="true"><\/view>\s*<text>正在加载\.\.\.<\/text>\s*<\/view>/)
  assert.match(css, /\.loading-state\s*\{[^}]*flex-direction:\s*column;[^}]*gap:\s*24rpx;/s)
  assert.match(css, /\.loading-spinner\s*\{[^}]*border-top-color:\s*#c7432f;[^}]*animation:\s*loading-spin\s+0\.8s\s+linear\s+infinite;/s)
})

function freshDetailPage(libraryOverrides, wxOverrides, articleEditOverrides, asrOverrides, settingsOverrides, communityOverrides, audioSessionResetOverrides) {
  let page
  const app = { globalData: {} }
  const library = Object.assign({
    fetchDoc: async () => ({ articles: [{ title: 'A', body: '正文' }] }),
    saveDoc: async (stem, doc) => doc,
    uploadPhoto: async () => true,
    photoUrl: (key, scope) => `${scope || ''}${key}`,
    scopedPhotoKey: (key, scope) => `${scope || ''}${key}`,
    downloadPhotoTemp: async (key, scope) => `wxfile://${scope || ''}${key}`
  }, libraryOverrides || {})
  const articleEdit = articleEditOverrides || {
    createSession: () => ({
      connect() {},
      close() {},
      enqueue() {}
    })
  }
  const settings = Object.assign({
    loadStyleHistory: async () => ({ versions: [], head: 0 })
  }, settingsOverrides || {})
  global.getApp = () => app
  global.Page = (definition) => {
    page = definition
  }
  global.wx = Object.assign({
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    getSystemInfoSync: () => ({ statusBarHeight: 0 }),
    getSetting: ({ success }) => success({ authSetting: { 'scope.record': true } }),
    authorize: ({ success }) => success(),
    showToast: () => {},
    showModal: () => {},
    showLoading: () => {},
    hideLoading: () => {},
    navigateBack: (options) => { app.navigatedBack = options || {} },
    redirectTo: (options) => { app.redirectedTo = options.url },
    navigateTo: (options) => { app.navigatedTo = options.url }
  }, wxOverrides || {})
  ;[
    '../pages/detail/index',
    '../services/library',
    '../services/article-edit',
    '../services/settings',
    '../services/community',
    '../services/asr-dictation',
    '../services/auth',
    '../services/request',
    '../utils/audio-session-reset'
  ].forEach((id) => {
    delete require.cache[require.resolve(id)]
  })
  require.cache[require.resolve('../services/library')] = { exports: library }
  require.cache[require.resolve('../services/article-edit')] = { exports: articleEdit }
  require.cache[require.resolve('../services/settings')] = { exports: settings }
  if (communityOverrides) require.cache[require.resolve('../services/community')] = { exports: communityOverrides }
  if (asrOverrides) require.cache[require.resolve('../services/asr-dictation')] = { exports: asrOverrides }
  if (audioSessionResetOverrides) require.cache[require.resolve('../utils/audio-session-reset')] = { exports: audioSessionResetOverrides }
  require('../pages/detail/index')
  page.__app = app
  return page
}

function holdEditContext(page, articleIndex) {
  const enqueued = []
  const ctx = {
    data: {
      articleIndex: articleIndex || 0,
      holdEditState: 'idle',
      holdEditButtonText: '按住 说话 修改',
      holdEditBubbleVisible: false,
      holdEditTranscriptText: ''
    },
    setData(update) {
      Object.assign(this.data, update)
    },
    enqueueInstruction(text, index) {
      enqueued.push({ text, articleIndex: index })
    },
    requestAudioConsent: async () => true
  }
  ;[
    'startHoldArticleEdit',
    'beginHoldArticleEdit',
    'moveHoldArticleEdit',
    'finishHoldArticleEdit',
    'cancelHoldArticleEdit',
    'finishHoldArticleEditSession',
    'unbindHoldEditRecorderEvents',
    'resetHoldArticleEdit',
    'stopHoldArticleEdit'
  ].forEach((name) => { ctx[name] = page[name] })
  ctx.enqueued = enqueued
  return ctx
}

test('detail page switches multi-article content like Android chips', () => {
  const page = freshDetailPage()
  const ctx = {
    data: {
      articleIndex: 0,
      photoScope: 'users/anon/'
    },
    setData(update) {
      Object.assign(this.data, update)
    },
    applyDoc: page.applyDoc
  }
  const doc = {
    articles: [
      { title: '第一篇', body: '第一段', style: 1 },
      { title: '第二篇', body: '# 第二篇\n\n第二段', style: 3 }
    ],
    photos: []
  }

  page.applyDoc.call(ctx, doc)

  assert.equal(ctx.data.current.title, '第一篇')
  assert.equal(ctx.data.styleLabel, 'v1 风格')
  assert.deepEqual(ctx.data.blocks, [{ type: 'paragraph', text: '第一段', lineNo: 1 }])
  assert.equal(ctx.data.articleTabs[0].active, true)

  page.selectArticle.call(ctx, { currentTarget: { dataset: { index: 1 } } })

  assert.equal(ctx.data.current.title, '第二篇')
  assert.equal(ctx.data.styleLabel, 'v3 风格')
  assert.deepEqual(ctx.data.blocks, [{ type: 'paragraph', text: '第二段', lineNo: 1 }])
  assert.equal(ctx.data.articleTabs[1].active, true)
})

test('detail page renders the custom configurable longpress menu', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/detail/index.wxml'), 'utf8')
  const json = JSON.parse(fs.readFileSync(path.join(root, 'pages/detail/index.json'), 'utf8'))
  assert.equal(json.usingComponents['config-menu'], '../../components/config-menu/index')
  assert.match(wxml, /<config-menu[\s\S]*bindpick="onLongpressPick"/)
})

test('detail page exposes inline paragraph editing from the text longpress menu', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/detail/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/detail/index.wxss'), 'utf8')
  assert.match(wxml, /wx:if="\{\{inlineEditing\}\}"[\s\S]*bindtap="cancelInlineEdit"[\s\S]*bindtap="saveInlineEdit"/)
  assert.doesNotMatch(wxml, />编辑正文</)
  assert.match(css, /\.inline-edit-toolbar\s*\{[^}]*position:\s*relative;[^}]*box-sizing:\s*border-box;/s)
  assert.match(css, /\.inline-edit-action\s*\{[^}]*margin:\s*0;[^}]*padding:\s*0;/s)
  assert.match(css, /\.inline-edit-action\.cancel\s*\{[^}]*position:\s*absolute;[^}]*left:\s*0;[^}]*width:\s*80rpx;[^}]*text-align:\s*left;/s)
  assert.match(css, /\.inline-edit-action\.done\s*\{[^}]*position:\s*absolute;[^}]*width:\s*128rpx;[^}]*text-align:\s*right;[^}]*white-space:\s*nowrap;/s)
  assert.match(wxml, /class="inline-edit-action done"[^>]*right:\s*\{\{capsuleSafeRightPx\}\}px;/)
  assert.match(wxml, /<textarea[^>]*class="inline-paragraph-editor"[^>]*bindinput="onInlineEditInput"/)
  assert.match(wxml, /id="article-paragraph-\{\{index\}\}"/)
  assert.match(wxml, /<textarea[^>]*class="inline-paragraph-editor"[^>]*height:\s*\{\{inlineEditHeightPx\}\}px;/)
  assert.doesNotMatch(wxml, /class="inline-paragraph-editor"[^>]*auto-height/)
  assert.match(wxml, /<view class="edit-dock" wx:if="\{\{!inlineEditing\}\}">/)
  assert.match(css, /\.inline-paragraph-editor\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*0;[^}]*padding:\s*0 8rpx;[^}]*font-size:\s*36rpx;[^}]*line-height:\s*1\.9;/s)

  const page = freshDetailPage()
  const ctx = Object.assign({}, page, {
    data: {
      blocks: [{ type: 'paragraph', text: '正文', lineNo: 1 }],
      menus: { text: { groups: [] } },
      inlineEditing: false
    },
    setData(update) { Object.assign(this.data, update) }
  })
  page.longpressBlock.call(ctx, { currentTarget: { dataset: { index: 0 } }, detail: { x: 24, y: 160 } })
  assert.deepEqual(ctx.data.longpressLocalRows, [
    { id: 'copy', label: '拷贝' },
    { id: 'edit', label: '编辑' }
  ])
})

test('detail inline editor starts with the measured paragraph height', () => {
  const page = freshDetailPage()
  const ctx = {
    data: { articleIndex: 0 },
    setData(update) { Object.assign(this.data, update) }
  }

  page.beginInlineParagraphEdit.call(ctx, {
    type: 'paragraph',
    text: '原文显示为两行',
    lineNo: 2,
    editorHeightPx: 74
  })

  assert.equal(ctx.data.inlineEditHeightPx, 74)
})

test('detail page starts, cancels and saves an exact inline paragraph edit', async () => {
  const calls = []
  const page = freshDetailPage({
    saveArticles: async (stem, articles) => {
      calls.push({ stem, articles })
      return { articles }
    }
  })
  const article = { title: '标题', body: '# 标题\n\n第一段\n\n[[photo:photos/a.jpg]]\n\n第二段' }
  const ctx = Object.assign({}, page, {
    data: {
      rec: { stem: 'VoiceDrop-test' },
      doc: { articles: [article], photos: [] },
      current: article,
      articleIndex: 0,
      blocks: [
        { type: 'paragraph', text: '第一段', lineNo: 1 },
        { type: 'photo', key: 'photos/a.jpg', lineNo: 2 },
        { type: 'paragraph', text: '第二段', lineNo: 3 }
      ],
      longpressTarget: { kind: 'text', block: { type: 'paragraph', text: '第二段', lineNo: 3 } },
      inlineEditing: false,
      inlineEditSaving: false
    },
    setData(update) { Object.assign(this.data, update) },
    refreshVersionNav: async () => {},
    applyDoc(doc) { this.data.doc = doc }
  })

  page.onLongpressLocalPick.call(ctx, { detail: { id: 'edit' } })
  assert.equal(ctx.data.inlineEditing, true)
  assert.equal(ctx.data.inlineEditText, '第二段')
  page.onInlineEditInput.call(ctx, { detail: { value: '精修后的第二段' } })
  await page.saveInlineEdit.call(ctx)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].stem, 'VoiceDrop-test')
  assert.equal(calls[0].articles[0].body, '# 标题\n\n第一段\n\n[[photo:photos/a.jpg]]\n\n精修后的第二段')
  assert.equal(ctx.data.inlineEditing, false)
})

test('detail page recognizes image hold gestures on the regular view wrapper', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/detail/index.wxml'), 'utf8')
  assert.match(wxml, /class="photo-block"[^>]*bindtouchstart="startImageLongpress"[^>]*bindtouchmove="moveImageLongpress"[^>]*bindtouchend="finishImageLongpress"[^>]*bindtouchcancel="finishImageLongpress"/)
  assert.doesNotMatch(wxml, /<image[^>]*bindlongpress="longpressBlock"/)
})

test('detail image hold timer opens the menu without relying on native image longpress', () => {
  const page = freshDetailPage(null, { getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844 }) })
  const ctx = Object.assign({}, page, {
    data: {
      longpressMenuOpen: false,
      blocks: [{ type: 'photo', key: 'photos/a.jpg', url: 'wxfile://photo.jpg', loaded: false, failed: false, width: 320, height: 180 }],
      menus: { image: { groups: [[{ id: 'cartoon', label: '卡通', instruction: '重画 {{KEY}}' }]] } }
    },
    setData(update) { Object.assign(this.data, update) }
  })
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  global.setTimeout = (callback) => { callback(); return 1 }
  global.clearTimeout = () => {}
  try {
    page.startImageLongpress.call(ctx, {
      currentTarget: { dataset: { index: 0 } },
      touches: [{ clientX: 24, clientY: 120 }]
    })
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }

  assert.equal(ctx.data.longpressMenuOpen, true)
  assert.equal(ctx.data.longpressTarget.block.key, 'photos/a.jpg')
})

test('detail image longpress anchors the menu to the measured image rect', () => {
  const page = freshDetailPage(null, {
    getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844 })
  })
  const ctx = Object.assign({}, page, {
    data: {
      longpressMenuOpen: false,
      blocks: [{ type: 'photo', key: 'photos/s/1-a.jpg', url: 'wxfile://photo.jpg', loaded: true, failed: false }],
      menus: { image: { groups: [[{ id: 'style', label: '图片风格', type: 'submenu', children: [{ id: 'cartoon', label: '卡通', instruction: '重画 {{KEY}}' }] }]] } }
    },
    setData(update) { Object.assign(this.data, update) }
  })

  page.longpressBlock.call(ctx, { currentTarget: { dataset: { index: 0 } }, detail: { x: 200, y: 200, rect: { top: 120, left: 20, width: 320, height: 180 } } })

  assert.equal(ctx.data.longpressMenuOpen, true)
  assert.deepEqual(ctx.data.longpressAnchor, {
    top: 120,
    left: 20,
    width: 320,
    height: 180,
    menuTop: 132,
    menuMaxHeight: 696,
    menuLeft: 20,
    url: 'wxfile://photo.jpg',
    text: ''
  })
})

test('detail image load event records rendered dimensions', () => {
  const page = freshDetailPage()
  const ctx = Object.assign({}, page, {
    data: {
      longpressMenuOpen: false,
      blocks: [{ type: 'photo', key: 'photos/a.jpg', url: 'wxfile://photo.jpg', loaded: false, failed: false }],
      menus: { image: { groups: [[{ id: 'cartoon', label: '卡通', instruction: '重画 {{KEY}}' }]] } }
    },
    setData(update) { Object.assign(this.data, update) }
  })

  page.onArticleImageLoad.call(ctx, { currentTarget: { dataset: { index: 0 } }, detail: { width: 640, height: 360 } })
  assert.equal(ctx.data.blocks[0].loaded, true)
  assert.equal(ctx.data.blocks[0].width, 640)
  assert.equal(ctx.data.blocks[0].height, 360)
})

test('closing the image menu invalidates its current target', () => {
  const page = freshDetailPage(null, { getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844 }) })
  const ctx = Object.assign({}, page, {
    data: {
      longpressMenuOpen: false,
      blocks: [{ type: 'photo', key: 'photos/a.jpg', url: 'wxfile://photo.jpg', loaded: true, failed: false }],
      menus: { image: { groups: [[{ id: 'cartoon', label: '卡通', instruction: '重画 {{KEY}}' }]] } }
    },
    setData(update) { Object.assign(this.data, update) }
  })

  page.longpressBlock.call(ctx, { currentTarget: { dataset: { index: 0 } } })
  page.closeLongpressMenu.call(ctx)

  assert.equal(ctx.data.longpressMenuOpen, false)
  assert.equal(ctx.data.longpressTarget, null)
})

test('detail image longpress opens with a fallback anchor when selector query does not answer', () => {
  const page = freshDetailPage(null, {
    getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844 }),
    createSelectorQuery: () => ({
      in() { return this },
      select() { return this },
      boundingClientRect() { return this },
      exec() {}
    })
  })
  const ctx = Object.assign({}, page, {
    data: {
      longpressMenuOpen: false,
      blocks: [{ type: 'photo', key: 'photos/a.jpg', url: 'wxfile://photo.jpg', loaded: true, failed: false, width: 320, height: 180 }],
      menus: { image: { groups: [[{ id: 'cartoon', label: '卡通', instruction: '重画 {{KEY}}' }]] } }
    },
    setData(update) { Object.assign(this.data, update) }
  })

  page.longpressBlock.call(ctx, { currentTarget: { dataset: { index: 0 } }, detail: { x: 24, y: 120 } })

  assert.equal(ctx.data.longpressMenuOpen, true)
  assert.equal(ctx.data.longpressTarget.block.key, 'photos/a.jpg')
  assert.equal(ctx.data.longpressAnchor.url, 'wxfile://photo.jpg')
})

test('detail image menu does not reposition after it becomes visible', () => {
  const anchors = []
  const page = freshDetailPage(null, {
    getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844 }),
    createSelectorQuery: () => { throw new Error('menu display must not start a second measurement') }
  })
  const ctx = Object.assign({}, page, {
    data: {
      longpressMenuOpen: false,
      blocks: [{ type: 'photo', key: 'photos/a.jpg', url: 'wxfile://photo.jpg', loaded: true, failed: false, width: 320, height: 180 }],
      menus: { image: { groups: [[{ id: 'cartoon', label: '卡通', instruction: '重画 {{KEY}}' }]] } }
    },
    setData(update) {
      Object.assign(this.data, update)
      if (update.longpressAnchor) anchors.push(update.longpressAnchor)
    }
  })

  page.longpressBlock.call(ctx, { currentTarget: { dataset: { index: 0 } }, detail: { x: 24, y: 120 } })
  const visibleAnchor = ctx.data.longpressAnchor

  assert.equal(anchors.length, 1)
  assert.equal(ctx.data.longpressAnchor, visibleAnchor)
})

test('detail one-row image menu anchors at the image top-left', () => {
  const page = freshDetailPage(null, { getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 667 }) })
  const ctx = Object.assign({}, page, {
    data: {
      blocks: [{ type: 'photo', key: 'photos/a.jpg', url: 'wxfile://a.jpg', loaded: true, failed: false }],
      menus: { image: { groups: [[{ id: 'style', label: '图片风格', type: 'submenu', children: [{ id: 'cartoon', label: '卡通', instruction: '画 {{KEY}}' }] }]] } }
    },
    setData(update) { Object.assign(this.data, update) }
  })

  page.longpressBlock.call(ctx, {
    currentTarget: { dataset: { index: 0 } },
    detail: { x: 30, y: 300, rect: { top: 250, left: 24, width: 342, height: 400 } }
  })

  assert.equal(ctx.data.longpressAnchor.menuTop, 262)
  assert.equal(ctx.data.longpressAnchor.menuMaxHeight, 389)
  assert.equal(ctx.data.longpressAnchor.menuLeft, 24)
})

test('detail text longpress keeps the menu outside the paragraph', () => {
  const page = freshDetailPage(null, { getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 667 }) })
  const ctx = Object.assign({}, page, {
    data: {
      blocks: [{ type: 'paragraph', text: '正文', lineNo: 1 }],
      menus: { text: { groups: [[{ id: 'polish', label: '润色', instruction: '润色 {{LINE}}' }]] } }
    },
    setData(update) { Object.assign(this.data, update) }
  })

  page.longpressBlock.call(ctx, {
    currentTarget: { dataset: { index: 0 } },
    detail: { x: 24, y: 160, rect: { top: 160, left: 24, width: 342, height: 76 } }
  })

  assert.equal(ctx.data.longpressAnchor.menuTop, 248)
  assert.equal(ctx.data.longpressAnchor.menuMaxHeight, 403)
})

test('detail keeps a square grace placeholder until the image bindload event', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/detail/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/detail/index.wxss'), 'utf8')
  assert.match(wxml, /photoState === 'loading' \? 'preloading' : ''/)
  assert.match(wxml, /photoState === 'loading'[^>]*photo-placeholder photo-making grace/)
  assert.match(css, /\.article-image\.preloading\s*\{[^}]*position:\s*absolute;[^}]*opacity:\s*0;/s)

  const page = freshDetailPage()
  const ctx = Object.assign({}, page, {
    photoLoadSeq: 1,
    data: { blocks: [{ type: 'photo', key: 'photos/a.jpg', url: 'wxfile://a.jpg', photoState: 'loading' }] },
    setData(update) { Object.assign(this.data, update) }
  })
  page.onArticleImageLoad.call(ctx, { currentTarget: { dataset: { index: 0 } }, detail: { width: 640, height: 480 } })
  assert.equal(ctx.data.blocks[0].photoState, 'loaded')
})

test('detail longpress actions fill exact image key and real text line', () => {
  const page = freshDetailPage()
  const enqueued = []
  const ctx = Object.assign({}, page, {
    data: { articleIndex: 2, longpressMenuOpen: true, longpressTarget: { kind: 'image', block: { key: 'photos/s/1-a.jpg' } } },
    setData(update) { Object.assign(this.data, update) },
    enqueueInstruction(text, articleIndex) { enqueued.push({ text, articleIndex }) }
  })
  page.onLongpressPick.call(ctx, { detail: { node: { instruction: '重画 [[photo:{{KEY}}]]' } } })
  assert.deepEqual(enqueued[0], { text: '重画 [[photo:photos/s/1-a.jpg]]', articleIndex: 2 })

  ctx.data.longpressTarget = { kind: 'text', block: { lineNo: 7, text: '他说"你好"然后离开这里' } }
  page.onLongpressPick.call(ctx, { detail: { node: { instruction: '把第{{LINE}}行（{{QUOTE}}）变短' } } })
  assert.deepEqual(enqueued[1], { text: "把第7行（他说'你好'然后离开这里）变短", articleIndex: 2 })
})

test('detail image instruction starts grace then making state for the exact photo key', () => {
  const page = freshDetailPage()
  const timers = []
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  global.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length }
  global.clearTimeout = () => {}
  const ctx = Object.assign({}, page, {
    data: {
      blocks: [
        { type: 'photo', key: 'photos/a.jpg', url: 'wxfile://a.jpg', photoState: 'loaded' },
        { type: 'photo', key: 'photos/b.jpg', url: 'wxfile://b.jpg', photoState: 'loaded' }
      ]
    },
    setData(update) { Object.assign(this.data, update) },
    pollMakingPhoto() {}
  })
  try {
    page.startPhotoMaking.call(ctx, 'photos/b.jpg')
    assert.equal(ctx.data.blocks[0].photoState, 'loaded')
    assert.equal(ctx.data.blocks[1].photoState, 'grace')
    assert.equal(ctx.data.blocks[1].url, '')
    assert.equal(timers[0].delay, 900)
    timers[0].callback()
    assert.equal(ctx.data.blocks[1].photoState, 'making')
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
})

test('detail page renders iOS making and failed photo placeholders', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/detail/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/detail/index.wxss'), 'utf8')
  assert.match(wxml, /正在制作中/)
  assert.match(wxml, /约 1 分钟完成/)
  assert.match(wxml, /暂时无法显示/)
  assert.match(wxml, /bindtap="retryMakingPhoto"[^>]*>重试</)
  assert.match(wxml, /photo-making-dot/)
  assert.match(css, /@keyframes\s+photo-making-pulse/)
  assert.match(css, /#f3eee4/i)
  assert.match(css, /#ece4d6/i)
})

test('detail making photo poll replaces the image and stops its task', async () => {
  const page = freshDetailPage({ downloadPhotoTemp: async () => 'wxfile://fresh.jpg' })
  const ctx = Object.assign({}, page, {
    data: { photoScope: 'users/anon/', blocks: [{ type: 'photo', key: 'photos/a.jpg', photoState: 'making', url: '' }] },
    photoMakingTasks: { 'photos/a.jpg': { generation: 3, deadline: Date.now() + 10000, timer: null } },
    setData(update) { Object.assign(this.data, update) }
  })

  await page.pollMakingPhoto.call(ctx, 'photos/a.jpg', 3)

  assert.equal(ctx.data.blocks[0].photoState, 'loading')
  assert.equal(ctx.data.blocks[0].url, 'wxfile://fresh.jpg')
  assert.equal(ctx.photoMakingTasks['photos/a.jpg'], undefined)

  page.onArticleImageLoad.call(ctx, { currentTarget: { dataset: { index: 0 } }, detail: { width: 640, height: 640 } })
  assert.equal(ctx.data.blocks[0].photoState, 'loaded')
})

test('detail making photo poll times out and retry returns to grace', async () => {
  const page = freshDetailPage()
  const ctx = Object.assign({}, page, {
    data: { blocks: [{ type: 'photo', key: 'photos/a.jpg', photoState: 'making', url: '' }] },
    photoMakingTasks: { 'photos/a.jpg': { generation: 4, deadline: Date.now() - 1, timer: null } },
    setData(update) { Object.assign(this.data, update) }
  })

  await page.pollMakingPhoto.call(ctx, 'photos/a.jpg', 4)
  assert.equal(ctx.data.blocks[0].photoState, 'failed')

  let retried = ''
  ctx.startPhotoMaking = (key) => { retried = key }
  page.retryMakingPhoto.call(ctx, { currentTarget: { dataset: { key: 'photos/a.jpg' } } })
  assert.equal(retried, 'photos/a.jpg')
})

test('detail transfers making state from backend old key to replacement key', () => {
  const page = freshDetailPage()
  const started = []
  const ctx = Object.assign({}, page, {
    data: {
      articleIndex: 0,
      photoScope: 'users/anon/',
      photoInsertPromptVisible: false,
      blocks: [{ type: 'photo', key: 'photos/old.jpg', imageNo: 1, photoState: 'making' }]
    },
    photoMakingTasks: { 'photos/old.jpg': { generation: 1, deadline: Date.now() + 10000, timer: null } },
    setData(update) { Object.assign(this.data, update) },
    loadArticlePhotos(blocks) { this.loadedBlocks = blocks },
    startPhotoMaking(key, options) { started.push({ key, options }) }
  })

  page.applyDoc.call(ctx, { articles: [{ title: 'A', body: '[[photo:photos/new-edited.jpg]]' }], photos: [] })

  assert.equal(ctx.data.blocks[0].key, 'photos/new-edited.jpg')
  assert.equal(ctx.data.blocks[0].photoState, 'grace')
  assert.deepEqual(started, [{ key: 'photos/new-edited.jpg', options: { poll: true } }])
  assert.equal(ctx.loadedBlocks[0].photoState, 'grace')
})

test('detail image longpress ignores photos without a loaded url', () => {
  const page = freshDetailPage()
  const ctx = Object.assign({}, page, {
    data: { longpressMenuOpen: false, blocks: [{ type: 'photo', key: 'photos/a.jpg', url: '', failed: false }], menus: { image: { groups: [] } } },
    setData(update) { Object.assign(this.data, update) }
  })
  page.longpressBlock.call(ctx, { currentTarget: { dataset: { index: 0 } } })
  assert.equal(ctx.data.longpressMenuOpen, false)
})

test('detail page downloads own uploaded photo markers with owner scope like Android', async () => {
  const downloaded = []
  const page = freshDetailPage()
  const ctx = {
    data: {
      articleIndex: 0,
      photoScope: ''
    },
    setData(update) {
      Object.assign(this.data, update)
    },
    applyDoc: page.applyDoc,
    loadArticlePhotos: page.loadArticlePhotos,
    updateArticlePhotoBlock: page.updateArticlePhotoBlock,
    photoLoadSeq: 0,
    articlePhotoCache: {}
  }
  const library = require('../services/library')
  library.downloadPhotoTemp = async (key, scope) => {
    downloaded.push({ key, scope })
    return 'wxfile://downloaded-lc1.jpg'
  }
  const doc = {
    owner: 'users/anon-owner/',
    articles: [{
      title: '第一篇',
      body: '正文\n\n[[photo:photos/2026-06-28-103217/0-lc1.jpg]]'
    }],
    photos: []
  }

  page.applyDoc.call(ctx, doc)

  assert.deepEqual(ctx.data.blocks, [
    { type: 'paragraph', text: '正文', lineNo: 1 },
    {
      type: 'photo',
      key: 'photos/2026-06-28-103217/0-lc1.jpg',
      lineNo: 2,
      imageNo: 1,
      url: '',
      remoteUrl: 'users/anon-owner/photos/2026-06-28-103217/0-lc1.jpg',
      loading: true,
      loaded: false,
      photoState: 'loading'
    }
  ])
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(downloaded, [{ key: 'photos/2026-06-28-103217/0-lc1.jpg', scope: 'users/anon-owner/' }])
  assert.equal(ctx.data.blocks[1].url, 'wxfile://downloaded-lc1.jpg')
  assert.equal(ctx.data.blocks[1].loading, false)
})

test('detail page enqueues pending photo insert after returning from picker', () => {
  const page = freshDetailPage()
  const app = page.__app
  const enqueued = []
  let createdFor = ''
  app.globalData.pendingPhotoInsert = {
    stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon',
    instruction: '插入 [[photo:photos/a.jpg]]',
    images: [{ key: 'photos/a.jpg', base64: 'abc' }]
  }
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' },
      articleIndex: 2
    },
    setData(update) {
      Object.assign(this.data, update)
    },
    createEditSession(stem) {
      createdFor = stem
      this.editSession = {
        connect() {},
        enqueue(text, articleIndex, images) {
          enqueued.push({ text, articleIndex, images })
        }
      }
    },
    ensureEditSession: page.ensureEditSession,
    enqueueInstruction: page.enqueueInstruction
  }

  page.onShow.call(ctx)

  assert.equal(createdFor, 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon')
  assert.deepEqual(enqueued, [{
    text: '插入 [[photo:photos/a.jpg]]',
    articleIndex: 2,
    images: [{ key: 'photos/a.jpg', base64: 'abc' }]
  }])
  assert.equal(app.globalData.pendingPhotoInsert, null)
})

test('detail page shows Android-style prompt after enqueuing a photo insert instruction', () => {
  const page = freshDetailPage()
  const enqueued = []
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' },
      articleIndex: 0,
      photoInsertTip: '',
      photoInsertInstruction: '',
      photoInsertPromptVisible: false
    },
    setData(update) {
      Object.assign(this.data, update)
    },
    ensureEditSession() {
      return {
        enqueue(text, articleIndex, images) {
          enqueued.push({ text, articleIndex, images })
        }
      }
    }
  }
  const instruction = '我刚拍了这张照片，请把它插入文章里最合适的位置：[[photo:photos/a.jpg]]。'

  page.enqueueInstruction.call(ctx, instruction, 0, [{ key: 'photos/a.jpg', base64: 'abc' }])

  assert.equal(enqueued.length, 1)
  assert.equal(ctx.data.photoInsertTip, '图片已上传，AI正在插入...')
  assert.equal(ctx.data.photoInsertInstruction, instruction)
  assert.equal(ctx.data.photoInsertPromptVisible, true)
})

test('detail page hides stale photo insert prompt on entry', () => {
  const stem = 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon'
  const instruction = '我刚拍了这张照片：[[photo:photos/a.jpg]]。'
  let removedKey = ''
  const page = freshDetailPage({}, {
    getStorageSync: (key) => {
      if (key === `voicedrop.photoInsertPrompt.${stem}`) {
        return JSON.stringify({
          tip: '图片已上传，AI正在插入...',
          instruction
        })
      }
      return ''
    },
    removeStorageSync: (key) => { removedKey = key }
  })
  const ctx = {
    data: {},
    setData(update) {
      Object.assign(this.data, update)
    },
    createEditSession() {},
    loadMenus() {},
    load() {}
  }

  page.onLoad.call(ctx, { stem: encodeURIComponent(stem) })

  assert.equal(ctx.data.rec.stem, stem)
  assert.equal(ctx.data.photoInsertTip || '', '')
  assert.equal(ctx.data.photoInsertInstruction || '', '')
  assert.equal(Boolean(ctx.data.photoInsertPromptVisible), false)
  assert.equal(removedKey, `voicedrop.photoInsertPrompt.${stem}`)
})

test('detail page applies completed photo insert doc after returning from picker', () => {
  const page = freshDetailPage()
  const app = page.__app
  let applied = null
  let refreshed = false
  app.globalData.pendingPhotoInsertDoc = {
    stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon',
    doc: { articles: [{ title: '新文章', body: '正文\n\n[[photo:photos/a.jpg]]' }] }
  }
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' }
    },
    applyDoc(doc) {
      applied = doc
    },
    refreshVersionNav() {
      refreshed = true
    }
  }

  page.onShow.call(ctx)

  assert.equal(applied.articles[0].title, '新文章')
  assert.equal(refreshed, true)
  assert.equal(app.globalData.pendingPhotoInsertDoc, null)
})

test('detail page back skips stale insert photo page in navigation stack', () => {
  const page = freshDetailPage()
  const app = page.__app
  global.getCurrentPages = () => [
    { route: 'pages/recordings/index' },
    { route: 'pages/insert-photo/index' },
    { route: 'pages/detail/index' }
  ]

  page.goBack()

  assert.deepEqual(app.navigatedBack, { delta: 2 })
})

test('detail page opens inline photo sheet instead of navigating to insert photo page', () => {
  const page = freshDetailPage()
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' },
      photoSheetOpen: false
    },
    setData(update) {
      Object.assign(this.data, update)
    }
  }

  page.insertPhoto.call(ctx)

  assert.equal(ctx.data.photoSheetOpen, true)
  assert.equal(page.__app.navigatedTo, undefined)
})

test('detail page opens a bottom style rewrite sheet with newest style rows', async () => {
  const page = freshDetailPage({
    versionHistory: async () => ({
      head: 2,
      versions: [
        { v: 2, articles: [{ title: 'A', body: '<!-- style: 风格 v6 -->正文' }] }
      ]
    })
  }, {}, null, null, {
    loadStyleHistory: async () => ({
      versions: [
        { v: 4, style: '胸有成竹地下断言，不绕弯。', savedAt: '2026-07-04T00:00:00.000Z' },
        { v: 7, style: '12344556', savedAt: '2026-07-08T00:00:00.000Z' }
      ]
    })
  })
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' },
      current: { style: 7 },
      history: null,
      editQueue: []
    },
    setData(update) {
      Object.assign(this.data, update)
    }
  }

  await page.openStyleSheet.call(ctx)

  assert.equal(ctx.data.styleSheetOpen, true)
  assert.equal(ctx.data.styleSheetSelectedVersion, 7)
  assert.equal(ctx.data.styleSheetRows[0].v, 7)
  assert.equal(ctx.data.styleSheetRows[0].preview, '12344556')
  assert.equal(ctx.data.styleSheetRows[0].words, 8)
  assert.equal(ctx.data.styleSheetRows[0].date, '7月8日')
  assert.equal(ctx.data.styleSheetRows[0].selected, true)
  assert.equal(ctx.data.styleSheetRows[1].generated, false)
})

test('detail page detects generated style versions across all articles like Android', async () => {
  const page = freshDetailPage({
    versionHistory: async () => ({
      head: 9,
      versions: [
        {
          v: 9,
          articles: [
            { title: 'A', body: '正文' },
            { title: 'B', body: '正文', style: 7 }
          ]
        }
      ]
    })
  }, {}, null, null, {
    loadStyleHistory: async () => ({
      versions: [
        { v: 7, style: '12344556', savedAt: '2026-07-08T00:00:00.000Z' }
      ]
    })
  })
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' },
      current: { style: null },
      history: null,
      editQueue: []
    },
    setData(update) {
      Object.assign(this.data, update)
    }
  }

  await page.openStyleSheet.call(ctx)

  assert.equal(ctx.data.styleSheetRows[0].generated, true)
  assert.equal(ctx.data.styleSheetButtonText, '切换到 v7 风格')
})

test('detail page submits selected style version from bottom sheet', async () => {
  const page = freshDetailPage()
  const called = []
  const ctx = {
    data: {
      styleSheetOpen: true,
      styleSheetSelectedVersion: 4,
      styleSheetGenerated: { 4: { v: 2 } }
    },
    setData(update) {
      Object.assign(this.data, update)
    },
    requestStyleRewriteOrSwitch: async (styleVersion, generated) => {
      assert.equal(ctx.data.styleSheetOpen, false)
      called.push({ styleVersion, generated })
    }
  }

  await page.submitStyleSheet.call(ctx)

  assert.deepEqual(called, [{ styleVersion: 4, generated: { 4: { v: 2 } } }])
  assert.equal(ctx.data.styleSheetOpen, false)
})

test('detail page updates style label after successful style rewrite request', async () => {
  const toasts = []
  const page = freshDetailPage({
    restyleResult: async () => ({ ok: true })
  }, {
    showToast: (options) => { toasts.push(options) }
  })
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' },
      styleLabel: '选风格'
    },
    setData(update) {
      Object.assign(this.data, update)
    },
    switchArticleHead: async () => {}
  }

  await page.requestStyleRewriteOrSwitch.call(ctx, 7, {})

  assert.equal(ctx.data.styleLabel, 'v7 风格')
  assert.equal(toasts[0].title, '正在用 v7 重写')
})

test('detail page shows restyle backend failure details', async () => {
  const modals = []
  const page = freshDetailPage({
    restyleResult: async () => ({ ok: false, message: 'HTTP 500: internal-error' })
  }, {
    showModal: (options) => { modals.push(options) }
  })
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' }
    },
    switchArticleHead: async () => {}
  }

  await page.requestStyleRewriteOrSwitch.call(ctx, 7, {})

  assert.equal(modals.length, 1)
  assert.equal(modals[0].title, '提交失败')
  assert.equal(modals[0].content, 'HTTP 500: internal-error')
})

test('detail style sheet keeps rows and submit button full width', () => {
  const css = fs.readFileSync(path.join(root, 'pages/detail/index.wxss'), 'utf8')

  assert.match(css, /\.style-sheet-list\s*\{[^}]*width:\s*100%;[^}]*box-sizing:\s*border-box;/s)
  assert.match(css, /\.style-sheet-row\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*100%;[^}]*max-width:\s*100%;/s)
  assert.match(css, /\.style-sheet-submit\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*100%;[^}]*max-width:\s*100%;/s)
})

test('detail style sheet has top-right close and no cancel or grabber', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/detail/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/detail/index.wxss'), 'utf8')
  const styleSheet = wxml.slice(wxml.indexOf('<view class="style-sheet-layer"'), wxml.indexOf('<view class="edit-dock"'))

  assert.doesNotMatch(styleSheet, />取消</)
  assert.doesNotMatch(wxml, /style-sheet-grabber/)
  assert.match(wxml, /class="style-sheet-close"/)
  assert.doesNotMatch(css, /\.style-sheet-grabber\s*\{/)
  assert.match(css, /\.style-sheet-close\s*\{[^}]*position:\s*absolute;[^}]*top:\s*26rpx;[^}]*right:\s*28rpx;/s)
})

test('detail photo picker accumulates photos without uploading', async () => {
  const batches = [
    [{ tempFilePath: '/tmp/a.jpg' }, { tempFilePath: '/tmp/b.jpg' }],
    [{ tempFilePath: '/tmp/c.jpg' }]
  ]
  const requestedCounts = []
  let uploads = 0
  const page = freshDetailPage({}, {
    chooseMedia: ({ count, success }) => {
      requestedCounts.push(count)
      success({ tempFiles: batches.shift() })
    }
  })
  const ctx = {
    data: { photoPickerPhotos: [], photoUploading: false },
    setData(update) { Object.assign(this.data, update) },
    uploadDetailPhotos() { uploads += 1 }
  }

  await page.chooseDetailPhoto.call(ctx, { currentTarget: { dataset: { source: 'album' } } })
  await page.chooseDetailPhoto.call(ctx, { currentTarget: { dataset: { source: 'album' } } })

  assert.deepEqual(requestedCounts, [9, 7])
  assert.deepEqual(ctx.data.photoPickerPhotos.map((item) => item.path), [
    '/tmp/a.jpg',
    '/tmp/b.jpg',
    '/tmp/c.jpg'
  ])
  assert.equal(uploads, 0)
})

test('detail photo picker falls back to chooseImage when chooseMedia is unavailable', async () => {
  const requestedCounts = []
  const page = freshDetailPage({}, {
    chooseMedia: undefined,
    chooseImage: ({ count, sourceType, success }) => {
      requestedCounts.push({ count, sourceType })
      success({
        tempFilePaths: ['/tmp/fallback-a.jpg', '/tmp/fallback-b.jpg'],
        tempFiles: [
          { path: '/tmp/fallback-a.jpg' },
          { path: '/tmp/fallback-b.jpg' }
        ]
      })
    }
  })
  const ctx = {
    data: { photoPickerPhotos: [], photoUploading: false },
    setData(update) { Object.assign(this.data, update) },
    uploadDetailPhotos() { throw new Error('should not auto upload') }
  }

  const ok = await page.chooseDetailPhoto.call(ctx, { currentTarget: { dataset: { source: 'album' } } })

  assert.equal(ok, true)
  assert.deepEqual(requestedCounts, [{ count: 9, sourceType: ['album'] }])
  assert.deepEqual(ctx.data.photoPickerPhotos.map((item) => item.path), [
    '/tmp/fallback-a.jpg',
    '/tmp/fallback-b.jpg'
  ])
})

test('detail photo picker prefers chooseImage to avoid reopening the page with media picker', async () => {
  const calls = []
  const page = freshDetailPage({}, {
    chooseImage: ({ success }) => {
      calls.push('chooseImage')
      success({ tempFilePaths: ['/tmp/image-only.jpg'] })
    },
    chooseMedia: () => {
      calls.push('chooseMedia')
      throw new Error('chooseMedia should not be used when chooseImage is available')
    }
  })
  const ctx = {
    data: { photoPickerPhotos: [], photoUploading: false },
    setData(update) { Object.assign(this.data, update) }
  }

  await page.chooseDetailPhoto.call(ctx, { currentTarget: { dataset: { source: 'album' } } })

  assert.deepEqual(calls, ['chooseImage'])
  assert.deepEqual(ctx.data.photoPickerPhotos.map((item) => item.path), ['/tmp/image-only.jpg'])
})

test('detail photo picker does not reopen sheet when native picker returns to the same page', async () => {
  const updates = []
  const page = freshDetailPage({}, {
    chooseMedia: ({ success }) => {
      success({ tempFiles: [{ tempFilePath: '/tmp/same-page.jpg' }] })
    }
  })
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' },
      photoSheetOpen: true,
      photoPickerPhotos: [],
      photoUploading: false
    },
    setData(update) {
      updates.push(update)
      Object.assign(this.data, update)
    }
  }

  await page.chooseDetailPhoto.call(ctx, { currentTarget: { dataset: { source: 'album' } } })

  assert.equal(ctx.data.photoSheetOpen, true)
  assert.equal(ctx.data.photoPickerCount, 1)
  assert.equal(updates.some((update) => Object.prototype.hasOwnProperty.call(update, 'photoSheetOpen')), false)
})

test('detail photo picker restores selected photos after native picker rebuilds the page', () => {
  const stem = 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon'
  const page = freshDetailPage()
  page.__app.globalData.currentRecording = { stem, audioName: `${stem}.m4a` }
  page.__app.globalData.detailPhotoPickerDraft = {
    stem,
    photos: [
      { path: '/tmp/rebuilt-a.jpg' },
      { path: '/tmp/rebuilt-b.jpg' }
    ]
  }
  const ctx = {
    data: {},
    setData(update, callback) {
      Object.assign(this.data, update)
      if (callback) callback()
    },
    createEditSession() {},
    loadMenus() {},
    load() {},
    restorePhotoPickerDraft: page.restorePhotoPickerDraft
  }

  page.onLoad.call(ctx, { stem: encodeURIComponent(stem) })

  assert.equal(ctx.data.photoSheetOpen, true)
  assert.equal(ctx.data.photoPickerCount, 2)
  assert.deepEqual(ctx.data.photoPickerPhotos.map((item) => item.path), [
    '/tmp/rebuilt-a.jpg',
    '/tmp/rebuilt-b.jpg'
  ])
})

test('detail photo picker applies selected photos to rebuilt visible detail page on device', async () => {
  let chooseImageSuccess
  const stem = 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon'
  const page = freshDetailPage({}, {
    chooseImage: ({ success }) => {
      chooseImageSuccess = success
    },
    chooseMedia: undefined
  })
  const oldCtx = {
    data: {
      rec: { stem },
      photoSheetOpen: true,
      photoPickerPhotos: [],
      photoPickerCount: 0
    },
    setData(update) {
      Object.assign(this.data, update)
    },
    photoPickerUpdateForPhotos: page.photoPickerUpdateForPhotos
  }
  const visibleDetail = {
    route: 'pages/detail/index',
    data: {
      rec: { stem },
      photoSheetOpen: false,
      photoPickerPhotos: [],
      photoPickerCount: 0
    },
    setData(update) {
      Object.assign(this.data, update)
    }
  }
  global.getCurrentPages = () => [
    { route: 'pages/recordings/index' },
    visibleDetail
  ]

  const selecting = page.chooseDetailPhoto.call(oldCtx, { currentTarget: { dataset: { source: 'album' } } })
  chooseImageSuccess({
    tempFilePaths: ['/tmp/device-a.jpg', '/tmp/device-b.jpg']
  })
  await selecting

  assert.equal(visibleDetail.data.photoSheetOpen, true)
  assert.equal(visibleDetail.data.photoPickerCount, 2)
  assert.deepEqual(visibleDetail.data.photoPickerPhotos.map((item) => item.path), [
    '/tmp/device-a.jpg',
    '/tmp/device-b.jpg'
  ])
})

test('detail photo picker removes one staged photo', () => {
  const page = freshDetailPage()
  const ctx = {
    data: {
      photoPickerPhotos: [
        { path: '/tmp/a.jpg' },
        { path: '/tmp/b.jpg' },
        { path: '/tmp/c.jpg' }
      ]
    },
    setData(update) { Object.assign(this.data, update) }
  }

  page.removeDetailPhoto.call(ctx, { currentTarget: { dataset: { index: 1 } } })

  assert.deepEqual(ctx.data.photoPickerPhotos.map((item) => item.path), ['/tmp/a.jpg', '/tmp/c.jpg'])
})

test('detail explicit playback restores the speaker after audio-session reset', () => {
  const js = fs.readFileSync(path.join(root, 'pages/detail/index.js'), 'utf8')
  const playback = js.slice(js.indexOf('  async togglePlayback()'), js.indexOf('  stopPlayback()'))

  assert.match(playback, /audioSessionReset\.preparePlayback\(\)/)
})

test('detail page numbers paragraphs and photos while holding to talk like iOS', async () => {
  const page = freshDetailPage({}, {
    authorize: () => {}
  })
  const ctx = {
    data: {
      articleIndex: 0,
      photoScope: '',
      holdEditLocatorsVisible: false,
      holdEditState: 'idle',
      holdEditButtonText: '按住 说话 修改',
      holdEditBubbleVisible: false,
      holdEditTranscriptText: ''
    },
    setData(update) { Object.assign(this.data, update) },
    loadArticlePhotos() {},
    applyDoc: page.applyDoc,
    resetHoldArticleEdit: page.resetHoldArticleEdit,
    beginHoldArticleEdit() {},
    finishHoldArticleEditSession: page.finishHoldArticleEditSession,
    requestAudioConsent: async () => true
  }

  page.applyDoc.call(ctx, {
    articles: [{
      title: '正文',
      body: '第一段\n\n[[photo:photos/a.jpg]]\n\n第二段'
    }],
    photos: []
  })

  assert.deepEqual(ctx.data.blocks.map((item) => ({
    type: item.type,
    lineNo: item.lineNo,
    imageNo: item.imageNo || 0
  })), [
    { type: 'paragraph', lineNo: 1, imageNo: 0 },
    { type: 'photo', lineNo: 2, imageNo: 1 },
    { type: 'paragraph', lineNo: 3, imageNo: 0 }
  ])

  await page.startHoldArticleEdit.call(ctx, { touches: [{ clientY: 400 }] })
  assert.equal(ctx.data.holdEditLocatorsVisible, true)

  await page.finishHoldArticleEdit.call(ctx)
  assert.equal(ctx.data.holdEditLocatorsVisible, false)
})

test('detail page opens custom more menu and routes actions', async () => {
  const page = freshDetailPage()
  const calls = []
  const ctx = {
    data: {
      moreMenuOpen: false,
      sharedToCommunity: true,
      communityShareId: 'share-1'
    },
    setData(update) {
      Object.assign(this.data, update)
    },
    publishWechat() { calls.push('publishWechat') },
    shareCommunity() { calls.push('community') },
    copyArticleWithLink() { calls.push('copyArticleWithLink') },
    confirmDelete() { calls.push('delete') }
  }
  global.wx.showActionSheet = () => {
    throw new Error('custom menu should not use wx.showActionSheet')
  }

  page.showMoreActions.call(ctx)
  assert.equal(ctx.data.moreMenuOpen, true)

  await page.runMoreMenuAction.call(ctx, { currentTarget: { dataset: { action: 'community' } } })
  await page.runMoreMenuAction.call(ctx, { currentTarget: { dataset: { action: 'share' } } })
  await page.runMoreMenuAction.call(ctx, { currentTarget: { dataset: { action: 'delete' } } })
  await page.runMoreMenuAction.call(ctx, { currentTarget: { dataset: { action: 'publishWechat' } } })

  assert.deepEqual(calls, ['community', 'copyArticleWithLink', 'delete', 'publishWechat'])
  assert.equal(ctx.data.moreMenuOpen, false)
})

test('detail page opens community terms with a Mini Program compatible action label', async () => {
  const storage = {}
  let modal
  let shares = 0
  const page = freshDetailPage({}, {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    showModal(options) { modal = options }
  })
  const ctx = {
    data: { sharedToCommunity: false, communityShareId: '' },
    doShareCommunity() { shares += 1 }
  }

  await page.shareCommunity.call(ctx)

  assert.equal(modal.confirmText, '同意发布')
  assert.ok(modal.confirmText.length <= 4)
  assert.equal(shares, 0)
  modal.success({ confirm: true })
  assert.equal(storage['voicedrop.community.terms.agreed'], '1')
  assert.equal(shares, 1)
})

test('detail page reports a community terms modal failure without publishing', async () => {
  const storage = {}
  let shares = 0
  let toast = ''
  const page = freshDetailPage({}, {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    showToast(options) { toast = options.title },
    showModal(options) {
      if (options.fail) options.fail({ errMsg: 'showModal:fail confirmText too long' })
    }
  })
  const ctx = {
    data: { sharedToCommunity: false, communityShareId: '' },
    doShareCommunity() { shares += 1 }
  }

  await page.shareCommunity.call(ctx)

  assert.equal(toast, '社区公约打开失败')
  assert.equal(storage['voicedrop.community.terms.agreed'], undefined)
  assert.equal(shares, 0)
})

test('detail page guards duplicate community share requests', async () => {
  let resolveShare
  let calls = 0
  const page = freshDetailPage({}, {}, null, null, null, {
    shareResult: async () => {
      calls += 1
      return new Promise((resolve) => { resolveShare = resolve })
    }
  })
  const ctx = {
    data: { rec: { stem: 'VoiceDrop-test' }, sharingCommunity: false },
    setData(update) { Object.assign(this.data, update) }
  }

  const first = page.doShareCommunity.call(ctx)
  const second = page.doShareCommunity.call(ctx)
  assert.equal(calls, 1)
  assert.equal(ctx.data.sharingCommunity, true)

  resolveShare({ ok: true, shareId: 'share-1' })
  await Promise.all([first, second])
  assert.equal(ctx.data.sharingCommunity, false)
})

test('detail page sends expired community identity to WeChat login', async () => {
  const page = freshDetailPage({}, {
    showToast(options) { this.toastTitle = options.title },
    showLoading() {},
    hideLoading() {},
    navigateTo(options) { this.navigatedTo = options.url }
  }, null, null, null, {
    shareResult: async () => ({ ok: false, needsWechatSignin: true })
  })
  const ctx = {
    data: { rec: { stem: 'VoiceDrop-test' }, sharingCommunity: false },
    setData(update) { Object.assign(this.data, update) }
  }

  await page.doShareCommunity.call(ctx)

  assert.equal(global.wx.toastTitle, '请重新微信登录')
  assert.equal(global.wx.navigatedTo, '/pages/account/index')
  assert.equal(ctx.data.sharingCommunity, false)
})

test('detail page reports community request failures and clears loading state', async () => {
  const page = freshDetailPage({}, {
    showToast(options) { this.toastTitle = options.title },
    showLoading(options) { this.loadingTitle = options.title },
    hideLoading() { this.loadingHidden = true }
  }, null, null, null, {
    shareResult: async () => { throw new Error('request:fail domain not configured') }
  })
  const ctx = {
    data: { rec: { stem: 'VoiceDrop-test' }, sharingCommunity: false },
    setData(update) { Object.assign(this.data, update) }
  }

  await page.doShareCommunity.call(ctx)

  assert.equal(global.wx.loadingTitle, '正在发布')
  assert.equal(global.wx.loadingHidden, true)
  assert.equal(global.wx.toastTitle, '网络异常，请稍后重试')
  assert.equal(ctx.data.sharingCommunity, false)
})

test('detail page explains when the article belongs to another account', async () => {
  const page = freshDetailPage({}, {
    showToast(options) { this.toastTitle = options.title },
    showLoading() {},
    hideLoading() {}
  }, null, null, null, {
    shareResult: async () => ({ ok: false, articleNotFound: true })
  })
  const ctx = {
    data: { rec: { stem: 'VoiceDrop-test' }, sharingCommunity: false },
    setData(update) { Object.assign(this.data, update) }
  }

  await page.doShareCommunity.call(ctx)

  assert.equal(global.wx.toastTitle, '该文章不属于当前微信账号')
})

test('detail page more menu mirrors iOS draft and share behavior', async () => {
  const page = freshDetailPage({
    publishWechat: async () => ({ ok: true, updated: false })
  })
  const ctx = {
    data: {
      articleIndex: 0,
      photoScope: '',
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' },
      hasWechatDraft: false
    },
    setData(update, callback) {
      Object.assign(this.data, update)
      if (callback) callback()
    },
    loadArticlePhotos() {},
    applyDoc: page.applyDoc,
    publishWechat: page.publishWechat
  }

  page.applyDoc.call(ctx, {
    articles: [
      { title: '没有草稿', body: '正文' },
      { title: '已有草稿', body: '正文', wechatMediaId: 'media-1' }
    ],
    photos: []
  })
  assert.equal(ctx.data.hasWechatDraft, true)

  ctx.data.hasWechatDraft = false
  await page.publishWechat.call(ctx)
  assert.equal(ctx.data.hasWechatDraft, true)
})

test('detail page shows publishing hint while sending wechat draft', async () => {
  let resolvePublish
  const page = freshDetailPage({
    publishWechat: async () => new Promise((resolve) => {
      resolvePublish = () => resolve({ ok: true, updated: true })
    })
  }, {
    showLoading(options) { this.loadingTitle = options.title },
    hideLoading() { this.loadingHidden = true },
    showToast(options) { this.toastTitle = options.title }
  })
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' },
      hasWechatDraft: false
    },
    setData(update) {
      Object.assign(this.data, update)
    }
  }

  const pending = page.publishWechat.call(ctx)
  assert.equal(global.wx.loadingTitle, '正在发布')
  assert.equal(ctx.data.publishingWechat, true)

  resolvePublish()
  await pending

  assert.equal(global.wx.loadingHidden, true)
  assert.equal(global.wx.toastTitle, '草稿已更新')
  assert.equal(ctx.data.publishingWechat, false)
})

test('detail page shows updating hint when wechat draft already exists', async () => {
  let resolvePublish
  const page = freshDetailPage({
    publishWechat: async () => new Promise((resolve) => {
      resolvePublish = () => resolve({ ok: true, updated: true })
    })
  }, {
    showLoading(options) { this.loadingTitle = options.title },
    hideLoading() {},
    showToast() {}
  })
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' },
      hasWechatDraft: true
    },
    setData(update) {
      Object.assign(this.data, update)
    }
  }

  const pending = page.publishWechat.call(ctx)
  assert.equal(global.wx.loadingTitle, '正在更新')

  resolvePublish()
  await pending
})

test('detail page hides photo insert prompt after AI updates the article', () => {
  const page = freshDetailPage()
  let removedKey = ''
  global.wx.removeStorageSync = (key) => { removedKey = key }
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' },
      articleIndex: 0,
      photoScope: '',
      photoInsertTip: '图片已上传，AI正在插入...',
      photoInsertInstruction: '我刚拍了这张照片：[[photo:photos/a.jpg]]。',
      photoInsertPromptVisible: true,
      photoLoadSeq: 0,
      articlePhotoCache: {}
    },
    setData(update, callback) {
      Object.assign(this.data, update)
      if (callback) callback()
    },
    loadArticlePhotos: () => {}
  }

  page.applyDoc.call(ctx, {
    articles: [{
      title: '第一篇',
      body: '正文\n\n[[photo:photos/a.jpg]]'
    }],
    photos: []
  })

  assert.equal(ctx.data.photoInsertTip || '', '')
  assert.equal(ctx.data.photoInsertInstruction || '', '')
  assert.equal(Boolean(ctx.data.photoInsertPromptVisible), false)
  assert.equal(removedKey, 'voicedrop.photoInsertPrompt.VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon')
})

test('detail page maps edit queue and reply into iOS feedback stack', () => {
  const page = freshDetailPage()
  const ctx = {
    data: {
      history: null,
      holdEditState: 'idle',
      holdEditButtonText: '按住 说话 修改'
    },
    setData(update) {
      Object.assign(this.data, update)
    }
  }

  page.onEditQueueChanged.call(ctx, [
    { id: 'first', text: '把开头改短' },
    { id: 'second', text: '插入这张图片' }
  ])

  assert.deepEqual(ctx.data.editFeedbackQueue, [
    { id: 'second', text: '插入这张图片', inFlight: false },
    { id: 'first', text: '把开头改短', inFlight: true }
  ])
  assert.equal(ctx.data.holdEditButtonText, '正在改…按住继续说')

  page.onEditReply.call(ctx, '修改完成', true)
  assert.equal(ctx.data.editReply, '修改完成')
  assert.equal(ctx.data.editReplyOk, true)
})

test('detail hold edit streams ASR and submits transcript on release', async () => {
  let handlers
  const sentFrames = []
  let frameHandler
  let errorHandler
  const unbound = []
  const recorder = {
    onFrameRecorded(callback) { frameHandler = callback; this.frame = callback },
    offFrameRecorded(callback) { unbound.push(['frame', callback]) },
    onError(callback) { errorHandler = callback; this.error = callback },
    offError(callback) { unbound.push(['error', callback]) },
    start() {},
    stop() {}
  }
  const page = freshDetailPage({}, {
    authorize: ({ success }) => success(),
    getRecorderManager: () => recorder
  }, null, {
    createSession(nextHandlers) {
      handlers = nextHandlers
      return {
        connect() {},
        sendAudio(frame) { sentFrames.push(frame) },
        finish() {},
        close() {}
      }
    }
  })
  const ctx = holdEditContext(page, 2)

  await page.startHoldArticleEdit.call(ctx, { touches: [{ clientY: 400 }] })
  handlers.onText('把开头改短', true)
  recorder.frame({ frameBuffer: 'pcm' })
  await page.finishHoldArticleEdit.call(ctx)

  assert.deepEqual(sentFrames, ['pcm'])
  assert.deepEqual(ctx.enqueued, [{ text: '把开头改短', articleIndex: 2 }])
  assert.equal(ctx.data.holdEditState, 'idle')
  assert.deepEqual(unbound, [
    ['frame', frameHandler],
    ['error', errorHandler]
  ])
})

test('detail hold edit waits for recorder stop and final ASR text before sending', async () => {
  let handlers
  let recorderStop
  const events = []
  const recorder = {
    onFrameRecorded() {},
    onError() {},
    onStop(handler) { recorderStop = handler },
    offStop() { events.push('offStop') },
    start() {},
    stop() { events.push('stop') }
  }
  const page = freshDetailPage({}, {
    getRecorderManager: () => recorder
  }, null, {
    createSession(nextHandlers) {
      handlers = nextHandlers
      return {
        connect() {},
        sendAudio() {},
        finish() { events.push('finish') },
        close() { events.push('close') }
      }
    }
  })
  const ctx = holdEditContext(page, 1)

  await page.startHoldArticleEdit.call(ctx, { touches: [{ clientY: 400 }] })
  handlers.onText('把结尾改', false)
  const finishing = page.finishHoldArticleEdit.call(ctx)
  await Promise.resolve()
  assert.deepEqual(events, ['stop'])

  recorderStop({})
  await Promise.resolve()
  assert.deepEqual(events.slice(0, 3), ['stop', 'offStop', 'finish'])
  handlers.onText('把结尾改完整', true)
  await finishing

  assert.deepEqual(ctx.enqueued, [{ text: '把结尾改完整', articleIndex: 1 }])
  assert.equal(events.at(-1), 'close')
})

test('detail hold edit resets the host audio session before enqueueing recognized text', async () => {
  let handlers
  let finishReset
  const resetStarted = []
  const recorder = {
    onFrameRecorded() {},
    onError() {},
    start() {},
    stop() {}
  }
  const page = freshDetailPage({}, {
    getRecorderManager: () => recorder
  }, null, {
    createSession(nextHandlers) {
      handlers = nextHandlers
      return { connect() {}, sendAudio() {}, finish() {}, close() {} }
    }
  }, null, null, {
    resetAfterRecording() {
      resetStarted.push(true)
      return new Promise((resolve) => { finishReset = resolve })
    }
  })
  const ctx = holdEditContext(page)

  await page.startHoldArticleEdit.call(ctx, { touches: [{ clientY: 400 }] })
  const finishing = page.finishHoldArticleEdit.call(ctx)
  await Promise.resolve()
  handlers.onText('补充最后一段', true)
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(resetStarted.length, 1)
  assert.deepEqual(ctx.enqueued, [])

  finishReset(true)
  await finishing

  assert.deepEqual(ctx.enqueued, [{ text: '补充最后一段', articleIndex: 0 }])
})

test('detail hold edit swipe-up cancel never submits', async () => {
  let asrClosed = false
  const recorder = {
    onFrameRecorded() {},
    onError() {},
    start() {},
    stop() {}
  }
  const page = freshDetailPage({}, {
    authorize: ({ success }) => success(),
    getRecorderManager: () => recorder
  }, null, {
    createSession() {
      return {
        connect() {},
        sendAudio() {},
        finish() {},
        close() { asrClosed = true }
      }
    }
  })
  const ctx = holdEditContext(page)

  await page.startHoldArticleEdit.call(ctx, { touches: [{ clientY: 400 }] })
  page.moveHoldArticleEdit.call(ctx, { touches: [{ clientY: 330 }] })
  assert.equal(ctx.data.holdEditState, 'canceling')
  await page.finishHoldArticleEdit.call(ctx)

  assert.deepEqual(ctx.enqueued, [])
  assert.equal(asrClosed, true)
  assert.equal(ctx.data.holdEditState, 'idle')
})

test('detail hold edit requests platform permission after audio consent', async () => {
  let authorized = false
  let recorderStarted = false
  const page = freshDetailPage({}, {
    getSetting: ({ success }) => success({ authSetting: {} }),
    authorize: ({ scope, success }) => { authorized = scope === 'scope.record'; success() },
    getRecorderManager: () => ({
      onFrameRecorded() {},
      onError() {},
      start() { recorderStarted = true },
      stop() {}
    })
  }, null, {
    createSession() {
      return { connect() {}, sendAudio() {}, finish() {}, close() {} }
    }
  })
  const ctx = holdEditContext(page)

  await page.startHoldArticleEdit.call(ctx, { touches: [{ clientY: 400 }] })

  assert.equal(recorderStarted, true)
  assert.equal(authorized, true)
  assert.equal(ctx.data.holdEditState, 'talking')
})

test('detail hold edit leaves the platform speaker route unchanged', async () => {
  const events = []
  const recorder = {
    onFrameRecorded() {},
    onError() {},
    start() { events.push(['start']) },
    stop() {}
  }
  const page = freshDetailPage({}, {
    getSystemInfoSync: () => ({ platform: 'ios' }),
    setInnerAudioOption(options) {
      events.push(['route', options.speakerOn, options.mixWithOther])
    },
    getRecorderManager: () => recorder
  }, null, {
    createSession() {
      return { connect() {}, sendAudio() {}, finish() {}, close() {} }
    }
  })
  const ctx = holdEditContext(page)

  await page.startHoldArticleEdit.call(ctx, { touches: [{ clientY: 400 }] })

  assert.deepEqual(events, [
    ['start']
  ])
})

test('detail hold edit unload stops recorder and closes ASR', () => {
  let recorderStopped = false
  let asrClosed = false
  let editSessionClosed = false
  const page = freshDetailPage()
  const ctx = holdEditContext(page)
  ctx.stopPlayback = () => {}
  ctx.holdEditRecorder = { stop() { recorderStopped = true } }
  ctx.holdEditAsrSession = { close() { asrClosed = true } }
  ctx.editSession = { close() { editSessionClosed = true } }

  page.onUnload.call(ctx)

  assert.equal(recorderStopped, true)
  assert.equal(asrClosed, true)
  assert.equal(editSessionClosed, true)
})

test('detail hide exits directly without touching audio resources or sockets', () => {
  const js = fs.readFileSync(path.join(root, 'pages/detail/index.js'), 'utf8')
  const onHide = js.slice(js.indexOf('  onHide() {'), js.indexOf('  onShow() {'))
  assert.doesNotMatch(onHide, /stopPlayback|pauseHoldArticleEditRecorder|stopHoldArticleEdit|editSession\.close/)

  const events = []
  const page = freshDetailPage()
  const ctx = {
    stopPlayback() { events.push('playback') },
    pauseHoldArticleEditRecorder() { events.push('pause') },
    stopHoldArticleEdit() { events.push('dictation') },
    editSession: { close() { events.push('edit') } }
  }

  page.onHide.call(ctx)

  assert.deepEqual(events, [])
  assert.equal(ctx._detailHidden, true)
})

test('detail show reconnects edit socket only after returning from background', () => {
  const page = freshDetailPage()
  let connects = 0
  const ctx = {
    _detailHidden: true,
    data: {
      rec: { stem: 'VoiceDrop-test' },
      photoInsertInstruction: '',
      photoInsertPromptVisible: false
    },
    editSession: { connect() { connects++ } },
    restorePhotoPickerDraft() {}
  }

  page.onShow.call(ctx)

  assert.equal(connects, 1)
  assert.equal(ctx._detailHidden, false)
})

test('detail hold edit ASR error stops recorder and resets state', async () => {
  let handlers
  let recorderStopped = false
  const recorder = {
    onFrameRecorded() {},
    onError() {},
    start() {},
    stop() { recorderStopped = true }
  }
  const page = freshDetailPage({}, {
    authorize: ({ success }) => success(),
    getRecorderManager: () => recorder
  }, null, {
    createSession(nextHandlers) {
      handlers = nextHandlers
      return { connect() {}, sendAudio() {}, finish() {}, close() {} }
    }
  })
  const ctx = holdEditContext(page)

  await page.startHoldArticleEdit.call(ctx, { touches: [{ clientY: 400 }] })
  handlers.onError('连接失败')

  assert.equal(recorderStopped, true)
  assert.equal(ctx.data.holdEditState, 'idle')
})

test('detail hold edit does not request microphone permission when audio consent is denied', async () => {
  let authorized = false
  const page = freshDetailPage({}, {
    authorize() { authorized = true }
  })
  const ctx = holdEditContext(page)
  ctx.requestAudioConsent = async () => false

  await page.startHoldArticleEdit.call(ctx, { touches: [{ clientY: 400 }] })

  assert.equal(authorized, false)
  assert.equal(ctx.data.holdEditState, 'idle')
  assert.equal(ctx.data.holdEditLocatorsVisible, false)
})

test('detail hold edit never starts after the finger is released during consent', async () => {
  let resolveConsent
  let authorized = false
  const consent = new Promise((resolve) => { resolveConsent = resolve })
  const page = freshDetailPage({}, {
    authorize() { authorized = true }
  })
  const ctx = holdEditContext(page)
  ctx.requestAudioConsent = () => consent

  const start = page.startHoldArticleEdit.call(ctx, { touches: [{ clientY: 400 }] })
  await page.finishHoldArticleEdit.call(ctx)
  resolveConsent(true)
  await start

  assert.equal(authorized, false)
  assert.equal(ctx.data.holdEditState, 'idle')
})

test('detail page registers and renders the shared audio consent dialog', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'pages/detail/index.json'), 'utf8'))
  const js = fs.readFileSync(path.join(root, 'pages/detail/index.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'pages/detail/index.wxml'), 'utf8')

  assert.equal(config.usingComponents['audio-consent-dialog'], '/components/audio-consent-dialog/index')
  assert.match(js, /const audioConsentFlow = require\('\.\.\/\.\.\/utils\/audio-consent-flow'\)/)
  assert.match(js, /const recordPermission = require\('\.\.\/\.\.\/utils\/record-permission'\)/)
  assert.match(js, /startHoldArticleEdit\(event\)[\s\S]*requestAudioConsent\(\)[\s\S]*recordPermission\.ensure\(wx\)[\s\S]*beginHoldArticleEdit\(\)/)
  assert.match(js, /audioConsentVisible:\s*false/)
  assert.match(js, /requestAudioConsent\(\)\s*\{\s*return audioConsentFlow\.request\(this\)/)
  assert.doesNotMatch(js, /audioConsentFlow\.markReady/)
  assert.match(js, /onUnload\(\)\s*\{\s*audioConsentFlow\.dispose\(this\)/)
  assert.doesNotMatch(js, /selectComponent\('#audio-consent-dialog'\)/)
  assert.match(wxml, /visible="\{\{audioConsentVisible\}\}"/)
  assert.doesNotMatch(wxml, /bind:ready=/)
  assert.match(wxml, /bind:agree="onAudioConsentAgree"/)
  assert.match(wxml, /bind:decline="onAudioConsentDecline"/)
  assert.match(wxml, /bind:viewagreement="onAudioConsentViewAgreement"/)
})

test('detail page uploads selected photo inline and asks AI to insert it', async () => {
  const uploaded = []
  const enqueued = []
  const page = freshDetailPage({
    uploadPhoto: async (filePath, key) => {
      uploaded.push({ filePath, key })
      return true
    },
    fetchDoc: async () => ({ articles: [{ title: 'A', body: '正文' }] }),
    saveDoc: async (stem, doc) => {
      return doc
    }
  }, {
    chooseMedia: ({ success }) => {
      success({
        tempFiles: [{
          tempFilePath: '/tmp/original.jpg',
          createTime: new Date(2026, 5, 24, 13, 15, 30),
          size: 123,
          width: 800,
          height: 600
        }]
      })
    }
  })
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' },
      articleIndex: 0,
      photoSheetOpen: true,
      photoPickerPhotos: [],
      photoUploading: false,
      photoUploadFailed: false,
      photoScope: 'users/anon/'
    },
    setData(update, callback) {
      Object.assign(this.data, update)
      if (callback) callback()
    },
    chooseDetailPhoto: page.chooseDetailPhoto,
    uploadDetailPhotos: page.uploadDetailPhotos,
    uploadDetailPhoto: page.uploadDetailPhoto,
    makeThumbSafe: page.makeThumbSafe,
    makeUploadImage: async () => '/tmp/upload.jpg',
    makeThumb: async () => 'thumb-base64',
    ensureEditSession() {
      return {
        enqueue(text, articleIndex, images) {
          enqueued.push({ text, articleIndex, images })
        }
      }
    },
    refreshVersionNav() {
      this.data.refreshedVersionNav = true
    }
  }

  await page.chooseDetailPhoto.call(ctx, { currentTarget: { dataset: { source: 'album' } } })
  assert.equal(uploaded.length, 0)
  assert.equal(enqueued.length, 0)
  await page.uploadDetailPhotos.call(ctx)

  assert.equal(uploaded[0].filePath, '/tmp/upload.jpg')
  assert.match(uploaded[0].key, /^photos\/2026-06-24-131500\/30-[0-9a-z]+\.jpg$/)
  assert.equal(enqueued.length, 1)
  assert.match(enqueued[0].text, /\[\[photo:photos\/2026-06-24-131500\/30-[0-9a-z]+\.jpg\]\]/)
  assert.deepEqual(enqueued[0].images, [{ key: uploaded[0].key, base64: 'thumb-base64' }])
  assert.equal(ctx.data.photoSheetOpen, false)
  assert.equal(ctx.data.photoUploading, false)
  assert.equal(ctx.data.photoInsertTip, '图片已上传，AI正在插入...')
  assert.match(ctx.data.photoInsertInstruction, /\[\[photo:photos\/2026-06-24-131500\/30-[0-9a-z]+\.jpg\]\]/)
  assert.equal(ctx.data.photoInsertPromptVisible, true)
  assert.equal(page.__app.navigatedTo, undefined)
  assert.equal(page.__app.redirectedTo, undefined)
  assert.equal(page.__app.navigatedBack, undefined)
})

test('detail page uploads photos then enqueues Android-compatible insert instruction', async () => {
  const uploaded = []
  const enqueued = []
  const page = freshDetailPage({
    uploadPhoto: async (filePath, key) => {
      uploaded.push({ filePath, key })
      return true
    },
    fetchDoc: async () => {
      throw new Error('Android photo insert should not fetch and patch the article directly')
    },
    saveDoc: async () => {
      throw new Error('Android photo insert should not save marker patches directly')
    }
  })
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' },
      articleIndex: 1,
      photoPickerPhotos: [{
        path: '/tmp/original.jpg',
        createTime: new Date(2026, 5, 24, 13, 15, 42)
      }],
      photoSheetOpen: true,
      photoUploading: false,
      photoUploadFailed: false
    },
    setData(update) {
      Object.assign(this.data, update)
    },
    uploadDetailPhoto: page.uploadDetailPhoto,
    uploadDetailPhotos: page.uploadDetailPhotos,
    makeThumbSafe: page.makeThumbSafe,
    makeUploadImage: async () => '/tmp/upload.jpg',
    makeThumb: async () => 'thumb-base64',
    ensureEditSession() {
      return {
        enqueue(text, articleIndex, images) {
          enqueued.push({ text, articleIndex, images })
        }
      }
    }
  }

  await page.uploadDetailPhotos.call(ctx)

  assert.equal(uploaded[0].filePath, '/tmp/upload.jpg')
  assert.match(uploaded[0].key, /^photos\/2026-06-24-131500\/42-[0-9a-z]+\.jpg$/)
  assert.equal(enqueued.length, 1)
  assert.equal(enqueued[0].articleIndex, 1)
  assert.match(enqueued[0].text, /\[\[photo:photos\/2026-06-24-131500\/42-[0-9a-z]+\.jpg\]\]/)
  assert.deepEqual(enqueued[0].images, [{ key: uploaded[0].key, base64: 'thumb-base64' }])
  assert.equal(ctx.data.photoSheetOpen, false)
  assert.equal(ctx.data.photoUploading, false)
  assert.equal(ctx.data.photoInsertTip, '图片已上传，AI正在插入...')
  assert.match(ctx.data.photoInsertInstruction, /\[\[photo:photos\/2026-06-24-131500\/42-[0-9a-z]+\.jpg\]\]/)
  assert.equal(ctx.data.photoInsertPromptVisible, true)
})

test('detail page enqueues photo insert even when thumbnail generation fails', async () => {
  const uploaded = []
  const enqueued = []
  const page = freshDetailPage({
    uploadPhoto: async (filePath, key) => {
      uploaded.push({ filePath, key })
      return true
    }
  })
  const ctx = {
    data: {
      rec: { stem: 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon' },
      articleIndex: 0,
      photoPickerPhotos: [{
        path: '/tmp/original.jpg',
        createTime: new Date(2026, 5, 24, 13, 15, 42)
      }],
      photoSheetOpen: true,
      photoUploading: false,
      photoUploadFailed: false
    },
    setData(update) {
      Object.assign(this.data, update)
    },
    uploadDetailPhoto: page.uploadDetailPhoto,
    uploadDetailPhotos: page.uploadDetailPhotos,
    makeThumbSafe: page.makeThumbSafe,
    makeUploadImage: async () => '/tmp/upload.jpg',
    makeThumb: async () => {
      throw new Error('thumb failed')
    },
    ensureEditSession() {
      return {
        enqueue(text, articleIndex, images) {
          enqueued.push({ text, articleIndex, images })
        }
      }
    }
  }

  await page.uploadDetailPhotos.call(ctx)

  assert.equal(uploaded.length, 1)
  assert.equal(enqueued.length, 1)
  assert.match(enqueued[0].text, /\[\[photo:photos\/2026-06-24-131500\/42-[0-9a-z]+\.jpg\]\]/)
  assert.deepEqual(enqueued[0].images, [])
  assert.equal(ctx.data.photoUploading, false)
  assert.equal(ctx.data.photoInsertTip, '图片已上传，AI正在插入...')
  assert.match(ctx.data.photoInsertInstruction, /\[\[photo:photos\/2026-06-24-131500\/42-[0-9a-z]+\.jpg\]\]/)
  assert.equal(ctx.data.photoInsertPromptVisible, true)
})

test('detail page saves rendered http temp upload images before reading bytes', async () => {
  const page = freshDetailPage({}, {
    getFileSystemManager: () => ({
      saveFile: ({ tempFilePath, success }) => success({ savedFilePath: `wxfile://saved/${tempFilePath.split('/').pop()}` })
    })
  })
  const ctx = {
    renderSquareJpeg: async () => 'http://tmp/rendered-photo.jpg',
    saveReadableTempPath: page.saveReadableTempPath,
    makeUploadImage: page.makeUploadImage
  }

  const path = await page.makeUploadImage.call(ctx, 'http://tmp/source.png', 1080)

  assert.equal(path, 'wxfile://saved/rendered-photo.jpg')
})

test('detail page falls back to compressed image when rendered http temp save fails', async () => {
  const page = freshDetailPage({}, {
    getFileSystemManager: () => ({
      saveFile: ({ fail }) => fail({ errMsg: 'saveFile:fail no such file or directory' })
    }),
    compressImage: ({ success }) => success({ tempFilePath: 'wxfile://compressed-photo.jpg' })
  })
  const ctx = {
    renderSquareJpeg: async () => 'http://tmp/rendered-photo.jpg',
    saveReadableTempPath: page.saveReadableTempPath,
    makeUploadImage: page.makeUploadImage
  }

  const path = await page.makeUploadImage.call(ctx, 'http://tmp/source.png', 1080)

  assert.equal(path, 'wxfile://compressed-photo.jpg')
})

test('detail page falls back to original photo when rendered upload path is unreadable', async () => {
  const uploaded = []
  const page = freshDetailPage({
    uploadPhoto: async (filePath) => {
      uploaded.push(filePath)
      if (filePath === 'http://tmp/rendered-photo.jpg') {
        throw new Error('saveFile:fail no such file or directory http://tmp/rendered-photo.jpg')
      }
      return true
    }
  })
  const ctx = {
    uploadDetailPhoto: page.uploadDetailPhoto,
    makeUploadImage: async () => 'http://tmp/rendered-photo.jpg',
    shouldRetrySmallerUpload: page.shouldRetrySmallerUpload,
    shouldRetryOriginalPhotoUpload: page.shouldRetryOriginalPhotoUpload
  }

  const uploadedOk = await page.uploadDetailPhoto.call(ctx, 'http://tmp/source-photo.png', 'photos/a.jpg')

  assert.equal(uploadedOk, true)
  assert.deepEqual(uploaded, ['http://tmp/rendered-photo.jpg', 'http://tmp/source-photo.png'])
})
