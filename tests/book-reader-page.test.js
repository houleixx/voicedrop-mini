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
    showShareMenu(options) { calls.push(['showShareMenu', options]) }
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

test('book reader shows page-local loading only after opening and clears it on web load', () => {
  const { page, calls } = loadReaderPage()
  page.onLoad({ slug: 'sample-book' })
  assert.equal(calls.some(([name]) => name === 'showLoading'), false)

  page.onReady()
  assert.equal(calls.some(([name]) => name === 'showLoading'), false)
  assert.equal(page.data.loading, true)
  assert.equal(page.data.url, 'https://voicedrop.cn/books/sample-book/')

  page.onWebLoad()
  assert.equal(page.data.loading, false)
})

test('book reader loading matches the system dark toast treatment', () => {
  const css = fs.readFileSync(path.join(__dirname, '../pages/book-reader/index.wxss'), 'utf8')
  assert.match(css, /\.reader-loading-card\s*\{[^}]*width:\s*220rpx;[^}]*height:\s*220rpx;[^}]*flex-direction:\s*column;[^}]*background:\s*rgba\(0, 0, 0, 0\.68\);/s)
  assert.match(css, /\.reader-loading-spinner\s*\{[^}]*border-top-color:\s*#ffffff;/s)
  assert.match(css, /\.reader-loading-copy\s*\{[^}]*color:\s*#ffffff;[^}]*font-weight:\s*400;/s)
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
