const api = require('./api')
const auth = require('./auth')
const http = require('./request')
const article = require('../utils/article')
const recording = require('../utils/recording')

const META_CACHE_PREFIX = 'voicedrop.library.meta.v1.'
const LIST_CACHE_PREFIX = 'voicedrop.library.list.v1.'
const DOC_CACHE_PREFIX = 'voicedrop.library.doc.v1.'
const DOC_CACHE_INDEX_PREFIX = 'voicedrop.library.doc-index.v1.'
const PHOTO_CACHE_INDEX_PREFIX = 'voicedrop.library.photo-index.v1.'
const AUDIO_CACHE_INDEX_PREFIX = 'voicedrop.library.audio-index.v1.'
const DOC_CACHE_LIMIT = 40
const PHOTO_CACHE_LIMIT = 160
const AUDIO_CACHE_LIMIT = 8
const META_CONCURRENCY = 5
let metaCacheIdentity = ''
let titleCache = {}
let tagsCache = {}
let coverCache = {}
let staleMetaKeys = new Set()
let cachedScope = ''
let cachedScopeToken = ''
let photoCacheGenerations = {}
let missingPhotoThumbnails = new Set()
let docCacheGenerations = {}
let audioCacheGenerations = {}
const docFetches = new Map()
const audioDownloads = new Map()
const photoDownloads = new Map()

async function list() {
  ensureMetaCache()
  let records = await indexedRecordings().catch(() => null)
  if (!records) records = await legacyRecordings()
  records.sort((a, b) => (b.uploaded || '').localeCompare(a.uploaded || '') || b.audioName.localeCompare(a.audioName))
  applyCachedArticleMeta(records)
  storeRecordingsSnapshot(records)
  return records
}

function listCacheKey() {
  return `${LIST_CACHE_PREFIX}${docCacheIdentity()}`
}

function recordingSnapshot(records) {
  return {
    recordings: (records || [])
      .filter((rec) => rec && rec.audioName && !rec.uploading)
      .map((rec) => ({
        name: rec.audioName,
        uploaded: rec.uploaded || '',
        hasArticles: Boolean(rec.hasArticles),
        isEmpty: Boolean(rec.isEmpty),
        blocked: Boolean(rec.blocked),
        hasTags: Boolean(rec.hasTags)
      }))
  }
}

function storeRecordingsSnapshot(records) {
  if (typeof wx === 'undefined' || !wx.setStorageSync) return
  try {
    wx.setStorageSync(listCacheKey(), JSON.stringify(recordingSnapshot(records)))
  } catch (_) {
  }
}

function cachedRecordings() {
  ensureMetaCache()
  if (typeof wx === 'undefined' || !wx.getStorageSync) return null
  try {
    const raw = wx.getStorageSync(listCacheKey())
    if (!raw) return null
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!data || !Array.isArray(data.recordings)) return null
    const records = data.recordings
      .filter((item) => recording.isRecordingFile(item && item.name))
      .map(recording.fromRecordingIndex)
      .sort((a, b) => (b.uploaded || '').localeCompare(a.uploaded || '') || b.audioName.localeCompare(a.audioName))
    applyCachedArticleMeta(records)
    return records
  } catch (_) {
    return null
  }
}

function removeRecordingFromSnapshot(audioName) {
  const records = cachedRecordings()
  if (!Array.isArray(records)) return
  storeRecordingsSnapshot(records.filter((rec) => rec.audioName !== audioName))
}

function updateRecordingSnapshot(stem, update) {
  const records = cachedRecordings()
  if (!Array.isArray(records)) return
  storeRecordingsSnapshot(records.map((rec) => rec.stem === stem
    ? Object.assign({}, rec, update || {})
    : rec))
}

async function indexedRecordings() {
  const res = await http.get(`${api.filesBase()}/recordings`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) return null
  if (!res.data || !Array.isArray(res.data.recordings)) return null
  return res.data.recordings
    .filter((item) => recording.isRecordingFile(item && item.name))
    .map(recording.fromRecordingIndex)
}

async function legacyRecordings() {
  const res = await http.get(`${api.filesBase()}/list`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`加载失败 HTTP ${res.statusCode}`)
  const files = (res.data && res.data.files) || []
  const names = new Set(files.map((item) => item.name))
  return files
    .filter((item) => recording.isRecordingFile(item.name && item.name.split('/').pop()))
    .map((item) => recording.fromRemoteFile(item, names))
}

async function fetchDoc(stem) {
  const normalizedStem = String(stem || '').trim()
  if (!normalizedStem) return null
  const requestKey = docRequestKey(normalizedStem)
  const existing = docFetches.get(requestKey)
  if (existing) return existing.promise
  const generation = Number(docCacheGenerations[requestKey] || 0)
  const promise = (async () => {
    const res = await http.get(`${api.filesBase()}/articles/${api.path(normalizedStem)}`, auth.bearer())
    if (res.statusCode < 200 || res.statusCode >= 300) return null
    if (docRequestKey(normalizedStem) !== requestKey ||
        Number(docCacheGenerations[requestKey] || 0) !== generation) return null
    cacheDoc(normalizedStem, res.data)
    return article.parseDoc(res.data)
  })()
  docFetches.set(requestKey, { stem: normalizedStem, promise })
  try {
    return await promise
  } finally {
    const current = docFetches.get(requestKey)
    if (current && current.promise === promise) docFetches.delete(requestKey)
  }
}

