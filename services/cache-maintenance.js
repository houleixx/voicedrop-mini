const CLEARABLE_PREFIXES = [
  'voicedrop.books.shelf.v1',
  'voicedrop.library.meta.v1.',
  'voicedrop.library.list.v1.',
  'voicedrop.library.doc.v1.',
  'voicedrop.library.doc-index.v1.',
  'voicedrop.library.photo-index.v1.',
  'voicedrop.community.detail.v1.',
  'voicedrop.community.detail-index.v1.'
]
const PHOTO_INDEX_PREFIX = 'voicedrop.library.photo-index.v1.'
const AUDIO_INDEX_PREFIX = 'voicedrop.library.audio-index.v1.'
const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|gif|heic)(?:$|[?#])/i

function isClearableStorageKey(key) {
  const value = String(key || '')
  return CLEARABLE_PREFIXES.some((prefix) => value.startsWith(prefix))
}

function utf8ByteLength(value) {
  const text = String(value == null ? '' : value)
  let bytes = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length &&
        text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

function serialized(value) {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value == null ? '' : value) }
  catch (_) { return '' }
}

function indexedPaths(value) {
  try {
    const entries = typeof value === 'string' ? JSON.parse(value || '[]') : value
    return Array.isArray(entries)
      ? entries.map((entry) => String(entry && entry.path || '')).filter(Boolean)
      : []
  } catch (_) {
    return []
  }
}

function isPhotoKey(key) {
  const value = String(key || '').replace(/#w512$/, '')
  return /(?:^|\/)photos\//.test(value) && IMAGE_EXTENSION.test(value)
}

function isManagedImagePath(path, userDataPath) {
  const value = String(path || '')
  if (!value || value.includes('\0') || value.split(/[\\/]/).includes('..') || !IMAGE_EXTENSION.test(value)) return false
  if (/^wxfile:\/\//.test(value) || /^http:\/\/usr\//.test(value)) return true
  const root = String(userDataPath || '').replace(/\/$/, '')
  return Boolean(root && value.startsWith(`${root}/`))
}

function photoPaths(key, value, options) {
  if (!String(key || '').startsWith(PHOTO_INDEX_PREFIX)) return []
  const opts = options || {}
  const denied = opts.deniedPaths instanceof Set ? opts.deniedPaths : new Set(opts.deniedPaths || [])
  try {
    const entries = typeof value === 'string' ? JSON.parse(value || '[]') : value
    return Array.isArray(entries)
      ? entries.filter((entry) => isPhotoKey(entry && entry.key))
        .map((entry) => String(entry && entry.path || ''))
        .filter((path) => isManagedImagePath(path, opts.userDataPath) && !denied.has(path))
      : []
  } catch (_) {
    return []
  }
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${formatUnit(value / 1024)} KB`
  if (value < 1024 * 1024 * 1024) return `${formatUnit(value / (1024 * 1024))} MB`
  return `${formatUnit(value / (1024 * 1024 * 1024))} GB`
}

function formatUnit(value) {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '')
}

function storageEntries(api) {
  if (!api || typeof api.getStorageInfoSync !== 'function' || typeof api.getStorageSync !== 'function') return []
  try {
    const info = api.getStorageInfoSync() || {}
    return (Array.isArray(info.keys) ? info.keys : [])
      .filter(isClearableStorageKey)
      .map((key) => ({ key, value: api.getStorageSync(key) }))
  } catch (_) {
    return []
  }
}

function deniedAudioPaths(api) {
  if (!api || typeof api.getStorageInfoSync !== 'function' || typeof api.getStorageSync !== 'function') return new Set()
  try {
    const info = api.getStorageInfoSync() || {}
    const paths = (Array.isArray(info.keys) ? info.keys : [])
      .filter((key) => String(key).startsWith(AUDIO_INDEX_PREFIX))
      .flatMap((key) => indexedPaths(api.getStorageSync(key)))
    return new Set(paths)
  } catch (_) {
    return new Set()
  }
}

function fileSize(fs, path) {
  if (!fs || !path) return Promise.resolve(0)
  if (typeof fs.statSync === 'function') {
    try {
      const result = fs.statSync(path)
      return Promise.resolve(Math.max(0, Number(result && result.size) || 0))
    } catch (_) {
      return Promise.resolve(0)
    }
  }
  if (typeof fs.stat !== 'function') return Promise.resolve(0)
  return new Promise((resolve) => {
    fs.stat({
      path,
      success: (result) => resolve(Math.max(0, Number(result && result.stats && result.stats.size) || 0)),
      fail: () => resolve(0)
    })
  })
}

function unlink(fs, path) {
  if (!fs || !path) return Promise.resolve()
  if (typeof fs.unlinkSync === 'function') {
    try { fs.unlinkSync(path) } catch (_) {}
    return Promise.resolve()
  }
  if (typeof fs.unlink !== 'function') return Promise.resolve()
  return new Promise((resolve) => fs.unlink({ filePath: path, success: resolve, fail: resolve }))
}

function create(dependencies) {
  const deps = dependencies || {}
  const api = deps.wxApi || (typeof wx === 'undefined' ? null : wx)
  const resetLibrary = deps.resetLibrary || (() => require('./library').resetRebuildableCacheState())
  const resetCommunity = deps.resetCommunity || (() => require('./community').resetDetailCacheState())

  async function snapshot() {
    const entries = storageEntries(api)
    const options = {
      deniedPaths: deniedAudioPaths(api),
      userDataPath: api && api.env && api.env.USER_DATA_PATH
    }
    const paths = Array.from(new Set(entries.flatMap((entry) => photoPaths(entry.key, entry.value, options))))
    const storageBytes = entries.reduce((sum, entry) => sum + utf8ByteLength(serialized(entry.value)), 0)
    let fileBytes = 0
    const fs = api && api.getFileSystemManager ? api.getFileSystemManager() : null
    for (const path of paths) fileBytes += await fileSize(fs, path)
    return { bytes: storageBytes + fileBytes, storageBytes, fileBytes, entries, paths }
  }

  async function clear() {
    resetLibrary()
    resetCommunity()
    const before = await snapshot()
    const fs = api && api.getFileSystemManager ? api.getFileSystemManager() : null
    await Promise.all(before.paths.map((path) => unlink(fs, path)))
    if (api && typeof api.removeStorageSync === 'function') {
      before.entries.forEach((entry) => {
        try { api.removeStorageSync(entry.key) } catch (_) {}
      })
    }
    return before
  }

  return { snapshot, clear }
}

const instance = create()

module.exports = {
  CLEARABLE_PREFIXES,
  PHOTO_INDEX_PREFIX,
  AUDIO_INDEX_PREFIX,
  isClearableStorageKey,
  isPhotoKey,
  isManagedImagePath,
  utf8ByteLength,
  formatBytes,
  photoPaths,
  create,
  snapshot: instance.snapshot,
  clear: instance.clear
}
