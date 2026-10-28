const test = require('node:test')
const assert = require('node:assert/strict')
const { project, pageMethods, initialData } = require('../utils/book-shelf-search')
const books = require('../services/books')

const fixtures = [
  { slug: 'video', title: '有动画版', category: '科学', video: true, cover: false, hidden: true },
  { slug: 'string', title: '不是布尔值', video: 'true' },
  { slug: 'old', title: '旧缓存', category: '科学' },
  { slug: 'false', title: '无动画版', video: false }
]

test('video flag is strict, survives normalization/cache roundtrip, and old caches default false', () => {
  const normalized = books.normalizeIndex({ books: fixtures })
  assert.deepEqual(normalized.map(book => book.video), [true, false, false, false])
  const previousWx = global.wx
  const storage = new Map()
  global.wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value) }
  const identity = books.cacheIdentity()
  storage.set(books.cacheKeyFor(identity), { identity, books: normalized })
  try {
    assert.deepEqual(books.cachedShelf().map(book => book.video), [true, false, false, false])
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
})

test('video filtering intersects title and chapter search and preserves normal categories', () => {
  const index = { video: { toc: [{ t: '第一章', b: '动画演示' }] }, old: { toc: [{ t: '另一章', b: '动画演示' }] } }
  assert.deepEqual(project(fixtures, 'video', '', null).map(book => book.slug), ['video'])
  assert.deepEqual(project(fixtures, 'video', '有动画', null).map(book => book.slug), ['video'])
  const matches = project(fixtures, 'video', '动画演示', index)
  assert.deepEqual(matches.map(book => book.slug), ['video'])
  assert.equal(matches[0].chapterHit, '第一章')
  assert.equal(project(fixtures, 'video', '旧缓存', index).length, 0)
  assert.deepEqual(project(fixtures, '科学', '', null).map(book => book.slug), ['video', 'old'])
})

test('both shelf surfaces show video after mine only when available and safely reset after refresh', () => {
  const previousWx = global.wx
  global.wx = { getStorageSync: () => 'en' }
  try {
    for (const key of ['items', 'bookItems']) {
      const page = {
        ...pageMethods({ cacheIdentity: () => 'a' }, key),
        data: { ...initialData, [key]: fixtures },
        setData(patch, done) { Object.assign(this.data, patch); if (done) done() }
      }
      page.refreshBookSearch()
      assert.deepEqual(page.data.bookFilters.map(filter => filter.key), ['all', 'mine', 'video', '科学'])
      assert.equal(page.data.bookFilters[2].label, 'Video')
      page.selectBookFilter({ currentTarget: { dataset: { filter: 'video' } } })
      assert.deepEqual(page.data.visibleBooks.map(book => book.slug), ['video'])
      page.data[key] = fixtures.slice(1)
      page.refreshBookSearch()
      assert.equal(page.data.bookFilter, 'all')
      assert.equal(page.data.bookFilters.some(filter => filter.key === 'video'), false)
      assert.equal(page.data.visibleBooks.length, 3)
    }
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
})