async function fetchDocByArticleKey(articleKey) {
  let stem = String(articleKey || '').trim()
  if (!stem) return null
  if (stem.endsWith('.json')) stem = stem.slice(0, -5)
  return fetchDoc(stem)
}

async function enrichArticleMeta(records) {
  ensureMetaCache()
  const pending = (records || []).filter((rec) => rec && rec.hasArticles && !hasCompleteArticleMeta(rec))
  if (!pending.length) return records || []
  await mapLimit(pending, META_CONCURRENCY, async (rec) => {
    const key = recording.articleKey(rec.stem)
    const doc = await fetchDoc(rec.stem).catch(() => null)
    if (!doc) return
    const title = doc.articles && doc.articles.length ? doc.articles[0].title || '' : ''
    rec.articleTitle = title
    titleCache[key] = title
    rec.tags = Array.isArray(doc.tags) ? doc.tags : []
    tagsCache[key] = rec.tags
    let cover = ''
    for (const item of doc.articles || []) {
      const coverPhotoKey = article.firstPhotoKey(item.body, doc.photos)
      if (coverPhotoKey) {
        cover = coverPhotoKey
        break
      }
    }
    rec.coverPhotoKey = cover
    coverCache[key] = cover
    staleMetaKeys.delete(key)
    rec.rowTitle = recording.rowTitle(rec)
  })
  persistMetaCache()
  return records || []
}

function applyCachedArticleMeta(records) {
  for (const rec of records || []) {
    if (!rec || !rec.hasArticles) continue
    const key = recording.articleKey(rec.stem)
    if (Object.prototype.hasOwnProperty.call(titleCache, key)) rec.articleTitle = titleCache[key]
    if (Object.prototype.hasOwnProperty.call(tagsCache, key)) rec.tags = tagsCache[key]
    if (Object.prototype.hasOwnProperty.call(coverCache, key)) rec.coverPhotoKey = coverCache[key]
    rec.rowTitle = recording.rowTitle(rec)
  }
}

function hasCompleteArticleMeta(rec) {
  const key = recording.articleKey(rec.stem)
  return !staleMetaKeys.has(key) &&
    Object.prototype.hasOwnProperty.call(titleCache, key) &&
    Object.prototype.hasOwnProperty.call(tagsCache, key) &&
    Object.prototype.hasOwnProperty.call(coverCache, key)
}

async function mapLimit(items, limit, worker) {
  const queue = (items || []).slice()
  const count = Math.min(Math.max(1, limit || 1), queue.length)
  await Promise.all(Array.from({ length: count }, async () => {
    while (queue.length) await worker(queue.shift())
  }))
}

function metaIdentity() {
  return docCacheIdentity()
}

function ensureMetaCache() {
  const identity = metaIdentity()
  if (identity === metaCacheIdentity) return
  metaCacheIdentity = identity
  titleCache = {}
  tagsCache = {}
  coverCache = {}
  staleMetaKeys = new Set()
  try {
    const raw = wx.getStorageSync(`${META_CACHE_PREFIX}${identity}`)
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {}
    titleCache = parsed.titles && typeof parsed.titles === 'object' ? parsed.titles : {}
    tagsCache = parsed.tags && typeof parsed.tags === 'object' ? parsed.tags : {}
    coverCache = parsed.covers && typeof parsed.covers === 'object' ? parsed.covers : {}
    staleMetaKeys = new Set(Array.isArray(parsed.stale) ? parsed.stale : [])
  } catch (_) {
  }
}

function persistMetaCache() {
  if (!metaCacheIdentity) return
  try {
    wx.setStorageSync(`${META_CACHE_PREFIX}${metaCacheIdentity}`, JSON.stringify({
      titles: titleCache,
      tags: tagsCache,
      covers: coverCache,
      stale: Array.from(staleMetaKeys)
    }))
  } catch (_) {
  }
}

function docCacheIdentity() {
  const identity = auth.libraryCacheIdentity
    ? auth.libraryCacheIdentity()
    : (auth.anonId ? auth.anonId() : 'default')
  return encodeURIComponent(String(identity || 'default'))
}

function docRequestKey(stem) {
  return `${docCacheIdentity()}:${String(stem || '')}`
}

function docCacheKey(stem) {
  return `${DOC_CACHE_PREFIX}${docCacheIdentity()}.${encodeURIComponent(String(stem || ''))}`
}

function docCacheIndexKey() {
  return `${DOC_CACHE_INDEX_PREFIX}${docCacheIdentity()}`
}

