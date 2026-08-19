const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function harness(outcomes) {
  const storage = {}
  const files = new Set()
  const downloads = []
  const timers = []
  let aborts = 0
  const runtime = {
    userDataPath: '/persistent',
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = value },
    accessSync(filePath) {
      if (!files.has(filePath)) throw new Error('missing')
    },
    saveFile({ tempFilePath, filePath, success }) {
      files.add(filePath)
      success({ savedFilePath: filePath, tempFilePath })
    },
    unlink({ filePath, complete }) {
      files.delete(filePath)
      if (complete) complete()
    },
    downloadFile(options) {
      const outcome = outcomes[downloads.length]
      downloads.push(options.url)
      queueMicrotask(() => {
        if (outcome === 'pending') return
        if (outcome === 'network') options.fail(new Error('offline'))
        else options.success({ statusCode: outcome || 200, tempFilePath: `/tmp/${downloads.length}.jpg` })
      })
      return { abort() { aborts += 1 } }
    },
    setTimeout(callback, delay) {
      timers.push({ callback, delay, canceled: false })
      return timers.length
    },
    clearTimeout(id) {
      if (timers[id - 1]) timers[id - 1].canceled = true
    }
  }
  return { runtime, storage, files, downloads, timers, aborts: () => aborts }
}

test('book cover cache key changes with coverAt and restores a persisted file', async () => {
  const cache = require('../services/book-cover-cache')
  const h = harness([200])
  const book = { slug: 'hello', cover: true, coverAt: 456, coverUrl: 'https://example.test/cover.jpg?v=456' }
  const paths = []
  const session = cache.createSession(h.runtime, (slug, key, filePath) => paths.push({ slug, key, filePath }))

  assert.notEqual(cache.cacheKey(book), cache.cacheKey({ ...book, coverAt: 457 }))
  assert.equal(session.cachedPath(book), '')
  session.load([book])
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(paths.length, 1)
  assert.match(paths[0].filePath, /^\/persistent\//)
  assert.equal(session.cachedPath(book), paths[0].filePath)
})

test('book cover download retries four times with finite exponential backoff', async () => {
  const cache = require('../services/book-cover-cache')
  const h = harness(['network', 503, 'network', 200])
  const ready = []
  const session = cache.createSession(h.runtime, (...args) => ready.push(args))
  const book = { slug: 'weak-network', cover: true, coverAt: 9, coverUrl: 'https://example.test/cover.jpg?v=9' }

  session.load([book])
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(h.timers[attempt].delay, [2000, 4000, 8000][attempt])
    h.timers[attempt].callback()
  }
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(h.downloads.length, 4)
  assert.equal(ready.length, 1)
})

test('reloading or disposing a shelf session ignores stale callbacks and cancels pending work', async () => {
  const cache = require('../services/book-cover-cache')
  const h = harness(['network', 200, 'pending'])
  const ready = []
  const session = cache.createSession(h.runtime, (slug) => ready.push(slug))
  const oldBook = { slug: 'old', cover: true, coverAt: 1, coverUrl: 'https://example.test/old.jpg' }
  const newBook = { slug: 'new', cover: true, coverAt: 2, coverUrl: 'https://example.test/new.jpg' }

  session.load([oldBook])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(h.timers.length, 1)
  session.load([newBook])
  assert.equal(h.timers[0].canceled, true)
  h.timers[0].callback()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(ready, ['new'])

  session.load([{ ...newBook, slug: 'pending' }])
  await new Promise((resolve) => setImmediate(resolve))
  session.dispose()
  assert.ok(h.aborts() >= 1)
})

test('repeated image decode failures share the same strict per-cover session budget', async () => {
  const cache = require('../services/book-cover-cache')
  const h = harness([200, 200, 200, 200, 200, 200, 200])
  const book = { slug: 'corrupt-image', cover: true, coverAt: 3, coverUrl: 'https://example.test/corrupt.jpg' }
  let readyCount = 0
  let session
  session = cache.createSession(h.runtime, () => {
    readyCount += 1
    if (readyCount < 7) session.retry(book)
  })

  session.load([book])
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(h.downloads.length, cache.MAX_ATTEMPTS)
  assert.equal(readyCount, cache.MAX_ATTEMPTS)
})

test('a bad persisted cover is invalidated and gets a bounded network recovery', async () => {
  const cache = require('../services/book-cover-cache')
  const h = harness([200])
  const book = { slug: 'stale-local', cover: true, coverAt: 8, coverUrl: 'https://example.test/fresh.jpg' }
  const key = cache.cacheKey(book)
  const stalePath = '/persistent/stale-local.jpg'
  h.storage[cache.STORAGE_KEY] = { entries: { [key]: stalePath }, slugs: { [book.slug]: key } }
  h.files.add(stalePath)
  const ready = []
  const session = cache.createSession(h.runtime, (...args) => ready.push(args))

  assert.equal(session.cachedPath(book), stalePath)
  session.retry(book)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(h.files.has(stalePath), false)
  assert.equal(h.downloads.length, 1)
  assert.equal(ready.length, 1)
})

test('both book shelves keep cloth titles mounted beneath optional cached cover images', () => {
  const standalone = fs.readFileSync(path.join(root, 'pages/book-shelf/index.wxml'), 'utf8')
  const home = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')

  for (const markup of [standalone, home]) {
    assert.match(markup, /<text class="cover-main">\{\{(?:item|cell)\.main\}\}<\/text>/)
    assert.doesNotMatch(markup, /<block wx:else><text class="cover-main">/)
    assert.match(markup, /<image wx:if="\{\{(?:item|cell)\.coverDisplayUrl\}\}"/)
  }
})
