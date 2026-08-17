const auth = require('./auth')
const http = require('./request')

const API = 'https://lab.jianshuo.dev/api/book'
const HISTORY_API = API + '/history'
const REVISE_API = API + '/revise'
const SHELF = 'https://voicedrop.cn/books/'
const BOOK_SUANLI = 320
const REVISE_SUANLI = 40
const INDEX = 'https://voicedrop.cn/books/?format=json'
const CACHE_KEY = 'voicedrop.books.shelf.v1'

async function start(seed) {
  return http.postJson(API, auth.bearer(), { seed: String(seed || '').trim().slice(0, 20000) }, { timeout: 30000 })
}

async function history(slug) {
  const value = String(slug || '').trim()
  return http.get(HISTORY_API + '?slug=' + encodeURIComponent(value), auth.bearer(), { timeout: 20000 })
}

async function revise(slug, instruction) {
  return http.postJson(REVISE_API, auth.bearer(), {
    slug: String(slug || '').trim(),
    instruction: String(instruction || '').trim().slice(0, 4000)
  }, { timeout: 30000 })
}

function formatThreadStamp(value) {
  const date = new Date(Number(value) || 0)
  if (!Number.isFinite(date.getTime())) return ''
  const two = (part) => String(part).padStart(2, '0')
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + two(date.getHours()) + ':' + two(date.getMinutes())
}

function normalizeThread(data) {
  const body = data && typeof data === 'object' ? data : {}
  const entries = Array.isArray(body.thread) ? body.thread : []
  const thread = entries.map((item, index) => {
    const entry = item && typeof item === 'object' ? item : {}
    const ts = Number(entry.ts)
    const status = ['running', 'done', 'failed'].includes(entry.status) ? entry.status : 'done'
    return {
      id: (Number.isFinite(ts) ? ts : 0) + '-' + index,
      ts: Number.isFinite(ts) ? ts : 0,
      stamp: formatThreadStamp(ts),
      kind: entry.kind === 'create' ? 'create' : 'revise',
      instruction: String(entry.instruction || ''),
      status,
      reply: String(entry.reply || ''),
      error: String(entry.error || '')
    }
  })
  return {
    slug: String(body.slug || ''),
    author: String(body.author || ''),
    running: Boolean(body.running) || thread.some((entry) => entry.status === 'running'),
    thread
  }
}

function reviseMessage(statusCode, data) {
  if (statusCode === 202) return '已提交修改，可以关掉小程序，改完后这里会留下修改说明。'
  if (statusCode === 402) {
    const body = data && typeof data === 'object' ? data : {}
    const need = formatSuanli(body.need_suanli, REVISE_SUANLI)
    const have = formatSuanli(body.suanli, 0)
    return '算力不足：改一次要 ' + need + ' 算力，你现在有 ' + have + '。'
  }
  if (statusCode === 401) return '身份校验没过，请稍后重试。'
  if (statusCode === 403) return '只有这本书的主人能修改。'
  if (statusCode === 404) return '这本书是早期写的，还没登记主人，暂时不能在线修改。'
  if (statusCode === 409) return '上一个修改还在进行，等它改完再提。'
  return statusCode ? '服务器返回 ' + statusCode + '，请稍后重试。' : '没连上服务器，请检查网络后重试。'
}

function normalizeBook(item) {
  const book = item && typeof item === 'object' ? item : {}
  const normalized = {
    slug: String(book.slug || ''), title: String(book.title || ''),
    main: String(book.main || book.title || '未命名'), sub: String(book.sub || ''),
    c: String(book.c || '#8b6652'), c2: String(book.c2 || '#4b342c'),
    cover: Boolean(book.cover), coverAt: Math.max(0, Number(book.coverAt) || 0),
    chapters: Math.max(0, Number(book.chapters) || 0),
    author: String(book.author || ''), createdAt: Math.max(0, Number(book.createdAt) || 0)
  }
  normalized.coverUrl = normalized.cover ? coverUrl(normalized) : ''
  return normalized
}

function readerUrl(book) {
  return `${SHELF}${encodeURIComponent(String(book && book.slug || ''))}/`
}

