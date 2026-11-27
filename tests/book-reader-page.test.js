const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function loadReaderPage() {
  const calls = []
  let definition
  global.wx = {
    showLoading(options) { calls.push(['showLoading', options]) },
    hideLoading() { calls.push(['hideLoading']) },
    showToast(options) { calls.push(['showToast', options]) },
    showShareMenu(options) { calls.push(['showShareMenu', options]) },
    navigateTo(options) { calls.push(['navigateTo', options]) }
  }
  global.Page = (value) => { definition = value }
  const modulePath = require.resolve('../pages/book-reader/index.js')
  delete require.cache[modulePath]
  require(modulePath)
  delete global.Page
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch) }
  }
  return { page, calls }
}

function loadShelfPage(items) {
  const calls = []
  let definition
  global.wx = {
    getStorageSync() { return { books: items } },
    setStorageSync() {},
    navigateTo(options) { calls.push(['navigateTo', options]) }
  }
  global.Page = (value) => { definition = value }
  const modulePath = require.resolve('../pages/book-shelf/index.js')
  delete require.cache[modulePath]
  require(modulePath)
  delete global.Page
  const page = {
    ...definition,
    data: { ...definition.data, items },
    setData(patch) { Object.assign(this.data, patch) }
  }
  return { page, calls }
}

test('book reader lets the native web-view viewport settle before showing its centered loading overlay', async () => {
  const { page, calls } = loadReaderPage()
  page.onLoad({ slug: 'sample-book' })
  assert.equal(calls.some(([name]) => name === 'showLoading'), false)
  assert.equal(page.data.url, 'https://voicedrop.cn/books/sample-book/')
  assert.equal(page.data.loading, false)

  page.onReady()
  assert.equal(calls.some(([name]) => name === 'showLoading'), false)
  assert.equal(page.data.loading, false)

  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(page.data.loading, true)

  page.onWebLoad()
  assert.equal(page.data.loading, false)
})

test('book reader does not reopen loading when the web-view finishes before page ready', async () => {
  const { page } = loadReaderPage()
  page.onLoad({ slug: 'sample-book' })

  page.onWebLoad()
  page.onReady()
  await new Promise((resolve) => setTimeout(resolve, 120))

  assert.equal(page.data.loading, false)
})

test('book reader loading matches the system dark toast treatment', () => {
  const css = fs.readFileSync(path.join(__dirname, '../pages/book-reader/index.wxss'), 'utf8')
  assert.match(css, /\.reader-loading\s*\{[^}]*background:\s*#fcf6eb;/s)
  assert.match(css, /\.reader-loading-card\s*\{[^}]*position:\s*fixed;[^}]*top:\s*42%;[^}]*left:\s*50%;[^}]*width:\s*220rpx;[^}]*height:\s*220rpx;[^}]*transform:\s*translate\(-50%, -50%\);[^}]*flex-direction:\s*column;[^}]*background:\s*rgba\(0, 0, 0, 0\.68\);/s)
  assert.match(css, /\.reader-loading-spinner\s*\{[^}]*border-top-color:\s*#ffffff;/s)
  assert.match(css, /\.reader-loading-copy\s*\{[^}]*color:\s*#ffffff;[^}]*font-weight:\s*400;/s)
})

test('book reader alone matches its warm web background without changing the app theme', () => {
  const pageConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../pages/book-reader/index.json'), 'utf8'))
  const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'))

  assert.equal(pageConfig.navigationBarBackgroundColor, '#fcf6eb')
  assert.equal(pageConfig.backgroundColor, '#fcf6eb')
  assert.equal(appConfig.window.navigationBarBackgroundColor, '#faf6ef')
})

test('book reader exposes native WeChat sharing with author and cover', () => {
  const { page, calls } = loadReaderPage()
  page.onLoad({ slug: 'sample-book', title: encodeURIComponent('一本书'), author: encodeURIComponent('作者'), cover: '1' })
  const payload = page.onShareAppMessage()
  assert.equal(payload.title, '《一本书》 — 作者')
  assert.equal(payload.imageUrl, 'https://voicedrop.cn/books/sample-book/cover.jpg')
  assert.match(payload.path, /pages\/book-reader\/index\?slug=sample-book/)
  assert.deepEqual(calls.find(([name]) => name === 'showShareMenu')[1].menus,
    ['shareAppMessage', 'shareTimeline'])
})

