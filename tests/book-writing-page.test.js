const test = require('node:test')
const assert = require('node:assert/strict')

function loadWritingPage(start) {
  const events = []
  let definition
  global.wx = {
    showLoading(options) { events.push(['showLoading', options]) },
    hideLoading() { events.push(['hideLoading']) }
  }
  const booksPath = require.resolve('../services/books')
  const pagePath = require.resolve('../pages/book-writing/index.js')
  const originalBooks = require.cache[booksPath]
  require.cache[booksPath] = { exports: {
    BOOK_SUANLI: 320,
    start,
    result(response) { return { accepted: Boolean(response && response.statusCode === 202), message: '开始写了' } },
    formatBalance(value) { return String(value) },
    shortfall() { return 0 }
  } }
  global.Page = (value) => { definition = value }
  delete require.cache[pagePath]
  require(pagePath)
  delete global.Page
  delete require.cache[pagePath]
  if (originalBooks) require.cache[booksPath] = originalBooks
  else delete require.cache[booksPath]
  const page = {
    ...definition,
    data: { ...definition.data, seed: '一本书的种子', balance: 320 },
    setData(patch) {
      Object.assign(this.data, patch)
      if (patch.submitted) events.push(['submitted'])
    }
  }
  return { page, events }
}

test('book submission uses the system loading and hides it before success state', async () => {
  const { page, events } = loadWritingPage(async () => ({ statusCode: 202 }))
  await page.start()
  assert.deepEqual(events[0], ['showLoading', { title: '提交中…', mask: true }])
  assert.equal(events.filter(([name]) => name === 'hideLoading').length, 1)
  assert.ok(events.findIndex(([name]) => name === 'hideLoading') < events.findIndex(([name]) => name === 'submitted'))
  assert.equal(page.data.submitted, true)
})

test('book submission also hides loading when the request fails', async () => {
  const { page, events } = loadWritingPage(async () => { throw new Error('offline') })
  await page.start()
  assert.equal(events.filter(([name]) => name === 'showLoading').length, 1)
  assert.equal(events.filter(([name]) => name === 'hideLoading').length, 1)
  assert.equal(page.data.submitted, false)
})
