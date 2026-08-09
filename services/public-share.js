const api = require('./api')
const http = require('./request')
const auth = require('./auth')
const article = require('../utils/article')

const SHARE_ID_CACHE_PREFIX = 'voicedrop.publicShareId.v1.'
const PUBLIC_SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{10}$/

function cacheKey(stem, dependencies) {
  const deps = dependencies || {}
  const authService = deps.auth || auth
  const identity = authService && typeof authService.libraryCacheIdentity === 'function'
    ? authService.libraryCacheIdentity()
    : 'default'
  return `${SHARE_ID_CACHE_PREFIX}${encodeURIComponent(String(identity || 'default'))}.${encodeURIComponent(String(stem || ''))}`
}

function storageApi(dependencies) {
  const deps = dependencies || {}
  if (deps.storage) return deps.storage
  return typeof wx !== 'undefined' ? wx : null
}

function cachedId(stem, dependencies) {
  if (!stem) return ''
  const storage = storageApi(dependencies)
  if (!storage || typeof storage.getStorageSync !== 'function') return ''
  try {
    const id = String(storage.getStorageSync(cacheKey(stem, dependencies)) || '').trim()
    return PUBLIC_SHARE_ID_PATTERN.test(id) ? id : ''
  } catch (_) {
    return ''
  }
}

function storeId(stem, shareId, dependencies) {
  const id = String(shareId || '').trim()
  if (!stem || !PUBLIC_SHARE_ID_PATTERN.test(id)) return false
  const storage = storageApi(dependencies)
  if (!storage || typeof storage.setStorageSync !== 'function') return false
  try {
    storage.setStorageSync(cacheKey(stem, dependencies), id)
    return true
  } catch (_) {
    return false
  }
}

function shareIdFromUrl(value) {
  const match = String(value || '').match(/\/([A-Za-z0-9_-]{6,16})(?:\?[^#]*)?(?:#.*)?$/)
  return match ? match[1] : ''
}

async function read(shareId, dependencies) {
  const id = String(shareId || '').trim()
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(id)) return { ok: false, error: 'bad_id' }
  const deps = dependencies || {}
  const request = deps.http || http
  const apiService = deps.api || api
  let res
  try {
    res = await request.get(`${apiService.filesBase()}/link/${apiService.path(id)}`, '')
  } catch (_) {
    return { ok: false, error: 'network' }
  }
  if (!res || res.statusCode < 200 || res.statusCode >= 300 || !res.data || !Array.isArray(res.data.articles)) {
    return { ok: false, error: res && res.data && res.data.error || 'not_found' }
  }
  const doc = article.parseDoc({ articles: res.data.articles, photos: res.data.photos, owner: res.data.owner })
  return doc.articles.length ? { ok: true, doc, type: res.data.type || 'article' } : { ok: false, error: 'empty_article' }
}

module.exports = { shareIdFromUrl, cachedId, storeId, read }
