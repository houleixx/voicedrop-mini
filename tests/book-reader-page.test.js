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
    showActionSheet(options) { calls.push(['showActionSheet', options]) },
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

test('book shelf opens the revise conversation only for an author match', () => {
  const shelf = loadShelfPage([{ slug: 'sample-book', title: '一本书', main: '主标题', editableByAuthor: true }])

  shelf.page.reviseBook({ currentTarget: { dataset: { index: 0 } } })

  const route = shelf.calls.find(([name]) => name === 'navigateTo')[1].url
  assert.match(route, /^\/pages\/book-revise\/index\?slug=sample-book&title=/)

  shelf.page.data.items[0].editableByAuthor = false
  shelf.page.reviseBook({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(shelf.calls.filter(([name]) => name === 'navigateTo').length, 1)
})

test('book shelf owns the revise entry because web-view cannot host native overlays reliably', () => {
  const readerMarkup = fs.readFileSync(path.join(__dirname, '../pages/book-reader/index.wxml'), 'utf8')
  const shelfMarkup = fs.readFileSync(path.join(__dirname, '../pages/book-shelf/index.wxml'), 'utf8')
  const recordingsMarkup = fs.readFileSync(path.join(__dirname, '../pages/recordings/index.wxml'), 'utf8')

  assert.doesNotMatch(readerMarkup, /reader-more|openActions/)
  assert.doesNotMatch(readerMarkup, /ai-generated-label/)
  assert.match(shelfMarkup, /wx:if="\{\{item\.editableByAuthor\}\}"[^>]*class="book-revise"[^>]*catchtap="reviseBook"/)
  assert.match(shelfMarkup, /class="book-revise"[^>]*>[\s\S]*?class="ri-edit-line"/)
  assert.match(recordingsMarkup, /wx:if="\{\{cell\.editableByAuthor\}\}"[^>]*class="book-revise"[^>]*catchtap="reviseBook"/)
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
  shelf.page.openBook({ currentTarget: { dataset: { index: 0 } } })
  const route = shelf.calls.find(([name]) => name === 'navigateTo')[1].url
  const query = Object.fromEntries(new URLSearchParams(route.split('?')[1]))

  const reader = loadReaderPage()
  reader.page.onLoad(query)
  const payload = reader.page.onShareAppMessage()

  assert.equal(reader.page.data.title, '主标题')
  assert.equal(payload.title, '《主标题：完整副标题》 — 作者')
  assert.equal(payload.imageUrl, 'https://voicedrop.cn/books/sample-book/cover.jpg')
})