function coverUrl(book) {
  const version = Math.max(0, Number(book && book.coverAt) || 0)
  return `${readerUrl(book)}cover.jpg${version ? `?v=${encodeURIComponent(String(version))}` : ''}`
}

function readerPageUrl(book, value) {
  const root = readerUrl(book)
  const candidate = String(value || '')
  return candidate.startsWith(root) ? candidate : root
}

function shareTitle(book) {
  const title = String(book && (book.title || book.main) || '未命名').trim() || '未命名'
  const author = String(book && book.author || '').trim()
  return `《${title}》${author ? ` — ${author}` : ''}`
}

function normalizeIndex(data) {
  return (data && Array.isArray(data.books) ? data.books : [])
    .map(normalizeBook).filter((book) => book.slug)
}

function markEditableByAuthor(items, author) {
  const currentAuthor = String(author || '').trim()
  return (items || []).map((book) => Object.assign({}, book, {
    editableByAuthor: Boolean(currentAuthor) && String(book && book.author || '').trim() === currentAuthor
  }))
}

function cachedShelf() {
  try { return normalizeIndex(wx.getStorageSync(CACHE_KEY)) } catch (_) { return [] }
}

function shelfRequestUrl(options) {
  if (!(options && options.forceRefresh)) return INDEX
  const supplied = Number(options.now)
  const now = Number.isFinite(supplied) ? supplied : Date.now()
  return `${INDEX}${INDEX.includes('?') ? '&' : '?'}_refresh=${encodeURIComponent(String(now))}`
}

async function shelf(options) {
  const forceRefresh = Boolean(options && options.forceRefresh)
  const res = await http.get(shelfRequestUrl(options), '', forceRefresh
    ? { header: { 'Cache-Control': 'no-cache' } }
    : undefined)
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`books HTTP ${res.statusCode}`)
  const list = normalizeIndex(res.data)
  wx.setStorageSync(CACHE_KEY, { books: list })
  return list
}

async function writingContext(dependencies) {
  const services = dependencies || {}
  const usage = services.usage || require('./usage')
  const referral = services.referral || require('./referral')
  let balance = null
  try {
    const data = await usage.balance()
    const value = Number(data && data.suanli)
    balance = Number.isFinite(value) ? value : null
  } catch (_) {}
  if (balance == null || balance >= BOOK_SUANLI) return { balance, invite: null }
  try {
    return { balance, invite: await referral.link() }
  } catch (_) {
    return { balance, invite: null }
  }
}

function formatSuanli(value, fallback) {
  const number = Number.isFinite(Number(value)) ? Number(value) : fallback
  return Number(number.toFixed(1)).toString()
}

function formatBalance(value) {
  if (value == null || value === '') return ''
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return String(Math.round(number)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function shortfall(balance) {
  const number = Number(balance)
  if (!Number.isFinite(number)) return 0
  return Math.ceil(Math.max(0, BOOK_SUANLI - number))
}

function message(statusCode, data) {
  if (statusCode === 202) return '开始写了！现在可以关闭小程序，稍后下拉刷新「写书」书架查看。'
  if (statusCode === 402) {
    const body = data && typeof data === 'object' ? data : {}
    const need = formatSuanli(body.need_suanli, BOOK_SUANLI)
    const have = formatSuanli(body.suanli, 0)
    return `算力不足：写一本书要 ${need} 算力，你现在有 ${have}。去「设置 → 算力」看看怎么攒。`
  }
  if (statusCode === 401) return '身份校验没过，请稍后重试。'
  return statusCode ? `服务器返回 ${statusCode}，请稍后重试。` : '没连上服务器，请检查网络后重试。'
}

function result(response) {
  const statusCode = response && Number(response.statusCode) || 0
  return {
    accepted: statusCode === 202,
    statusCode,
    message: message(statusCode, response && response.data)
  }
}

module.exports = {
  API, HISTORY_API, REVISE_API, SHELF, INDEX, BOOK_SUANLI, REVISE_SUANLI,
  start, history, revise, shelf, shelfRequestUrl, cachedShelf, normalizeIndex,
  markEditableByAuthor,
  normalizeThread, formatThreadStamp, reviseMessage, readerUrl, coverUrl,
  shareTitle, readerPageUrl, writingContext, formatBalance, shortfall, message, result
}
