const test = require('node:test')
const assert = require('node:assert/strict')

const routePath = require.resolve('../services/api-route')
const apiPath = require.resolve('../services/api')
const booksPath = require.resolve('../services/books')
const appPath = require.resolve('../app')

function withRouteMock(mock, callback) {
  const original = require.cache[routePath]
  require.cache[routePath] = { exports: mock }
  try { return callback() } finally {
    delete require.cache[apiPath]
    delete require.cache[booksPath]
    delete require.cache[appPath]
    if (original) require.cache[routePath] = original
    else delete require.cache[routePath]
  }
}

test('HTTP and original-photo URLs follow the selected host while WS, thumbnails, and shares stay fixed', () => {
  let host = 'jianshuo.dev'
  withRouteMock({
    CN_HOST: 'voicedrop.cn', CF_HOST: 'jianshuo.dev',
    currentHost: () => host,
    publicWebBase: () => 'https://jianshuo.dev/voicedrop'
  }, () => {
    const api = require(apiPath)
    assert.equal(api.HOST, 'jianshuo.dev')
    assert.equal(api.PHOTO_HOST, 'jianshuo.dev')
    assert.equal(api.filesBase(), 'https://jianshuo.dev/files/api')
    assert.equal(api.photoBase(), 'https://jianshuo.dev/files/api')
    assert.equal(api.photoUrl('photos/a b.jpg'), 'https://jianshuo.dev/files/api/photo/photos/a%20b.jpg')
    assert.equal(api.agentBase(), 'https://jianshuo.dev/agent')
    assert.equal(api.recoBase(), 'https://jianshuo.dev/reco')
    assert.equal(api.agentWs(), 'wss://jianshuo.dev/agent')
    assert.equal(api.photoThumbnailUrl('photos/a b.jpg'),
      'https://jianshuo.dev/cdn-cgi/image/width=512,quality=60/files/api/photo/photos/a%20b.jpg')
    assert.equal(api.sharePage('abc123'), 'https://voicedrop.cn/abc123')
    host = 'voicedrop.cn'
    assert.equal(api.HOST, 'voicedrop.cn')
    assert.equal(api.PHOTO_HOST, 'voicedrop.cn')
  })
})

test('book web-views stay on voicedrop.cn while data and covers follow publicWebBase', () => {
  const originalWx = global.wx
  global.wx = { getStorageSync() {}, setStorageSync() {} }
  try {
    withRouteMock({
      publicWebBase: () => 'https://jianshuo.dev/voicedrop'
    }, () => {
      const books = require(booksPath)
      const book = { slug: 'hello world', coverAt: 456 }
      assert.equal(books.shelfWebUrl(), 'https://voicedrop.cn/books/')
      assert.equal(books.indexUrl(), 'https://jianshuo.dev/voicedrop/books/?format=json')
      assert.equal(books.readerUrl(book), 'https://voicedrop.cn/books/hello%20world/')
      assert.equal(books.coverUrl(book),
        'https://jianshuo.dev/voicedrop/books/hello%20world/cover.jpg?v=456')
      assert.equal(books.readerPageUrl(book,
        'https://jianshuo.dev/voicedrop/books/hello%20world/chapter-2.html'),
      'https://voicedrop.cn/books/hello%20world/chapter-2.html')
      assert.equal(books.API, 'https://lab.jianshuo.dev/api/book')
      assert.equal(books.REVISE_API, 'https://lab.jianshuo.dev/api/book/revise')
    })
  } finally {
    if (originalWx) global.wx = originalWx
    else delete global.wx
  }
})

test('books re-route stale covers but keep trusted chapter web-views on voicedrop.cn', () => {
  let base = 'https://voicedrop.cn'
  withRouteMock({ publicWebBase: () => base }, () => {
    const books = require(booksPath)
    const book = books.normalizeIndex({ books: [
      { slug: 'route-book', cover: true, coverAt: 456 }
    ] })[0]
    assert.equal(book.coverUrl, 'https://voicedrop.cn/books/route-book/cover.jpg?v=456')

    base = 'https://jianshuo.dev/voicedrop'
    const refreshed = books.refreshCoverUrls([book])[0]
    assert.equal(refreshed.coverUrl,
      'https://jianshuo.dev/voicedrop/books/route-book/cover.jpg?v=456')
    assert.equal(book.coverUrl, 'https://voicedrop.cn/books/route-book/cover.jpg?v=456')
    assert.equal(books.readerPageUrl(book,
      'https://voicedrop.cn/books/route-book/chapter-2.html?from=share#note'),
    'https://voicedrop.cn/books/route-book/chapter-2.html?from=share#note')
    assert.equal(books.readerPageUrl(book,
      'https://jianshuo.dev/voicedrop/books/other/chapter-2.html'),
    'https://voicedrop.cn/books/route-book/')
    for (const unsafe of [
      'https://voicedrop.cn/books/route-book/../admin/',
      'https://voicedrop.cn/books/route-book/%2e%2e/admin/',
      'https://voicedrop.cn/books/route-book/%252e%252e%252fadmin/'
    ]) {
      assert.equal(books.readerPageUrl(book, unsafe),
        'https://voicedrop.cn/books/route-book/')
    }
  })
})

test('app probes on every cold launch and uses the throttled probe on foreground show', () => {
  const calls = []
  const originalApp = global.App
  const originalWx = global.wx
  let definition
  global.App = (value) => { definition = value }
  global.wx = { showShareMenu() {} }
  try {
    withRouteMock({
      probe() { calls.push('probe'); return Promise.resolve() },
      probeIfDue() { calls.push('probeIfDue'); return Promise.resolve() }
    }, () => require(appPath))
    definition.onLaunch({})
    definition.onShow({})
    assert.deepEqual(calls, ['probe', 'probeIfDue'])
  } finally {
    if (originalApp) global.App = originalApp
    else delete global.App
    if (originalWx) global.wx = originalWx
    else delete global.wx
  }
})

test('web-view allows only the exact cn and cf public manual or shelf roots', () => {
  const originalPage = global.Page
  const originalWx = global.wx
  let definition
  const toasts = []
  global.Page = (value) => { definition = value }
  global.wx = { showToast(value) { toasts.push(value) }, setNavigationBarTitle() {} }
  const pagePath = require.resolve('../pages/web/index')
  delete require.cache[pagePath]
  require(pagePath)
  try {
    for (const url of [
      'https://voicedrop.cn/books/',
      'https://jianshuo.dev/voicedrop/books/',
      'https://voicedrop.cn/help/manual/',
      'https://jianshuo.dev/voicedrop/help/manual/'
    ]) {
      const page = { data: {}, setData(value) { Object.assign(this.data, value) } }
      definition.onLoad.call(page, { url: encodeURIComponent(url) })
      assert.equal(page.data.url, url)
    }
    const page = { data: {}, setData(value) { Object.assign(this.data, value) } }
    definition.onLoad.call(page, { url: encodeURIComponent('https://jianshuo.dev/voicedrop/admin/') })
    assert.equal(page.data.url, undefined)
    assert.equal(toasts.at(-1).title, '无法打开这个地址')
  } finally {
    delete require.cache[pagePath]
    if (originalPage) global.Page = originalPage
    else delete global.Page
    if (originalWx) global.wx = originalWx
    else delete global.wx
  }
})