test('book reader shares the current in-book chapter and versioned cover', () => {
  const { page } = loadReaderPage()
  page.onLoad({ slug: 'sample-book', title: encodeURIComponent('一本书'), author: encodeURIComponent('作者'), cover: '1', coverAt: '456' })
  page.onWebLoad({ detail: { src: 'https://voicedrop.cn/books/sample-book/chapter-2.html' } })

  const payload = page.onShareAppMessage()

  assert.match(payload.path, /page=https%3A%2F%2Fvoicedrop\.cn%2Fbooks%2Fsample-book%2Fchapter-2\.html/)
  assert.equal(payload.imageUrl, 'https://voicedrop.cn/books/sample-book/cover.jpg?v=456')
})

test('book reader owns revise and hide actions after server ownership verification', () => {
  const readerMarkup = fs.readFileSync(path.join(__dirname, '../pages/book-reader/index.wxml'), 'utf8')
  const shelfMarkup = fs.readFileSync(path.join(__dirname, '../pages/book-shelf/index.wxml'), 'utf8')
  const recordingsMarkup = fs.readFileSync(path.join(__dirname, '../pages/recordings/index.wxml'), 'utf8')
  const readerCss = fs.readFileSync(path.join(__dirname, '../pages/book-reader/index.wxss'), 'utf8')

  assert.match(readerMarkup, /<view class="reader-actions"[^>]*bindtap="openActions"/)
  assert.match(readerMarkup, /class="reader-actions"[^>]*bindtap="openActions"[^>]*>⋯<\/view>/)
  assert.match(readerMarkup, /wx:if="\{\{!url && moreMenuOpen\}\}" class="reader-offline-menu"/)
  assert.match(readerMarkup, /data-action="revise" bindtap="runMoreMenuAction">修改这本书/)
  assert.match(readerMarkup, /<view[^>]*class="reader-menu-separator"><\/view>/)
  assert.match(readerMarkup, /data-action="visibility" bindtap="runMoreMenuAction">\{\{hidden \? '取消隐藏本书' : '隐藏本书'\}\}/)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../pages/book-reader/index.js'), 'utf8'), /showActionSheet/)
  assert.match(readerCss, /\.reader-actions, \.reader-web-actions\s*\{[^}]*width: 64rpx;[^}]*border-radius: 32rpx;[^}]*background: rgba\(42, 37, 33, 0\.72\);[^}]*color: #fff;/s)
  assert.match(readerCss, /\.reader-menu-card\s*\{[^}]*width:\s*360rpx;/s)
  assert.match(readerCss, /\.reader-menu-separator\s*\{[^}]*height:\s*1rpx;[^}]*margin:\s*0 30rpx;/s)
  assert.doesNotMatch(shelfMarkup, /editableByAuthor|reviseBook/)
  assert.doesNotMatch(recordingsMarkup, /editableByAuthor|reviseBook/)
  assert.match(shelfMarkup, /wx:if="\{\{item\.hidden\}\}"[^>]*class="book-hidden-badge">\{\{i18n\["隐藏"\]\}\}<\/text>/)
  assert.match(recordingsMarkup, /wx:if="\{\{cell\.hidden\}\}"[^>]*class="book-hidden-badge">\{\{i18n\["隐藏"\]\}\}<\/text>/)
})

test('opening a shelf book preserves its full title for WeChat sharing', () => {
  const book = {
    slug: 'sample-book',
    title: '主标题：完整副标题',
    main: '主标题',
    author: '作者',
    cover: true
  }
  const shelf = loadShelfPage([book])
  shelf.page.openBook({ currentTarget: { dataset: { slug: 'sample-book' } } })
  const route = shelf.calls.find(([name]) => name === 'navigateTo')[1].url
  const query = Object.fromEntries(new URLSearchParams(route.split('?')[1]))

  const reader = loadReaderPage()
  reader.page.onLoad(query)
  const payload = reader.page.onShareAppMessage()

  assert.equal(reader.page.data.title, '主标题')
  assert.equal(payload.title, '《主标题：完整副标题》 — 作者')
  assert.equal(payload.imageUrl, 'https://voicedrop.cn/books/sample-book/cover.jpg')
})


test('reader keeps loading until the web-view reports completion, even beyond eight seconds', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { page } = loadReaderPage()
  page.onLoad({ slug: 'sample-book' })
  page.onReady()
  t.mock.timers.tick(100)
  assert.equal(page.data.loading, true)
  t.mock.timers.tick(60000)
  assert.equal(page.data.loading, true)
  // Keep the native web-view mounted so a slow book can still finish loading.
  assert.equal(page.data.url, 'https://voicedrop.cn/books/sample-book/')
  page.onWebLoad()
  assert.equal(page.data.loading, false)
  page.onUnload()
})

