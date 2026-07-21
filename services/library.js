const api = require('./api')
const auth = require('./auth')
const http = require('./request')
const article = require('../utils/article')
const recording = require('../utils/recording')

const META_CACHE_PREFIX = 'voicedrop.library.meta.v1.'
const META_CONCURRENCY = 5
let metaCacheIdentity = ''
let titleCache = {}
let tagsCache = {}
let coverCache = {}
let cachedScope = ''
let cachedScopeToken = ''

async function list() {
  ensureMetaCache()
  let records = await indexedRecordings().catch(() => null)
  if (!records) records = await legacyRecordings()
  records.sort((a, b) => (b.uploaded || '').localeCompare(a.uploaded || '') || b.audioName.localeCompare(a.audioName))
  applyCachedArticleMeta(records)
  return records
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
  const res = await http.get(`${api.filesBase()}/articles/${api.path(stem)}`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) return null
  return article.parseDoc(typeof res.data === 'string' ? res.data : res.data)
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
  return Object.prototype.hasOwnProperty.call(titleCache, key) &&
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
  return auth.anonId ? auth.anonId() : 'default'
}

function ensureMetaCache() {
  const identity = metaIdentity()
  if (identity === metaCacheIdentity) return
  metaCacheIdentity = identity
  titleCache = {}
  tagsCache = {}
  coverCache = {}
  try {
    const raw = wx.getStorageSync(`${META_CACHE_PREFIX}${identity}`)
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {}
    titleCache = parsed.titles && typeof parsed.titles === 'object' ? parsed.titles : {}
    tagsCache = parsed.tags && typeof parsed.tags === 'object' ? parsed.tags : {}
    coverCache = parsed.covers && typeof parsed.covers === 'object' ? parsed.covers : {}
  } catch (_) {
  }
}

function persistMetaCache() {
  if (!metaCacheIdentity) return
  try {
    wx.setStorageSync(`${META_CACHE_PREFIX}${metaCacheIdentity}`, JSON.stringify({
      titles: titleCache,
      tags: tagsCache,
      covers: coverCache
    }))
  } catch (_) {
  }
}

function invalidateArticleCaches(stems) {
  ensureMetaCache()
  const values = Array.isArray(stems) ? stems : []
  if (!values.length) {
    titleCache = {}
    tagsCache = {}
    coverCache = {}
  } else {
    for (const stem of values) {
      const key = recording.articleKey(stem)
      delete titleCache[key]
      delete tagsCache[key]
      delete coverCache[key]
    }
  }
  persistMetaCache()
}

async function deleteRecording(rec) {
  const keys = [rec.audioName, recording.articleKey(rec.stem), recording.srtKey(rec.stem), recording.emptyKey(rec.stem), recording.tagsKey(rec.stem)]
  const results = await Promise.all(keys.map((key) => http.del(`${api.filesBase()}/file/${api.path(key)}`, auth.bearer()).catch(() => ({ statusCode: 500 }))))
  return recordingDeleteSucceeded(
    httpOk(results[0]),
    httpOk(results[1]),
    httpOk(results[2]),
    httpOk(results[3])
  )
}

async function deleteArticle(rec) {
  const keys = [recording.articleKey(rec.stem), recording.srtKey(rec.stem), recording.emptyKey(rec.stem), recording.tagsKey(rec.stem)]
  await Promise.all(keys.map((key) => http.del(`${api.filesBase()}/file/${api.path(key)}`, auth.bearer()).catch(() => null)))
  invalidateArticleCaches([rec.stem])
  return true
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
  const res = await http.postJson(`${api.agentBase()}/restyle`, auth.bearer(), body)
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
  return res.statusCode >= 200 && res.statusCode < 300
}

async function saveDoc(stem, doc) {
  const res = await http.putJson(`${api.filesBase()}/articles/${api.path(stem)}`, auth.bearer(), doc)
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`保存文章失败 HTTP ${res.statusCode}`)
  const saved = await fetchDoc(stem)
  const fallback = !(saved && saved.articles && saved.articles.length)
  invalidateArticleCaches([stem])
  return fallback ? doc : saved
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
  return article.parseDoc(payload)
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

function downloadPhotoTemp(key, scope, options) {
  const scopedKey = scopedPhotoKey(key, scope)
  return new Promise((resolve, reject) => {
    const cacheBust = options && options.cacheBust
    const urls = [api.photoCdnUrl(scopedKey), api.photoUrl(scopedKey)]
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
            resolve(res.tempFilePath)
            return
          }
          const error = new Error(`photo download HTTP ${res.statusCode}`)
          if (index + 1 < urls.length) attempt(index + 1, error)
          else reject(previousError || error)
        },
        fail: (error) => {
          logPhotoUpload('download-photo-fail', { key, scope, scopedKey, url, error })
          if (index + 1 < urls.length) attempt(index + 1, error)
          else reject(previousError || error)
        }
      })
    }
    attempt(0)
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
        header: http.authHeader(auth.bearer(), { 'content-type': 'image/jpeg' }),
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

module.exports = {
  list,
  enrichArticleMeta,
  invalidateArticleCaches,
  fetchDoc,
  fetchDocByArticleKey,
  deleteRecording,
  deleteArticle,
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
  downloadTempFile,
  downloadPhotoTemp,
  photoUrl
}