function photoCacheIndexKey() {
  return `${PHOTO_CACHE_INDEX_PREFIX}${docCacheIdentity()}`
}

function audioCacheIndexKey(identity) {
  return `${AUDIO_CACHE_INDEX_PREFIX}${identity || docCacheIdentity()}`
}

function photoCacheIndex() {
  try {
    const raw = wx.getStorageSync(photoCacheIndexKey())
    const values = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw
    return Array.isArray(values)
      ? values.filter((item) => item && item.key && item.path)
      : []
  } catch (_) {
    return []
  }
}

function persistPhotoCacheIndex(entries) {
  try {
    if (entries.length) wx.setStorageSync(photoCacheIndexKey(), JSON.stringify(entries))
    else wx.removeStorageSync(photoCacheIndexKey())
  } catch (_) {
  }
}

function deleteCachedPhotoFile(path) {
  if (!path) return
  try {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager()
    if (fs && fs.unlinkSync) {
      fs.unlinkSync(path)
      return
    }
    if (wx.removeSavedFile) wx.removeSavedFile({ filePath: path })
  } catch (_) {
  }
}

function audioCacheIndex(identity) {
  try {
    const raw = wx.getStorageSync(audioCacheIndexKey(identity))
    const values = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw
    return Array.isArray(values)
      ? values.filter((item) => item && item.key && item.path)
      : []
  } catch (_) {
    return []
  }
}

function persistAudioCacheIndex(entries, identity) {
  try {
    if (entries.length) wx.setStorageSync(audioCacheIndexKey(identity), JSON.stringify(entries))
    else wx.removeStorageSync(audioCacheIndexKey(identity))
  } catch (_) {
  }
}

function cachedAudioPath(key, identity) {
  if (!key) return ''
  const entries = audioCacheIndex(identity)
  const hit = entries.find((item) => item.key === key)
  if (!hit) return ''
  try {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager()
    if (fs && fs.accessSync) fs.accessSync(hit.path)
    const next = entries.filter((item) => item.key !== key)
    next.push(Object.assign({}, hit, { at: Date.now() }))
    persistAudioCacheIndex(next, identity)
    return hit.path
  } catch (_) {
    persistAudioCacheIndex(entries.filter((item) => item.key !== key), identity)
    return ''
  }
}

function removeCachedAudio(keys) {
  const identity = docCacheIdentity()
  const entries = audioCacheIndex(identity)
  const requested = (keys || []).filter(Boolean)
  const targets = new Set(requested.length ? requested : entries.map((item) => item.key))
  targets.forEach((key) => {
    const generationKey = `${identity}:${key}`
    audioCacheGenerations[generationKey] = Number(audioCacheGenerations[generationKey] || 0) + 1
    audioDownloads.delete(generationKey)
  })
  entries.forEach((item) => {
    if (targets.has(item.key)) deleteCachedPhotoFile(item.path)
  })
  persistAudioCacheIndex(entries.filter((item) => !targets.has(item.key)), identity)
}

function persistDownloadedAudio(key, tempFilePath, generation, identity) {
  return new Promise((resolve) => {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager()
    const saveFile = fs && fs.saveFile ? fs.saveFile.bind(fs) : wx.saveFile
    if (!saveFile) {
      resolve(tempFilePath)
      return
    }
    saveFile({
      tempFilePath,
      success: (res) => {
        const savedPath = res.savedFilePath || res.tempFilePath || tempFilePath
        const generationKey = `${identity}:${key}`
        if (docCacheIdentity() !== identity ||
            Number(audioCacheGenerations[generationKey] || 0) !== generation) {
          deleteCachedPhotoFile(savedPath)
          resolve(tempFilePath)
          return
        }
        const entries = audioCacheIndex(identity)
        const previous = entries.find((item) => item.key === key)
        const next = entries.filter((item) => item.key !== key)
        next.push({ key, path: savedPath, at: Date.now() })
        const kept = next.slice(-AUDIO_CACHE_LIMIT)
        next.slice(0, Math.max(0, next.length - AUDIO_CACHE_LIMIT))
          .forEach((item) => deleteCachedPhotoFile(item.path))
        if (previous && previous.path !== savedPath) deleteCachedPhotoFile(previous.path)
        persistAudioCacheIndex(kept, identity)
        resolve(savedPath)
      },
      fail: () => resolve(tempFilePath)
    })
  })
}

function cachedPhotoPath(key, scope, options) {
  const scopedKey = scopedPhotoKey(key, scope)
  if (!scopedKey) return ''
  const fullKey = options && options.preferThumb ? `${scopedKey}#w512` : scopedKey
  const entries = photoCacheIndex()
  const hit = entries.find((item) => item.key === fullKey)
  if (!hit) return ''
  try {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager()
    if (fs && fs.accessSync) fs.accessSync(hit.path)
    return hit.path
  } catch (_) {
    persistPhotoCacheIndex(entries.filter((item) => item.key !== fullKey))
    return ''
  }
}