test('reader cancels pending loading updates when leaving before web load', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { page } = loadReaderPage()
  page.onLoad({ slug: 'sample-book' })
  page.onReady()
  t.mock.timers.tick(100)
  assert.equal(page.data.loading, true)
  page.onUnload()
  let updates = 0
  page.setData = () => { updates += 1 }
  t.mock.timers.tick(10000)
  assert.equal(updates, 0)
})

test('both shelf lists open the reader without an inline download button', () => {
  const { page, calls } = loadShelfPage([{ slug: 'sample-book', title: '一本书', main: '一本书' }])
  page.openBook({ currentTarget: { dataset: { slug: 'sample-book' } } })
  assert.match(calls[0][1].url, /&details=1$/)
  for (const source of ['book-shelf', 'recordings']) {
    const markup = fs.readFileSync(path.join(__dirname, `../pages/${source}/index.wxml`), 'utf8')
    assert.doesNotMatch(markup, /book-offline-action|data-download=/)
  }
})

test('the reader menu offers first download, re-download, and access to the local copy', (t) => {
  const offline = require('../services/book-offline')
  const originalGet = offline.get
  t.after(() => { offline.get = originalGet })
  for (const existing of [null, { root: 'local-book' }]) {
    offline.get = () => existing
    const { page } = loadReaderPage()
    let starts = 0
    let localReads = 0
    page.openOffline = () => { localReads++ }
    page.downloadOffline = () => { starts++ }
    page.onLoad({ slug: 'sample-book', details: '1', online: '1' })
    assert.equal(page.data.offlineAvailable, Boolean(existing))
    assert.equal(page.data.offline, false)
    assert.equal(page.data.url, 'https://voicedrop.cn/books/sample-book/')
    page.openActions()
    page.runMoreMenuAction({ currentTarget: { dataset: { action: 'offline-download' } } })
    assert.equal(starts, 1)
    assert.equal(page.data.moreMenuOpen, false)
    assert.equal(localReads, 0)
    if (existing) {
      page.openActions()
      page.runMoreMenuAction({ currentTarget: { dataset: { action: 'offline-toggle' } } })
      assert.equal(localReads, 1)
    }
  }
  const markup = fs.readFileSync(path.join(__dirname, '../pages/book-reader/index.wxml'), 'utf8')
  assert.match(markup, /data-action="offline-download"[^>]*>.*offlineAvailable \? '重新下载' : '下载到本地'/)
})

test('opening a book from the shelf opens original WebView when the book is not downloaded', () => {
  const { page, calls } = loadReaderPage()
  page.onLoad({ slug: 'sample-book', details: '1' })
  assert.equal(page.data.url, 'https://voicedrop.cn/books/sample-book/')
  page.openActions()
  assert.equal(page.data.moreMenuOpen, true)
  assert.equal(calls.some(([name]) => name === 'navigateTo'), false)
})

test('offline chapter preview retains its layout with native title, directory and navigation', () => {
  const markup = fs.readFileSync(path.join(__dirname, '../pages/book-reader/index.wxml'), 'utf8')
  assert.match(markup, /offline\}\}"[^>]*class="offline-reader"/)
  assert.match(markup, /class="offline-book-title">\{\{chapters\[chapterIndex\]\.title\}\}/)
  assert.match(markup, /data-index="0" bindtap="openChapter">目录/)
  const { page } = loadReaderPage()
  page.data.offline = true
  const opened = []
  page.showOfflineChapter = (index) => opened.push(index)
  page.openChapter({ currentTarget: { dataset: { index: '2' } } })
  assert.deepEqual(opened, [2])
})

test('download updates both reader progress variants and hides the bar on completion', async (t) => {
  const offline = require('../services/book-offline')
  const originalDownload = offline.download
  t.after(() => { offline.download = originalDownload })
  const { page } = loadReaderPage()
  page.onLoad({ slug: 'sample-book' })
  let finish
  let report
  offline.download = (_slug, _root, progress) => {
    report = progress
    return new Promise((resolve) => { finish = resolve })
  }
  const pending = page.downloadOffline()
  assert.equal(page.data.offlineProgress, 0)
  report(46)
  assert.equal(page.data.offlineProgress, 46)
  finish({ missingAudio: 0 })
  await pending
  assert.equal(page.data.offlineProgress, -1)
  const markup = fs.readFileSync(path.join(__dirname, '../pages/book-reader/index.wxml'), 'utf8')
  assert.match(markup, /url && offlineProgress >= 0[^>]*class="reader-web-progress"/)
  assert.match(markup, /class="reader-progress-slot"[\s\S]*offlineProgress >= 0[^>]*class="reader-progress-track"/)
  assert.doesNotMatch(markup, /reader-web-progress-title/)
  assert.match(markup, /class="reader-title-bar"[\s\S]*<page-header[^>]*in-flow[\s\S]*class="reader-progress-slot"/)
  assert.equal((markup.match(/width: \{\{offlineProgress\}\}%/g) || []).length, 2)
})

