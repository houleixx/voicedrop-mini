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
    showToast(options) { calls.push(['showToast', options]) }
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