function removeCachedPhotos(fullKeys) {
  const targets = new Set((fullKeys || []).filter(Boolean))
  if (!targets.size) return
  targets.forEach((key) => {
    photoCacheGenerations[key] = Number(photoCacheGenerations[key] || 0) + 1
    photoCacheGenerations[`${key}#w512`] = Number(photoCacheGenerations[`${key}#w512`] || 0) + 1
  })
  photoDownloads.forEach((item, requestKey) => {
    const originalKey = item.cacheKey.replace(/#w512$/, '')
    if (targets.has(item.cacheKey) || targets.has(originalKey)) photoDownloads.delete(requestKey)
  })
  const entries = photoCacheIndex()
  entries.forEach((item) => {
    if (targets.has(item.key) || targets.has(item.key.replace(/#w512$/, ''))) deleteCachedPhotoFile(item.path)
  })
  persistPhotoCacheIndex(entries.filter((item) => !targets.has(item.key) && !targets.has(item.key.replace(/#w512$/, ''))))
}

function persistDownloadedPhoto(fullKey, tempFilePath, generation) {
  return new Promise((resolve) => {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager()
    const saveFile = fs && fs.saveFile ? fs.saveFile.bind(fs) : wx.saveFile
    if (!saveFile) {
      resolve(tempFilePath)
      return
    }
    saveFile({
      tempFilePath,
      success: (res) => {
        const savedPath = res.savedFilePath || res.tempFilePath || tempFilePath
        if (Number(photoCacheGenerations[fullKey] || 0) !== generation) {
          deleteCachedPhotoFile(savedPath)
          resolve('')
          return
        }
        const entries = photoCacheIndex()
        const previous = entries.find((item) => item.key === fullKey)
        const next = entries.filter((item) => item.key !== fullKey)
        next.push({ key: fullKey, path: savedPath, at: Date.now() })
        next.sort((left, right) => Number(right.at || 0) - Number(left.at || 0))
        const kept = next.slice(0, PHOTO_CACHE_LIMIT)
        next.slice(PHOTO_CACHE_LIMIT).forEach((item) => deleteCachedPhotoFile(item.path))
        if (previous && previous.path !== savedPath) deleteCachedPhotoFile(previous.path)
        persistPhotoCacheIndex(kept)
        resolve(savedPath)
      },
      fail: () => resolve(tempFilePath)
    })
  })
}

function articlePhotoKeys(doc) {
  const parsed = article.parseDoc(doc)
  const scope = normalizePhotoScope(parsed.owner)
  const keys = new Set()
  ;(parsed.articles || []).forEach((item) => {
    article.segments(item.body).forEach((segment) => {
      if (segment.type !== 'photo') return
      const key = article.resolvePhotoKey(segment.value, parsed.photos)
      const fullKey = scopedPhotoKey(key, scope)
      if (fullKey) keys.add(fullKey)
    })
  })
  return Array.from(keys)
}

function docCacheIndex() {
  try {
    const raw = wx.getStorageSync(docCacheIndexKey())
    const values = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw
    return Array.isArray(values) ? values.filter(Boolean) : []
  } catch (_) {
    return []
  }
}

function persistDocCacheIndex(stems) {
  try {
    if (stems.length) wx.setStorageSync(docCacheIndexKey(), JSON.stringify(stems))
    else wx.removeStorageSync(docCacheIndexKey())
    return true
  } catch (_) {
    return false
  }
}

function cacheDoc(stem, doc) {
  if (!stem || !doc || typeof wx === 'undefined' || !wx.setStorageSync) return null
  let raw
  let parsed
  try {
    raw = typeof doc === 'string' ? doc : JSON.stringify(doc)
    parsed = article.parseDoc(typeof doc === 'string' ? JSON.parse(doc || '{}') : doc)
  } catch (_) {
    return null
  }
  if (!parsed || !parsed.articles || !parsed.articles.length) return null
  const previous = cachedDoc(stem)
  let candidates = docCacheIndex().filter((value) => value !== stem)
  const overflow = Math.max(0, candidates.length - DOC_CACHE_LIMIT + 1)
  if (overflow > 0) {
    removeCachedDocs(candidates.slice(0, overflow))
    candidates = docCacheIndex().filter((value) => value !== stem)
  }
  while (true) {
    let wroteDoc = false
    try {
      wx.setStorageSync(docCacheKey(stem), raw)
      wroteDoc = true
      if (!persistDocCacheIndex(candidates.concat(stem))) throw new Error('doc cache index write failed')
      const nextPhotos = new Set(articlePhotoKeys(parsed))
      removeCachedPhotos(articlePhotoKeys(previous).filter((key) => !nextPhotos.has(key)))
      return parsed
    } catch (_) {
      if (wroteDoc) {
        try { wx.removeStorageSync(docCacheKey(stem)) } catch (_) {}
      }
      if (!candidates.length) return null
      removeCachedDocs([candidates[0]])
      candidates = docCacheIndex().filter((value) => value !== stem)
    }
  }
}

function cachedDoc(stem) {
  if (!stem || typeof wx === 'undefined' || !wx.getStorageSync) return null
  try {
    const raw = wx.getStorageSync(docCacheKey(stem))
    if (!raw) return null
    const parsed = article.parseDoc(typeof raw === 'string' ? JSON.parse(raw) : raw)
    return parsed && parsed.articles && parsed.articles.length ? parsed : null
  } catch (_) {
    return null
  }
}

function removeCachedDocs(stems) {
  if (typeof wx === 'undefined' || !wx.removeStorageSync) return
  const existing = docCacheIndex()
  const targets = Array.isArray(stems) && stems.length ? stems : existing
  targets.forEach((stem) => {
    const cached = cachedDoc(stem)
    removeCachedPhotos(articlePhotoKeys(cached))
    try { wx.removeStorageSync(docCacheKey(stem)) } catch (_) {}
  })
  const remaining = existing.filter((stem) => !targets.includes(stem))
  persistDocCacheIndex(remaining)
}

function invalidateDocFetches(stems) {
  const requested = Array.isArray(stems) ? stems.filter(Boolean) : []
  const targets = requested.length
    ? requested
    : Array.from(new Set(docCacheIndex().concat(
      Array.from(docFetches.values()).map((item) => item.stem)
    )))
  targets.forEach((stem) => {
    const requestKey = docRequestKey(stem)
    docCacheGenerations[requestKey] = Number(docCacheGenerations[requestKey] || 0) + 1
    docFetches.delete(requestKey)
  })
}

function invalidateArticleCaches(stems, options) {
  ensureMetaCache()
  const values = Array.isArray(stems) ? stems : []
  if (!values.length) {
    const keys = new Set([
      ...Object.keys(titleCache),
      ...Object.keys(tagsCache),
      ...Object.keys(coverCache)
    ])
    keys.forEach((key) => staleMetaKeys.add(key))
  } else {
    for (const stem of values) {
      const key = recording.articleKey(stem)
      staleMetaKeys.add(key)
    }
  }
  persistMetaCache()
  if (!(options && options.keepDoc)) {
    invalidateDocFetches(values)
    removeCachedDocs(values)
  }
}

async function deleteRecording(rec) {
  const keys = [rec.audioName, recording.articleKey(rec.stem), recording.srtKey(rec.stem), recording.emptyKey(rec.stem), recording.tagsKey(rec.stem)]
  const results = await Promise.all(keys.map((key) => http.del(`${api.filesBase()}/file/${api.path(key)}`, auth.bearer()).catch(() => ({ statusCode: 500 }))))
  const ok = recordingDeleteSucceeded(
    httpOk(results[0]),
    httpOk(results[1]),
    httpOk(results[2]),
    httpOk(results[3])
  )
  if (ok) {
    invalidateArticleCaches([rec.stem])
    removeCachedAudio([rec.audioName])
    removeRecordingFromSnapshot(rec.audioName)
  }
  return ok
}

async function deleteArticle(rec) {
  const keys = [recording.articleKey(rec.stem), recording.srtKey(rec.stem), recording.emptyKey(rec.stem), recording.tagsKey(rec.stem)]
  await Promise.all(keys.map((key) => http.del(`${api.filesBase()}/file/${api.path(key)}`, auth.bearer()).catch(() => null)))
  invalidateArticleCaches([rec.stem])
  updateRecordingSnapshot(rec.stem, { hasArticles: false, isEmpty: false })
  return true
}

async function deleteAccount() {
  const res = await http.postJson(`${api.filesBase()}/account/delete`, auth.bearer())
  const ok = res.statusCode >= 200 && res.statusCode < 300
  if (ok) clearLocalLibraryCaches()
  return ok
}

function clearLocalLibraryCaches() {
  invalidateDocFetches([])
  removeCachedDocs([])
  removeCachedPhotos(photoCacheIndex().map((item) => item.key))
  removeCachedAudio([])
  try {
    wx.removeStorageSync(listCacheKey())
    wx.removeStorageSync(`${META_CACHE_PREFIX}${docCacheIdentity()}`)
  } catch (_) {
  }
  metaCacheIdentity = ''
  titleCache = {}
  tagsCache = {}
  coverCache = {}
  staleMetaKeys = new Set()
  cachedScope = ''
  cachedScopeToken = ''
  missingPhotoThumbnails = new Set()
}

async function shareUrl(rec, section) {
  const res = await http.get(`${api.filesBase()}/share/${api.path(recording.articleKey(rec.stem))}`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300 || !res.data || !res.data.url) return ''
  return `${res.data.url}?s=${section || 0}`
}

async function publishWechat(rec) {
  const res = await http.postJson(`${api.filesBase()}/wechat/${api.path(recording.articleKey(rec.stem))}`, auth.bearer(), {})
  if (res.statusCode === 409) return { ok: false, notConfigured: true, message: '请先配置公众号' }
  if (res.statusCode >= 200 && res.statusCode < 300) {
    return { ok: true, created: res.data && res.data.created || 0, updated: res.data && res.data.updated || 0 }
  }
  return {
    ok: false,
    errcode: res.data && res.data.errcode,
    message: article.wechatMessage(res.data && res.data.errcode, res.data && res.data.errmsg)
  }
}

function httpOk(res) {
  return Boolean(res && res.statusCode >= 200 && res.statusCode < 300)
}

function recordingDeleteSucceeded(audioDeleted) {
  return Boolean(audioDeleted)
}

function wechatPublishIsConfigError(result) {
  const errcode = result && result.errcode
  return Boolean(result && result.notConfigured) || errcode === 40164 || errcode === 40125 || errcode === 40013
}

async function restyle(rec, styleVersion) {
  const result = await restyleResult(rec, styleVersion)
  return result.ok
}

async function restyleResult(rec, styleVersion) {
  const body = restyleRequestBody(rec.stem, styleVersion)
  const res = await http.postJson(`${api.agentBase()}/restyle`, auth.bearer(), body, { timeout: 300000 })
  const ok = res.statusCode >= 200 && res.statusCode < 300 && (!res.data || res.data.ok !== false)
  if (ok) invalidateArticleCaches([rec.stem])
  return {
    ok,
    statusCode: res.statusCode,
    data: res.data,
    message: restyleErrorMessage(res)
  }
}

function restyleErrorMessage(res) {
  if (!res || (res.statusCode >= 200 && res.statusCode < 300 && (!res.data || res.data.ok !== false))) return ''
  const data = res && res.data
  const detail = data && typeof data === 'object'
    ? data.reason || data.error || data.message || ''
    : String(data || '').trim()
  const status = res && res.statusCode ? `HTTP ${res.statusCode}` : '请求失败'
  return detail ? `${status}: ${detail}` : status
}

function restyleRequestBody(stem, styleVersion) {
  const body = { stem }
  if (styleVersion != null) body.styleV = styleVersion
  return body
}

async function versionHistory(rec) {
  const res = await http.get(`${api.filesBase()}/articles/${api.path(rec.stem)}/history`, auth.bearer())
  return res.statusCode >= 200 && res.statusCode < 300 ? res.data : { versions: [], head: 0 }
}

async function patchHead(rec, head) {
  const res = await http.patchJson(`${api.filesBase()}/articles/${api.path(rec.stem)}/head`, auth.bearer(), { head })
  const ok = res.statusCode >= 200 && res.statusCode < 300
  if (ok) invalidateArticleCaches([rec.stem])
  return ok
}

async function saveDoc(stem, doc) {
  const res = await http.putJson(`${api.filesBase()}/articles/${api.path(stem)}`, auth.bearer(), doc)
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`保存文章失败 HTTP ${res.statusCode}`)
  invalidateArticleCaches([stem])
  const saved = await fetchDoc(stem)
  const fallback = !(saved && saved.articles && saved.articles.length)
  const result = fallback ? doc : saved
  cacheDoc(stem, result)
  return result
}

async function saveArticles(stem, articles) {
  const url = `${api.filesBase()}/articles/${api.path(stem)}`
  const current = await http.get(url, auth.bearer())
  if (current.statusCode < 200 || current.statusCode >= 300) throw new Error(`加载文章失败 HTTP ${current.statusCode}`)
  let raw = current.data
  if (typeof raw === 'string') raw = JSON.parse(raw || '{}')
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {}
  const previousArticles = Array.isArray(raw.articles) ? raw.articles : []
  const nextArticles = (articles || []).map((item, index) => Object.assign({}, previousArticles[index] || {}, item || {}))
  const payload = Object.assign({}, raw, { articles: nextArticles })
  const saved = await http.putJson(url, auth.bearer(), payload)
  if (saved.statusCode < 200 || saved.statusCode >= 300) throw new Error(`保存文章失败 HTTP ${saved.statusCode}`)
  invalidateArticleCaches([stem])
  return cacheDoc(stem, payload) || article.parseDoc(payload)
}

function downloadTempFile(key) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: api.downloadUrl(key),
      header: http.authHeader(auth.bearer()),
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.tempFilePath)
        else reject(new Error(`download HTTP ${res.statusCode}`))
      },
      fail: reject
    })
  })
}

