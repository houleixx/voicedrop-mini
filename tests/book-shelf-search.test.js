const test = require('node:test')
const assert = require('node:assert/strict')
const { project, createSession, pageMethods, initialData } = require('../utils/book-shelf-search')
const fixtures = [
  { slug: 'business', title: '写作创业', main: '写作', sub: '创业故事', author: '张三', category: '商业', mine: true },
  { slug: 'ai', title: 'AI 科普', author: 'Alice', category: 'AI', mine: 'true' },
  { slug: 'old', title: '旧书' }
]
const index = { old: { sub: '回忆', intro: '童年介绍', toc: [{ t: '第一章', b: '机器学习' }, { t: '', b: '无题章节' }] } }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('filters and search intersect, mine is strict, uncategorized books remain in all', () => {
  assert.deepEqual(project(fixtures, 'all', '', null).map(b => b.slug), ['business', 'ai', 'old'])
  assert.deepEqual(project(fixtures, 'mine', '', null).map(b => b.slug), ['business'])
  assert.equal(project(fixtures, '商业', '  张三  ', null)[0].slug, 'business')
  assert.equal(project(fixtures, '商业', 'Alice', null).length, 0)
  assert.equal(project(fixtures, 'all', 'alice', null)[0].slug, 'ai')
  assert.equal(project(fixtures, 'all', '创业故事', null)[0].slug, 'business')
  assert.equal(project(fixtures, 'all', '商业', null)[0].slug, 'business')
})

test('index supplements intro/subtitle/chapters and only chapter matches carry a hint', () => {
  for (const query of ['回忆', '童年介绍', '第一章', '机器学习', '无题章节']) {
    const results = project(fixtures, 'all', query, index)
    assert.equal(results[0].slug, 'old')
    assert.equal(results[0].chapterHit, ['第一章', '机器学习'].includes(query) ? '第一章' : '')
  }
  const direct = project(fixtures, 'all', '旧书', { old: { toc: [{ t: '旧书章节' }] } })
  assert.equal(direct[0].chapterHit, '')
  assert.equal(project(fixtures, 'all', '机器学习', null).length, 0)
})

test('search is lazy, coalesces rapid input, and failed requests only retry explicitly', async () => {
  let calls = 0
  const request = deferred()
  const service = { cacheIdentity: () => 'a', searchIndex() { calls += 1; return request.promise } }
  const session = createSession(service, () => {})
  assert.equal(calls, 0)
  const pending = session.load()
  await session.load()
  assert.equal(calls, 1)
  request.reject(new Error('offline'))
  await pending
  assert.equal(session.state.error, true)
  await session.load()
  assert.equal(calls, 1)
  service.searchIndex = async () => { calls += 1; return index }
  await session.load(true)
  assert.equal(calls, 2)
  assert.equal(session.state.index, index)
})

test('refresh rejects late old index, then unload rejects the replacement', async () => {
  const old = deferred(), fresh = deferred()
  let calls = 0
  const session = createSession({ cacheIdentity: () => 'a', searchIndex: () => ++calls === 1 ? old.promise : fresh.promise }, () => {})
  const pendingOld = session.load()
  session.invalidate()
  const pendingFresh = session.load()
  old.resolve({ private: 'stale' })
  await pendingOld
  assert.equal(session.state.loading, true)
  assert.equal(session.state.index, null)
  session.dispose()
  fresh.resolve(index)
  await pendingFresh
  assert.equal(session.state.index, null)
})

test('account changes isolate in-flight responses even before onShow runs', async () => {
  const old = deferred()
  let identity = 'a'
  const service = { cacheIdentity: () => identity, searchIndex: () => old.promise }
  const session = createSession(service, () => {})
  const pending = session.load()
  identity = 'b'
  old.resolve(index)
  await pending
  assert.equal(session.state.index, null)
  session.syncIdentity()
  assert.equal(session.state.loading, false)
  service.searchIndex = async () => ({})
  await session.load()
  assert.deepEqual(session.state.index, {})
})

