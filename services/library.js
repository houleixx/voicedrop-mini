const api = require('./api')
const auth = require('./auth')
const http = require('./request')
const article = require('../utils/article')
const recording = require('../utils/recording')

const titleCache = {}
const tagsCache = {}
let cachedScope = ''
let cachedScopeToken = ''

async function list() {
  const res = await http.get(`${api.filesBase()}/list`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`加载失败 HTTP ${res.statusCode}`)
  const files = (res.data && res.data.files) || []
  const names = new Set(files.map((item) => item.name))
  const records = files
    .filter((item) => recording.isRecordingFile(item.name && item.name.split('/').pop()))
    .map((item) => recording.fromRemoteFile(item, names))
    .sort((a, b) => (b.uploaded || '').localeCompare(a.uploaded || '') || b.audioName.localeCompare(a.audioName))
  await fillArticleMeta(records)
  return records
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

async function fillArticleMeta(records) {
  await Promise.all((records || []).map(async (rec) => {
    if (!rec || !rec.hasArticles) return
    const key = recording.articleKey(rec.stem)
    if (!rec.articleTitle && titleCache[key]) rec.articleTitle = titleCache[key]
    if (rec.articleTitle && rec.tags && rec.tags.length) {
      rec.rowTitle = recording.rowTitle(rec)
      return
    }
    const doc = await fetchDoc(rec.stem).catch(() => null)
    if (!doc) return
    if (!rec.articleTitle && doc.articles && doc.articles.length) {
      rec.articleTitle = doc.articles[0].title || ''
      if (rec.articleTitle) titleCache[key] = rec.articleTitle
    }
    if (Array.isArray(doc.tags)) {
      rec.tags = doc.tags
      if (doc.tags.length) tagsCache[key] = doc.tags
      else delete tagsCache[key]
    } else if ((!rec.tags || !rec.tags.length) && tagsCache[key]) {
      rec.tags = tagsCache[key]
    }
    rec.rowTitle = recording.rowTitle(rec)
  }))
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
  return fallback ? doc : saved
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
    const baseUrl = api.photoUrl(scopedKey)
    const cacheBust = options && options.cacheBust
    const url = cacheBust ? `${baseUrl}?v=${encodeURIComponent(cacheBust)}` : baseUrl
    logPhotoUpload('download-photo-start', { key, scope, scopedKey, url, hasToken: !!auth.bearer() })
    wx.downloadFile({
      url,
      header: http.authHeader(auth.bearer()),
      success: (res) => {
        logPhotoUpload('download-photo-response', { key, scope, scopedKey, statusCode: res.statusCode, tempFilePath: res.tempFilePath || '' })
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) resolve(res.tempFilePath)
        else reject(new Error(`photo download HTTP ${res.statusCode}`))
      },
      fail: (error) => {
        logPhotoUpload('download-photo-fail', { key, scope, scopedKey, error })
        reject(error)
      }
    })
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
  ownerScope,
  normalizePhotoScope,
  scopedPhotoKey,
  uploadPhoto,
  downloadTempFile,
  downloadPhotoTemp,
  photoUrl
}