test('web download progress is spans the full available edge below the native title bar', () => {
  const css = fs.readFileSync(path.join(__dirname, '../pages/book-reader/index.wxss'), 'utf8')
  assert.match(css, /\.reader-web-progress\s*\{[^}]*position: fixed;[^}]*top: 0;[^}]*left: 0;[^}]*right: 0;/)
})

test('offline reader keeps its header and action attached to the top while scrolling', () => {
  const css = fs.readFileSync(path.join(__dirname, '../pages/book-reader/index.wxss'), 'utf8')
  const markup = fs.readFileSync(path.join(__dirname, '../pages/book-reader/index.wxml'), 'utf8')
  assert.match(css, /\.offline-reader\s*\{[^}]*position: fixed;[^}]*inset: 0;/)
  assert.match(markup, /class="reader-title-bar"[\s\S]*<scroll-view class="reader-offline-scroll" scroll-y enhanced/)
  assert.match(markup, /scroll-into-view="\{\{chapterScrollTarget\}\}"/)
  assert.match(css, /\.reader-actions\s*\{[^}]*position: absolute;[^}]*top: calc\(100% - 19rpx\);[^}]*right: 20rpx;/)
})

test('reopening a downloading book shows the active progress and keeps receiving updates', (t) => {
  const offline = require('../services/book-offline')
  const original = { get: offline.get, downloadProgress: offline.downloadProgress, subscribeDownloads: offline.subscribeDownloads }
  t.after(() => Object.assign(offline, original))
  let local = null
  let listener
  let unsubscribed = false
  offline.get = () => local
  offline.downloadProgress = () => 36
  offline.subscribeDownloads = (callback) => {
    listener = callback
    return () => { unsubscribed = true }
  }
  const { page } = loadReaderPage()
  page.onLoad({ slug: 'sample-book' })
  assert.equal(page.data.offlineProgress, 36)
  listener('other-book', 50)
  assert.equal(page.data.offlineProgress, 36)
  listener('sample-book', 67)
  assert.equal(page.data.offlineProgress, 67)
  local = { root: 'local-book' }
  listener('sample-book', -1)
  assert.equal(page.data.offlineProgress, -1)
  assert.equal(page.data.offlineAvailable, true)
  page.onUnload()
  assert.equal(unsubscribed, true)
})

test('the shelf reader mounts the WebView only once the destination is ready', () => {
  const { page } = loadReaderPage()
  const markup = fs.readFileSync(path.join(__dirname, '../pages/book-reader/index.wxml'), 'utf8')
  page.onLoad({ slug: 'sample-book' })
  assert.equal(page.data.readerReady, false)
  assert.match(markup, /<web-view wx:if="\{\{readerReady && url\}\}"/)
  page.onReady()
  assert.equal(page.data.readerReady, true)
  page.onUnload()
})

test('offline reader shows its shell before reading the first page', async (t) => {
  const offline = require('../services/book-offline')
  const original = { get: offline.get, loadLocalPage: offline.loadLocalPage }
  t.after(() => Object.assign(offline, original))
  offline.get = () => ({ files: ['index.html'], audio: [] })
  let finish
  offline.loadLocalPage = () => new Promise((resolve) => { finish = resolve })
  const { page } = loadReaderPage()
  page.onLoad({ slug: 'sample-book', title: 'Sample' })
  assert.equal(page.data.title, 'Sample')
  assert.equal(page.data.url, '')
  assert.equal(page.data.offline, true)
  assert.equal(page.data.chapterLoading, true)
  assert.equal(finish, undefined)
  const ready = page.onReady()
  assert.equal(page.data.chapterLoading, true)
  finish({ blocks: [{ type: 'paragraph', text: 'Local page' }] })
  await ready
  assert.equal(page.data.chapterLoading, false)
  assert.equal(page.data.blocks[0].text, 'Local page')
  page.onUnload()
})