function downloadAudioFile(key) {
  const normalizedKey = String(key || '').trim()
  if (!normalizedKey) return Promise.reject(new Error('audio key required'))
  const identity = docCacheIdentity()
  const cachedPath = cachedAudioPath(normalizedKey, identity)
  if (cachedPath) return Promise.resolve(cachedPath)
  const generationKey = `${identity}:${normalizedKey}`
  const existing = audioDownloads.get(generationKey)
  if (existing) return existing
  const generation = Number(audioCacheGenerations[generationKey] || 0)
  const promise = downloadTempFile(normalizedKey)
    .then((tempFilePath) => persistDownloadedAudio(
      normalizedKey,
      tempFilePath,
      generation,
      identity
    ))
  audioDownloads.set(generationKey, promise)
  return promise.finally(() => {
    if (audioDownloads.get(generationKey) === promise) audioDownloads.delete(generationKey)
  })
}

function downloadPhotoTemp(key, scope, options) {
  const scopedKey = scopedPhotoKey(key, scope)
  const preferThumb = Boolean(options && options.preferThumb)
  const cacheKey = preferThumb ? `${scopedKey}#w512` : scopedKey
  const generation = Number(photoCacheGenerations[cacheKey] || 0)
  const cachedPath = !(options && options.cacheBust) ? cachedPhotoPath(cacheKey) : ''
  if (cachedPath) return Promise.resolve(cachedPath)
  const cacheBust = options && options.cacheBust
  const requestKey = `${cacheKey}:${cacheBust || ''}`
  const existing = photoDownloads.get(requestKey)
  if (existing) return existing.promise
  const promise = new Promise((resolve, reject) => {
    const originalUrls = [api.photoCdnUrl(scopedKey), api.photoUrl(scopedKey)]
    const thumbnailUrls = preferThumb && !missingPhotoThumbnails.has(scopedKey)
      ? [api.photoThumbnailUrl(scopedKey)] : []
    const urls = Array.from(new Set(thumbnailUrls.concat(originalUrls)))
      .map((baseUrl) => cacheBust ? `${baseUrl}?v=${encodeURIComponent(cacheBust)}` : baseUrl)
    const attempt = (index, previousError) => {
      const url = urls[index]
      logPhotoUpload('download-photo-start', { key, scope, scopedKey, url, authenticated: false, fallback: index > 0 })
      wx.downloadFile({
        url,
        // 照片读取是公开接口。不要把用户 Token 带到 CDN，避免鉴权头降低缓存命中率；
        // 保留平台标识用于后端诊断。
        header: http.authHeader(''),
        success: (res) => {
          logPhotoUpload('download-photo-response', { key, scope, scopedKey, url, statusCode: res.statusCode, tempFilePath: res.tempFilePath || '' })
          if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
            const fetchedThumbnail = index < thumbnailUrls.length
            persistDownloadedPhoto(fetchedThumbnail ? cacheKey : scopedKey, res.tempFilePath, generation).then(resolve)
            return
          }
          if (index < thumbnailUrls.length) missingPhotoThumbnails.add(scopedKey)
          const error = new Error(`photo download HTTP ${res.statusCode}`)
          if (index + 1 < urls.length) attempt(index + 1, error)
          else reject(previousError || error)
        },
        fail: (error) => {
          logPhotoUpload('download-photo-fail', { key, scope, scopedKey, url, error })
          if (index < thumbnailUrls.length) missingPhotoThumbnails.add(scopedKey)
          if (index + 1 < urls.length) attempt(index + 1, error)
          else reject(previousError || error)
        }
      })
    }
    attempt(0)
  })
  photoDownloads.set(requestKey, { cacheKey, promise })
  return promise.finally(() => {
    const current = photoDownloads.get(requestKey)
    if (current && current.promise === promise) photoDownloads.delete(requestKey)
  })
}

