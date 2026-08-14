const test = require('node:test')
const assert = require('node:assert/strict')

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function loadShelfPage(shelf, cachedShelf = () => [{ slug: 'cached' }]) {
  let definition
  const booksPath = require.resolve('../services/books')
  const pagePath = require.resolve('../pages/book-shelf/index.js')
  const originalBooks = require.cache[booksPath]
  require.cache[booksPath] = { exports: { cachedShelf, shelf } }
  global.Page = (page) => { definition = page }
  delete require.cache[pagePath]
  require(pagePath)
  delete global.Page
  delete require.cache[pagePath]
  if (originalBooks) require.cache[booksPath] = originalBooks
  else delete require.cache[booksPath]

  const context = {
    ...definition,
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch) }
  }
  return { definition, context }
}

test('pull-to-refresh bypasses caches and waits for its own request', async () => {
  const request = deferred()
  const calls = []
  const { definition, context } = loadShelfPage((options) => {
    calls.push(options)
    return request.promise
  })

  const refreshing = definition.refresh.call(context)

  assert.equal(context.data.refreshing, true)
  assert.deepEqual(calls, [{ forceRefresh: true }])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(context.data.refreshing, true)

  request.resolve([{ slug: 'fresh' }])
  await refreshing
  assert.equal(context.data.refreshing, false)
  assert.equal(context.data.items[0].slug, 'fresh')
})

test('an older automatic load cannot end or overwrite a newer refresh', async () => {
  const initial = deferred()
  const refresh = deferred()
  let call = 0
  const { definition, context } = loadShelfPage(() => (++call === 1 ? initial.promise : refresh.promise))

  definition.onLoad.call(context)
  const refreshing = definition.refresh.call(context)
  initial.resolve([{ slug: 'stale' }])
  await initial.promise
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(context.data.refreshing, true)
  assert.notEqual(context.data.items[0].slug, 'stale')

  refresh.resolve([{ slug: 'fresh' }])
  await refreshing
  assert.equal(context.data.refreshing, false)
  assert.equal(context.data.items[0].slug, 'fresh')
})

test('forced shelf requests use a unique URL and no-cache header', async () => {
  let request
  const originalWx = global.wx
  global.wx = { setStorageSync() {} }
  const requestPath = require.resolve('../services/request')
  const booksPath = require.resolve('../services/books')
  const originalRequest = require.cache[requestPath]
  require.cache[requestPath] = { exports: {
    get: async (url, token, options) => {
      request = { url, token, options }
      return { statusCode: 200, data: { books: [] } }
    }
  } }
  delete require.cache[booksPath]
  const books = require(booksPath)

  await books.shelf({ forceRefresh: true, now: 123456 })

  assert.match(request.url, /[?&]_refresh=123456(?:&|$)/)
  assert.equal(request.options.header['Cache-Control'], 'no-cache')

  delete require.cache[booksPath]
  if (originalRequest) require.cache[requestPath] = originalRequest
  else delete require.cache[requestPath]
  if (originalWx) global.wx = originalWx
  else delete global.wx
})

test('GET forwards caller cache-control options to wx.request', async () => {
  let captured
  const originalWx = global.wx
  global.wx = {
    request(options) {
      captured = options
      options.success({ statusCode: 200, data: {} })
    }
  }
  const requestPath = require.resolve('../services/request')
  delete require.cache[requestPath]
  const http = require(requestPath)

  await http.get('https://example.test/books', '', { header: { 'Cache-Control': 'no-cache' } })

  assert.equal(captured.header['Cache-Control'], 'no-cache')
  assert.equal(captured.header['X-VD-Platform'], 'miniapp')
  delete require.cache[requestPath]
  if (originalWx) global.wx = originalWx
  else delete global.wx
})

test('a fast second refresh remains visible for a minimum feedback window', async () => {
  const timers = []
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (callback, delay) => {
    timers.push({ callback, delay })
    return timers.length
  }
  try {
    const { definition, context } = loadShelfPage(async () => [{ slug: 'fresh' }])

    const first = definition.refresh.call(context)
    await new Promise((resolve) => queueMicrotask(resolve))
    assert.equal(context.data.refreshing, true)
    assert.ok(timers[0].delay >= 500)
    timers[0].callback()
    await first
    assert.equal(context.data.refreshing, false)

    const second = definition.refresh.call(context)
    await new Promise((resolve) => queueMicrotask(resolve))
    assert.equal(context.data.refreshing, true)
    assert.ok(timers[1].delay >= 500)
    timers[1].callback()
    await second
    assert.equal(context.data.refreshing, false)
  } finally {
    global.setTimeout = originalSetTimeout
  }
})
