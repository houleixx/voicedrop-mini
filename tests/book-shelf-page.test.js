const test = require('node:test')
const assert = require('node:assert/strict')

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function loadShelfPage(shelf, cachedShelf = () => [{ slug: 'cached' }], cacheIdentity = () => 'test-account') {
  let definition
  const booksPath = require.resolve('../services/books')
  const settingsPath = require.resolve('../services/settings')
  const pagePath = require.resolve('../pages/book-shelf/index.js')
  const originalBooks = require.cache[booksPath]
  const originalSettings = require.cache[settingsPath]
  const realBooks = require('../services/books')
  const { markEditableByAuthor, refreshCoverUrls } = realBooks
  require.cache[booksPath] = { exports: { cachedShelf, shelf, cacheIdentity, markEditableByAuthor, refreshCoverUrls } }
  require.cache[settingsPath] = { exports: { loadStyle: async () => ({ name: '' }) } }
  global.Page = (page) => { definition = page }
  delete require.cache[pagePath]
  require(pagePath)
  delete global.Page
  delete require.cache[pagePath]
  if (originalBooks) require.cache[booksPath] = originalBooks
  else delete require.cache[booksPath]
  if (originalSettings) require.cache[settingsPath] = originalSettings
  else delete require.cache[settingsPath]

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
  const authPath = require.resolve('../services/auth')
  const booksPath = require.resolve('../services/books')
  const originalRequest = require.cache[requestPath]
  const originalAuth = require.cache[authPath]
  require.cache[requestPath] = { exports: {
    get: async (url, token, options) => {
      request = { url, token, options }
      return { statusCode: 200, data: { books: [] } }
    }
  } }
  require.cache[authPath] = { exports: {
    bearer: () => 'test-token',
    libraryCacheIdentity: () => 'users/test-account/'
  } }
  delete require.cache[booksPath]
  const books = require(booksPath)

  await books.shelf({ forceRefresh: true, now: 123456 })

  assert.match(request.url, /[?&]_refresh=123456(?:&|$)/)
  assert.equal(request.token, 'test-token')
  assert.equal(request.options.header['Cache-Control'], 'no-cache')

  delete require.cache[booksPath]
  if (originalRequest) require.cache[requestPath] = originalRequest
  else delete require.cache[requestPath]
  if (originalAuth) require.cache[authPath] = originalAuth
  else delete require.cache[authPath]
  if (originalWx) global.wx = originalWx
  else delete global.wx
})

test('book shelf keeps hidden metadata and isolates cached responses by hashed account identity', async () => {
  const originalWx = global.wx
  const storage = new Map()
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) }
  }
  const requestPath = require.resolve('../services/request')
  const authPath = require.resolve('../services/auth')
  const booksPath = require.resolve('../services/books')
  const originalRequest = require.cache[requestPath]
  const originalAuth = require.cache[authPath]
  let identity = 'users/owner-a/'
  let token = 'private-token-a'
  require.cache[authPath] = { exports: {
    bearer: () => token,
    libraryCacheIdentity: () => identity
  } }
  require.cache[requestPath] = { exports: {
    get: async (_url, bearer) => ({
      statusCode: 200,
      data: { books: bearer === 'private-token-a'
        ? [{ slug: 'hidden-a', hidden: true }]
        : [{ slug: 'public-b' }] }
    })
  } }
  delete require.cache[booksPath]
  const books = require(booksPath)

  const ownerBooks = await books.shelf()
  assert.equal(ownerBooks[0].hidden, true)
  assert.deepEqual(books.cachedShelf().map((book) => book.slug), ['hidden-a'])

  identity = 'users/owner-b/'
  token = 'private-token-b'
  assert.deepEqual(books.cachedShelf(), [])
  await books.shelf()
  assert.deepEqual(books.cachedShelf().map((book) => book.slug), ['public-b'])

  identity = 'users/owner-a/'
  token = 'private-token-a'
  assert.deepEqual(books.cachedShelf().map((book) => book.slug), ['hidden-a'])
  for (const key of storage.keys()) {
    assert.match(key, /^voicedrop\.books\.shelf\.v1\.[0-9a-f]{8}$/)
    assert.doesNotMatch(key, /private-token|owner-a|owner-b/)
  }

  delete require.cache[booksPath]
  if (originalRequest) require.cache[requestPath] = originalRequest
  else delete require.cache[requestPath]
  if (originalAuth) require.cache[authPath] = originalAuth
  else delete require.cache[authPath]
  if (originalWx) global.wx = originalWx
  else delete global.wx
})

test('a shelf response is discarded if the account changes while it is in flight', async () => {
  const originalWx = global.wx
  const writes = []
  global.wx = { setStorageSync(key, value) { writes.push({ key, value }) } }
  const requestPath = require.resolve('../services/request')
  const authPath = require.resolve('../services/auth')
  const booksPath = require.resolve('../services/books')
  const originalRequest = require.cache[requestPath]
  const originalAuth = require.cache[authPath]
  const pending = deferred()
  let identity = 'users/owner-a/'
  require.cache[authPath] = { exports: {
    bearer: () => 'token-a',
    libraryCacheIdentity: () => identity
  } }
  require.cache[requestPath] = { exports: { get: () => pending.promise } }
  delete require.cache[booksPath]
  const books = require(booksPath)

  const loading = books.shelf()
  identity = 'users/owner-b/'
  pending.resolve({ statusCode: 200, data: { books: [{ slug: 'hidden-a', hidden: true }] } })
  await assert.rejects(loading, /account changed/)
  assert.deepEqual(writes, [])

  delete require.cache[booksPath]
  if (originalRequest) require.cache[requestPath] = originalRequest
  else delete require.cache[requestPath]
  if (originalAuth) require.cache[authPath] = originalAuth
  else delete require.cache[authPath]
  if (originalWx) global.wx = originalWx
  else delete global.wx
})

test('a colliding cache key cannot expose another account shelf', () => {
  const originalWx = global.wx
  const storage = new Map()
  const removed = []
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { removed.push(key); storage.delete(key) }
  }
  const authPath = require.resolve('../services/auth')
  const booksPath = require.resolve('../services/books')
  const originalAuth = require.cache[authPath]
  let identity = 'users/y9vai8ajkgb3/'
  require.cache[authPath] = { exports: {
    bearer: () => 'unused-token',
    libraryCacheIdentity: () => identity
  } }
  delete require.cache[booksPath]
  const books = require(booksPath)
  const otherIdentity = 'users/5lvvfkoinmin/'
  const collidingKey = books.cacheKeyFor(identity)
  assert.equal(collidingKey, books.cacheKeyFor(otherIdentity))
  storage.set(collidingKey, {
    identity,
    books: [{ slug: 'other-account-hidden-book', hidden: true }]
  })

  identity = otherIdentity
  assert.deepEqual(books.cachedShelf(), [])
  assert.deepEqual(removed, [collidingKey])
  assert.equal(storage.has(collidingKey), false)

  delete require.cache[booksPath]
  if (originalAuth) require.cache[authPath] = originalAuth
  else delete require.cache[authPath]
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