async function ownerScope(options) {
  const anonymous = Boolean(options && options.anonymous)
  const token = anonymous && auth.anonymousBearer ? auth.anonymousBearer() : auth.bearer()
  if (!anonymous && cachedScope && cachedScopeToken === token) return cachedScope
  const res = await http.get(`${api.filesBase()}/whoami`, token)
  if (res.statusCode < 200 || res.statusCode >= 300) return ''
  const scope = normalizePhotoScope(res.data && res.data.scope)
  if (!anonymous) {
    cachedScope = scope
    cachedScopeToken = token
  }
  return scope
}

function normalizePhotoScope(scope) {
  const value = String(scope || '').trim()
  if (!value) return ''
  return value.endsWith('/') ? value : `${value}/`
}

function scopedPhotoKey(key, scope) {
  const photoKey = String(key || '').trim()
  if (!photoKey) return ''
  const normalizedScope = normalizePhotoScope(scope)
  return normalizedScope ? `${normalizedScope}${photoKey}` : photoKey
}

function photoUrl(key, scope) {
  return api.photoUrl(scopedPhotoKey(key, scope))
}

function photoUploadError(message, details) {
  const err = new Error(message)
  err.details = details || {}
  return err
}

function logPhotoUpload(stage, details) {
  if (typeof console === 'undefined' || !console.log) return
  try {
    console.log('[VoiceDrop photo upload]', stage, details || {})
  } catch (_) {
  }
}

