const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const coverCache = require('../services/book-cover-cache')

const pagePath = require.resolve('../pages/recordings/index')
const pageRequire = createRequire(pagePath)
const fixtures = [
  { slug: 'business', main: '商业书', category: '商业', mine: false },
  { slug: 'ai', main: 'AI 书', category: 'AI', mine: true }
].map(book => ({ ...book, cover: true, coverAt: 1, coverUrl: `https://example.test/${book.slug}.jpg` }))

function harness() {
  let definition, pending
  const updates = [], navigations = [], downloads = [], scrollWrites = []
  const books = {
    cacheIdentity: () => 'same-account',
    cachedShelf: () => fixtures,
    shelf: async () => fixtures,
    refreshCoverUrls: items => items,
    searchIndex: async () => ({})
  }
  const runtime = {
    getStorageSync: () => ({ entries: Object.fromEntries(fixtures.map(book => [
      coverCache.cacheKey(book), `/cached/${book.slug}.jpg`
    ])) }),
    setStorageSync() {}, accessSync() {},
    downloadFile(options) { downloads.push(options.url); return { abort() {} } }
  }
  vm.runInNewContext(fs.readFileSync(pagePath, 'utf8'), {
    require(name) {
      if (name === '../../services/books') return books
      if (name === '../../services/book-cover-cache') return {
        createSession: (_, ready) => coverCache.createSession(runtime, ready)
      }
      return pageRequire(name)
    },
    getApp: () => ({ globalData: {} }),
    Page(value) { definition = value },
    wx: { navigateTo(options) { navigations.push(options) } },
    module: { exports: {} }, setTimeout
  }, { filename: pagePath })
  const page = {
    ...definition,
    data: { ...definition.data, activeTab: 'books', booksLoaded: true },
    initialLoadStarted: true, topLevelUiRendered: true,
    setData(patch, afterRender) {
      Object.assign(this.data, patch)
      // Check every view update, not just the final state after filtering recovers.
      updates.push(JSON.parse(JSON.stringify(this.data.bookRows)))
      if (Object.hasOwn(patch, 'scrollTop')) scrollWrites.push(patch.scrollTop)
      if (afterRender) afterRender()
    },
    showPendingRecordingUploads() {}, drainPendingRecordingUploads() {},
    resetAccountSessionsIfNeeded() {}, applyPendingHomeTab() {}, load() {},
    loadBooks(options) {
      pending = definition.loadBooks.call(this, options)
      return pending
    }
  }
  page.restoreCachedBooks()
  updates.length = 0
  return { page, updates, navigations, downloads, scrollWrites, settle: () => pending }
}

function cells(rows) { return rows.flat().map(cell => cell.key) }

test('returning from a book preserves filtered rows and cached covers through every update', async () => {
  for (const filter of ['AI', 'mine', 'all']) {
    const h = harness()
    h.page.selectBookFilter({ currentTarget: { dataset: { filter } } })
    h.page.onScroll({ detail: { scrollTop: 380 } })
    h.scrollWrites.length = 0
    const expected = JSON.parse(JSON.stringify(h.page.data.bookRows))
    h.page.openBook({ currentTarget: { dataset: { slug: 'ai' } } })
    assert.match(h.navigations[0].url, /book-reader\/index\?slug=ai&/)
    h.updates.length = 0

    h.page.onShow()
    await h.settle()

    assert.ok(h.updates.length > 0)
    for (const rows of h.updates) assert.deepEqual(rows, expected, `return under ${filter}`)
    assert.deepEqual(h.downloads, [])
    assert.deepEqual(h.scrollWrites, [])
    assert.equal(h.page.scrollPositionFor('books'), 380)
    h.page._bookCoverSession.dispose()
  }
})

test('each category tap scrolls the rendered results to the top and clears only the book position', () => {
  const h = harness()
  h.page._scrollPositions = { recordings: 120, community: 240, books: 0 }
  for (const filter of ['AI', 'mine', 'all', 'AI', 'AI']) {
    h.page.onScroll({ detail: { scrollTop: 480 } })
    h.scrollWrites.length = 0
    h.page.selectBookFilter({ currentTarget: { dataset: { filter } } })
    assert.deepEqual(h.scrollWrites, [480, 0])
    assert.equal(h.page.data.scrollTop, 0)
    assert.deepEqual(h.page._scrollPositions, { recordings: 120, community: 240, books: 0 })
    assert.equal(h.page.data.bookFilter, filter)
  }
  h.page._bookCoverSession.dispose()
})

test('restoring cached books keeps category and search results without inserting the write tile', () => {
  const h = harness()
  h.page.selectBookFilter({ currentTarget: { dataset: { filter: 'AI' } } })
  h.page.setData({ bookQuery: 'AI' })
  h.page.refreshBookSearch()
  h.updates.length = 0

  h.page.restoreCachedBooks()

  for (const rows of h.updates) assert.deepEqual(cells(rows), ['book:ai'])
  h.page._bookSearch.dispose()
  h.page._bookCoverSession.dispose()
})

test('a cover error retries only that cover without exposing books outside the category', () => {
  const h = harness()
  h.page.selectBookFilter({ currentTarget: { dataset: { filter: 'AI' } } })
  h.updates.length = 0

  h.page.onBookCoverError({ currentTarget: { dataset: { slug: 'ai' } } })

  for (const rows of h.updates) assert.deepEqual(cells(rows), ['write', 'book:ai'])
  assert.equal(h.page.data.bookRows[0][1].coverDisplayUrl, '')
  assert.deepEqual(h.downloads, ['https://example.test/ai.jpg'])
  h.page._bookCoverSession.dispose()
})
