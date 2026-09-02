const api = require('./api')
const auth = require('./auth')
const http = require('./request')

const SUANLI_PER_ARTICLE = 9
const PRICES_CACHE_KEY = 'voicedrop.prices.v1'
const PRICES_TTL_MS = 24 * 60 * 60 * 1000
const FALLBACK_PRICES = Object.freeze({ book: 160, book_revise: 40, fetchedAt: 0 })

function validPrice(value) {
  const price = Number(value)
  return Number.isFinite(price) && price > 0 ? price : null
}

function normalizePrices(value) {
  const source = value && typeof value === 'object' ? value : {}
  const book = validPrice(source.book)
  const revise = validPrice(source.book_revise)
  if (book == null || revise == null) return null
  const fetchedAt = Number(source.fetchedAt)
  return { book, book_revise: revise, fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : 0 }
}

function cachedPrices() {
  try { return normalizePrices(wx.getStorageSync(PRICES_CACHE_KEY)) } catch (_) { return null }
}

function currentPrices() {
  return cachedPrices() || Object.assign({}, FALLBACK_PRICES)
}

function pricesAreStale(prices, now) {
  return !prices || Number(now) - prices.fetchedAt > PRICES_TTL_MS
}

// This is deliberately unauthenticated: price display must work before sign-in.
// Server-side 402 remains the authority when a book is actually submitted.
async function prices(options) {
  const now = Number(options && options.now)
  const fetchedAt = Number.isFinite(now) ? now : Date.now()
  const cached = cachedPrices()
  const previous = cached || Object.assign({}, FALLBACK_PRICES)
  if (!pricesAreStale(cached, fetchedAt)) return previous
  try {
    const res = await http.get(`${api.agentBase()}/usage/prices`, '')
    if (res.statusCode < 200 || res.statusCode >= 300) return previous
    const remote = res.data && typeof res.data === 'object' ? res.data : {}
    const book = validPrice(remote.book)
    // A valid book price is required. A missing or invalid revision price keeps
    // the previous valid value, matching the iOS price-table behavior.
    const revise = validPrice(remote.book_revise) || previous.book_revise
    if (book == null) return previous
    const next = { book, book_revise: revise, fetchedAt }
    try { wx.setStorageSync(PRICES_CACHE_KEY, next) } catch (_) {}
    return next
  } catch (_) { return previous }
}

async function balance() {
  const res = await http.get(`${api.agentBase()}/usage/balance`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`usage HTTP ${res.statusCode}`)
  return res.data || { suanli: 0, spent_suanli: 0 }
}

async function ledger() {
  const res = await http.get(`${api.agentBase()}/usage/ledger?limit=50`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`ledger HTTP ${res.statusCode}`)
  return res.data && res.data.entries ? res.data.entries : []
}

async function summary() {
  const res = await http.get(`${api.agentBase()}/usage/summary`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`summary HTTP ${res.statusCode}`)
  const data = res.data || {}
  return {
    granted: Array.isArray(data.granted) ? data.granted : [],
    spent: Array.isArray(data.spent) ? data.spent : []
  }
}

function articleCapacity(balanceValue) {
  return Math.max(0, Math.floor((Number(balanceValue) || 0) / SUANLI_PER_ARTICLE))
}

module.exports = {
  SUANLI_PER_ARTICLE,
  PRICES_CACHE_KEY,
  PRICES_TTL_MS,
  FALLBACK_PRICES,
  validPrice,
  normalizePrices,
  cachedPrices,
  currentPrices,
  pricesAreStale,
  prices,
  balance,
  ledger,
  summary,
  articleCapacity
}