function shouldSaveTempBeforeRead(filePath, error) {
  const message = error && (error.errMsg || error.message) || ''
  return /^http:\/\/tmp\//.test(String(filePath || '')) && /not found|fail/i.test(message)
}

function saveTempFile(filePath, key) {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager()
    const saveFile = fs && fs.saveFile ? fs.saveFile.bind(fs) : wx.saveFile
    if (!saveFile) {
      reject(photoUploadError('saveFile unavailable', { filePath, key }))
      return
    }
    logPhotoUpload('save-temp-start', { filePath, key })
    saveFile({
      tempFilePath: filePath,
      success: (res) => {
        const savedPath = res.savedFilePath || res.tempFilePath || ''
        logPhotoUpload('save-temp-success', { filePath, key, savedPath })
        if (savedPath) resolve(savedPath)
        else reject(photoUploadError('saveFile returned empty path', { filePath, key, res }))
      },
      fail: (error) => {
        logPhotoUpload('save-temp-fail', { filePath, key, error })
        reject(photoUploadError(error && error.errMsg || 'save file fail', { filePath, key, error }))
      }
    })
  })
}

function uploadPhoto(filePath, key) {
  return uploadPhotoRaw(filePath, key)
}

function uploadPhotoFile(filePath, key) {
  return new Promise((resolve, reject) => {
    const url = `${api.filesBase()}/upload/${api.path(key)}`
    logPhotoUpload('upload-file-start', { filePath, key, url, hasToken: !!auth.bearer() })
    wx.uploadFile({
      method: 'PUT',
      url,
      filePath,
      name: 'file',
      formData: { key },
      header: http.authHeader(auth.bearer()),
      success: (res) => {
        logPhotoUpload('upload-file-response', { key, statusCode: res.statusCode, data: res.data })
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(true)
        else reject(photoUploadError(`HTTP ${res.statusCode}`, { key, url, statusCode: res.statusCode, data: res.data }))
      },
      fail: (error) => {
        logPhotoUpload('upload-file-fail', { key, url, filePath, error })
        reject(photoUploadError(error && error.errMsg || 'upload file fail', { key, url, filePath, error }))
      }
    })
  })
}

