const i18n = require('./i18n')
const CATEGORY_ORDER = ['商业', '投资', 'AI', '科学', '人文', '身心', '生活', '故事']
const initialData = {
  bookFilter: 'all', bookSearching: false, bookQuery: '', bookHasQuery: false,
  bookFilters: [{ key: 'all', label: '全部' }, { key: 'mine', label: '我的' }],
  visibleBooks: [], bookSearchLoading: false, bookSearchError: false, bookEmptyText: ''
}

function hit(book, query, entry) {
  const q = String(query || '').trim().toLocaleLowerCase()
  if (!q) return ''
  const contains = (text) => String(text || '').toLocaleLowerCase().includes(q)
  if ([book.title, book.main, book.sub, book.author, book.category].some(contains)) return ''
  if (!entry) return null
  if ([entry.sub, entry.intro].some(contains)) return ''
  const chapter = (entry.toc || []).find((part) => part && (contains(part.t) || contains(part.b)))
  return chapter ? String(chapter.t || '') : null
}

function project(items, filter, query, index) {
  return (items || []).filter((book) => filter === 'all' ||
    (filter === 'mine' ? book.mine === true : book.category === filter))
    .map((book) => ({ book, match: hit(book, query, index && index[book.slug]) }))
    .filter(({ match }) => match !== null)
    .map(({ book, match }) => Object.assign({}, book, {
      chapterHit: match,
      shelfMeta: [book.chapters ? `${book.chapters}${i18n.currentLanguage() === i18n.ENGLISH ? ' chapters' : ' 章'}` : book.sub, i18n.ui(book.category)].filter(Boolean).join(' · ')
    }))
}

// Shared by both shelf entry points. Generation + identity checks reject responses
// after refresh, account changes and page unload; failed fetches require explicit retry.
function createSession(service, changed) {
  let identity = service.cacheIdentity(), generation = 0, disposed = false
  const state = { index: null, loading: false, error: false }
  function invalidate() {
    generation += 1
    identity = service.cacheIdentity()
    Object.assign(state, { index: null, loading: false, error: false })
  }
  function syncIdentity() {
    if (identity !== service.cacheIdentity()) invalidate()
  }
  async function load(retry) {
    syncIdentity()
    if (disposed || state.index || state.loading || (state.error && !retry)) return
    const request = generation, owner = identity
    state.loading = true
    state.error = false
    changed()
    try {
      const index = await service.searchIndex()
      if (disposed || generation !== request || owner !== service.cacheIdentity()) return
      state.index = index
    } catch (_) {
      if (disposed || generation !== request || owner !== service.cacheIdentity()) return
      state.error = true
    } finally {
      if (!disposed && generation === request && owner === service.cacheIdentity()) {
        state.loading = false
        changed()
      }
    }
  }
  return { state, load, invalidate, syncIdentity, dispose() { disposed = true; invalidate() } }
}

function pageMethods(service, itemsKey, rowsFor) {
  return {
    ensureBookSearch() {
      if (!this._bookSearch) this._bookSearch = createSession(service, () => this.refreshBookSearch())
      this._bookSearch.syncIdentity()
      return this._bookSearch
    },
    refreshBookSearch() {
      const session = this.ensureBookSearch()
      const items = this.data[itemsKey] || []
      const present = CATEGORY_ORDER.filter((category) => items.some((book) => book.category === category))
      const selected = this.data.bookFilter || 'all'
      const filter = selected === 'all' || selected === 'mine' || present.includes(selected) ? selected : 'all'
      const query = this.data.bookQuery || ''
      const hasQuery = Boolean(query.trim())
      const visibleBooks = project(items, filter, query, session.state.index)
      let empty = ''
      if (!visibleBooks.length) {
        if (hasQuery) empty = session.state.loading ? i18n.ui('正在翻章节…') : i18n.ui('没有找到匹配的书')
        else empty = i18n.ui(filter === 'mine' ? '还没有你写的书' : filter === 'all' ? '书架暂无书籍' : '这个分类还没有书')
      }
      const patch = {
        bookFilter: filter, visibleBooks, bookHasQuery: hasQuery,
        bookFilters: [{ key: 'all', label: i18n.ui('全部') }, { key: 'mine', label: i18n.ui('我的') }]
          .concat(present.map((category) => ({ key: category, label: i18n.ui(category) }))),
        bookSearchLoading: session.state.loading, bookSearchError: session.state.error,
        bookEmptyText: empty
      }
      if (rowsFor) patch.bookRows = rowsFor(visibleBooks, !hasQuery)
      this.setData(patch)
    },
    invalidateBookSearch() { this.ensureBookSearch().invalidate(); this.refreshBookSearch() },
    resumeBookSearch() {
      this.refreshBookSearch()
      if (String(this.data.bookQuery || '').trim()) this.ensureBookSearch().load()
    },
    selectBookFilter(event) {
      this.setData({ bookFilter: event.currentTarget.dataset.filter })
      this.refreshBookSearch()
    },
    openBookSearch() { this.setData({ bookSearching: true }) },
    closeBookSearch() {
      this.setData({ bookSearching: false, bookQuery: '' })
      this.refreshBookSearch()
    },
    onBookSearchInput(event) {
      this.setData({ bookQuery: String(event.detail.value || '') })
      this.resumeBookSearch()
    },
    retryBookSearch() { this.ensureBookSearch().load(true) }
  }
}
module.exports = { CATEGORY_ORDER, initialData, hit, project, createSession, pageMethods }