test('both page variants retain filter on cancel, hide writing only for nonempty query, and show category order', async () => {
  for (const key of ['items', 'bookItems']) {
    let requests = 0
    const service = { cacheIdentity: () => 'a', searchIndex: async () => { requests++; return index } }
    const page = {
      ...pageMethods(service, key, (items, write) => ({ items, write })),
      data: { ...initialData, [key]: fixtures }, setData(patch) { Object.assign(this.data, patch) }
    }
    page.refreshBookSearch()
    assert.deepEqual(page.data.bookFilters.map(f => f.key), ['all', 'mine', '商业', 'AI'])
    assert.equal(requests, 0)
    page.selectBookFilter({ currentTarget: { dataset: { filter: 'mine' } } })
    page.openBookSearch()
    page.onBookSearchInput({ detail: { value: '   ' } })
    assert.equal(requests, 0)
    assert.equal(page.data.bookRows.write, true)
    page.onBookSearchInput({ detail: { value: '张三' } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests, 1)
    assert.equal(page.data.bookRows.write, false)
    assert.equal(page.data.visibleBooks[0].slug, 'business')
    page.closeBookSearch()
    assert.equal(page.data.bookFilter, 'mine')
    assert.equal(page.data.bookQuery, '')
    assert.equal(page.data.bookRows.write, true)
  }
})

test('search service sends bearer and rejects HTML or ordinary shelf JSON from old deployments', async () => {
  const booksPath = require.resolve('../services/books'), httpPath = require.resolve('../services/request'), authPath = require.resolve('../services/auth')
  const originals = [booksPath, httpPath, authPath].map(path => require.cache[path])
  let response = { statusCode: 200, data: '<html>old deployment</html>' }, request
  require.cache[httpPath] = { exports: { get: async (...args) => { request = args; return response } } }
  require.cache[authPath] = { exports: { bearer: () => 'test-token', libraryCacheIdentity: () => 'a' } }
  delete require.cache[booksPath]
  try {
    const books = require(booksPath)
    await assert.rejects(books.searchIndex(), /unavailable/)
    assert.match(request[0], /books\/[?]format=search&/)
    assert.equal(request[1], 'test-token')
    assert.equal(request[2].header['Cache-Control'], 'no-cache')
    response = { statusCode: 200, data: { books: [{ slug: 'old', title: 'old shelf' }] } }
    await assert.rejects(books.searchIndex(), /unavailable/)
    response = { statusCode: 200, data: { books: [{ slug: 'old', sub: '回忆', intro: '童年', toc: [{ t: '第一章', b: '机器学习' }] }] } }
    const value = await books.searchIndex()
    assert.equal(value.old.toc[0].b, '机器学习')
    assert.equal(books.normalizeIndex({ books: [{ slug: 'a', category: 'AI', mine: true }, { slug: 'b', mine: 'true' }] })[0].category, 'AI')
    assert.equal(books.normalizeIndex({ books: [{ slug: 'b', mine: 'true' }] })[0].mine, false)
  } finally {
    [booksPath, httpPath, authPath].forEach((path, i) => { if (originals[i]) require.cache[path] = originals[i]; else delete require.cache[path] })
  }
})


test('removed categories reset to all and shelf metadata carries the category', () => {
  const service = { cacheIdentity: () => 'a' }
  const page = {
    ...pageMethods(service, 'items'), data: { ...initialData, items: fixtures, bookFilter: '商业' },
    setData(patch) { Object.assign(this.data, patch) }
  }
  page.refreshBookSearch()
  assert.equal(page.data.visibleBooks[0].shelfMeta, '创业故事 · 商业')
  page.data.items = [fixtures[1]]
  page.refreshBookSearch()
  assert.equal(page.data.bookFilter, 'all')
  assert.equal(page.data.visibleBooks[0].slug, 'ai')
})


test('both shelf variants update category labels and metadata when language changes without changing selection', () => {
  const previousWx = global.wx
  let language = 'en'
  global.wx = { getStorageSync: () => language }
  try {
    const categories = require('../utils/book-shelf-search').CATEGORY_ORDER
    const english = ['All', 'Mine', 'Business', 'Investing', 'AI', 'Science', 'Humanities', 'Wellness', 'Lifestyle', 'Stories']
    const items = categories.map(category => ({ slug: category, title: '中文书名', author: '中文作者', category, chapters: 3 }))
    for (const key of ['items', 'bookItems']) {
      language = 'en'
      const page = {
        ...pageMethods({ cacheIdentity: () => 'a' }, key),
        data: { ...initialData, [key]: items },
        setData(patch) { Object.assign(this.data, patch) }
      }
      page.refreshBookSearch()
      assert.deepEqual(page.data.bookFilters.map(filter => filter.label), english)
      assert.deepEqual(page.data.bookFilters.map(filter => filter.key), ['all', 'mine', ...categories])
      page.selectBookFilter({ currentTarget: { dataset: { filter: '商业' } } })
      assert.equal(page.data.visibleBooks.length, 1)
      assert.equal(page.data.visibleBooks[0].shelfMeta, '3 chapters · Business')
      assert.equal(page.data.visibleBooks[0].category, '商业')
      assert.equal(page.data.visibleBooks[0].title, '中文书名')
      assert.equal(page.data.visibleBooks[0].author, '中文作者')
      language = 'zh-Hans'
      page.refreshBookSearch()
      assert.equal(page.data.bookFilter, '商业')
      assert.deepEqual(page.data.bookFilters.map(filter => filter.label), ['全部', '我的', ...categories])
      assert.equal(page.data.visibleBooks[0].shelfMeta, '3 章 · 商业')
    }
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
})

test('search scope and community filters have English template copy', () => {
  const i18n = require('../utils/i18n')
  const copy = i18n.copy('en')
  assert.equal(copy['当前筛选'], 'Filter')
  assert.equal(copy['我的'], 'Mine')
  assert.equal(copy['商业'], 'Business')
  assert.equal(copy['推荐'], 'Recommended')
  assert.equal(copy['最新'], 'Latest')
  assert.equal(copy['回应'], 'Reply')
  assert.equal(i18n.ui('未知分类', 'en'), '未知分类')
})