function uploadPhotoRaw(filePath, key) {
  return new Promise((resolve, reject) => {
    const url = `${api.filesBase()}/upload/${api.path(key)}`
    logPhotoUpload('raw-start', { filePath, key, url, hasToken: !!auth.bearer() })
    const fs = wx.getFileSystemManager()
    const uploadBytes = (data, readPath) => {
      const size = data && data.byteLength != null ? data.byteLength : 0
      logPhotoUpload('read', { filePath: readPath, originalPath: filePath, key, size })
      wx.request({
        method: 'PUT',
        url,
        data,
        header: http.authHeader(auth.bearer(), { 'content-type': imageContentType(data, key) }),
        success: (res) => {
          logPhotoUpload('response', { key, statusCode: res.statusCode, data: res.data })
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(true)
          else reject(photoUploadError(`HTTP ${res.statusCode}`, { key, url, statusCode: res.statusCode, data: res.data }))
        },
        fail: (error) => {
          logPhotoUpload('request-fail', { key, url, error })
          reject(photoUploadError(error && error.errMsg || 'upload fail', { key, url, error }))
        }
      })
    }
    const readAndUpload = (readPath, originalError) => {
      fs.readFile({
        filePath: readPath,
        success: (file) => uploadBytes(file.data, readPath),
        fail: async (error) => {
          logPhotoUpload('read-fail', { filePath: readPath, originalPath: filePath, key, error })
          if (!originalError && shouldSaveTempBeforeRead(readPath, error)) {
            try {
              const savedPath = await saveTempFile(readPath, key)
              readAndUpload(savedPath, error)
            } catch (saveError) {
              reject(saveError)
            }
            return
          }
          reject(photoUploadError(error && error.errMsg || 'read file fail', { filePath: readPath, originalPath: filePath, key, error, originalError }))
        }
      })
    }
    readAndUpload(filePath)
  })
}

function imageContentType(data, fallbackPath = '') {
  const b = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data && data.buffer || [])
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  if (/\.jpe?g$/i.test(fallbackPath)) return 'image/jpeg'
  if (/\.png$/i.test(fallbackPath)) return 'image/png'
  if (/\.gif$/i.test(fallbackPath)) return 'image/gif'
  if (/\.webp$/i.test(fallbackPath)) return 'image/webp'
  return 'application/octet-stream'
}

module.exports = {
  list,
  cachedRecordings,
  storeRecordingsSnapshot,
  enrichArticleMeta,
  invalidateArticleCaches,
  cacheDoc,
  cachedDoc,
  fetchDoc,
  fetchDocByArticleKey,
  deleteRecording,
  deleteArticle,
  deleteAccount,
  recordingDeleteSucceeded,
  shareUrl,
  publishWechat,
  wechatPublishIsConfigError,
  restyle,
  restyleResult,
  restyleErrorMessage,
  restyleRequestBody,
  versionHistory,
  patchHead,
  saveDoc,
  saveArticles,
  ownerScope,
  normalizePhotoScope,
  scopedPhotoKey,
  uploadPhoto,
  imageContentType,
  downloadTempFile,
  downloadAudioFile,
  cachedAudioPath,
  removeCachedAudio,
  downloadPhotoTemp,
  cachedPhotoPath,
  removeCachedPhotos,
  photoUrl
}
