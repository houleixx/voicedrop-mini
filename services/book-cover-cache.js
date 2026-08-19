const STORAGE_KEY = 'voicedrop.books.cover-files.v1'
const RETRY_DELAYS_MS = [2000, 4000, 8000]
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1

function cacheKey(book) {
  const slug = String(book && book.slug || '')
  const version = Math.max(0, Number(book && book.coverAt) || 0)
  return `${slug}:${version}`
}

function hash(value) {
  let result = 2166136261
  for (const character of String(value || '')) {
    result ^= character.charCodeAt(0)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(16).padStart(8, '0')
}

function defaultRuntime() {
  const platform = typeof wx === 'undefined' ? {} : wx
  const fileSystem = typeof platform.getFileSystemManager === 'function'
    ? platform.getFileSystemManager()
    : null
  return {
    userDataPath: platform.env && platform.env.USER_DATA_PATH || '',
    getStorageSync: (key) => platform.getStorageSync && platform.getStorageSync(key),
    setStorageSync: (key, value) => platform.setStorageSync && platform.setStorageSync(key, value),
    accessSync: (filePath) => fileSystem && fileSystem.accessSync(filePath),
    saveFile: (options) => fileSystem && fileSystem.saveFile(options),
    unlink: (options) => fileSystem && fileSystem.unlink(options),
    downloadFile: (options) => platform.downloadFile && platform.downloadFile(options),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (id) => clearTimeout(id)
  }
}

function manifestFor(runtime) {
  try {
    const value = runtime.getStorageSync(STORAGE_KEY)
    if (value && typeof value === 'object' && value.entries && typeof value.entries === 'object') {
      return { entries: Object.assign({}, value.entries), slugs: Object.assign({}, value.slugs || {}) }
    }
  } catch (_) {}
  return { entries: {}, slugs: {} }
}

function createSession(runtime, onReady) {
  const api = runtime || defaultRuntime()
  const ready = typeof onReady === 'function' ? onReady : () => {}
  const manifest = manifestFor(api)
  let generation = 0
  let disposed = false
  const tasks = new Set()
  const timers = new Set()
  const attemptsByKey = new Map()

  function persistManifest() {
    try { api.setStorageSync(STORAGE_KEY, manifest) } catch (_) {}
  }

  function cancelWork() {
    for (const timer of timers) {
      try { api.clearTimeout(timer) } catch (_) {}
    }
    timers.clear()
    for (const task of tasks) {
      try { task.abort() } catch (_) {}
    }
    tasks.clear()
  }

  function cachedPath(book) {
    if (!(book && book.cover)) return ''
    const key = cacheKey(book)
    const filePath = String(manifest.entries[key] || '')
    if (!filePath) return ''
    try {
      api.accessSync(filePath)
      return filePath
    } catch (_) {
      delete manifest.entries[key]
      if (manifest.slugs[book.slug] === key) delete manifest.slugs[book.slug]
      persistManifest()
      return ''
    }
  }

  function removePath(filePath) {
    if (!filePath || typeof api.unlink !== 'function') return
    try { api.unlink({ filePath, complete() {} }) } catch (_) {}
  }

  function invalidate(book) {
    const key = cacheKey(book)
    const filePath = manifest.entries[key]
    delete manifest.entries[key]
    if (manifest.slugs[book && book.slug] === key) delete manifest.slugs[book.slug]
    persistManifest()
    removePath(filePath)
  }

  function save(book, temporaryPath, expectedGeneration) {
    return new Promise((resolve) => {
      if (!api.userDataPath || typeof api.saveFile !== 'function') return resolve(temporaryPath)
      const key = cacheKey(book)
      const filePath = `${api.userDataPath}/voicedrop-book-cover-${hash(key)}.jpg`
      try {
        api.saveFile({
          tempFilePath: temporaryPath,
          filePath,
          success(result) {
            const savedPath = String(result && result.savedFilePath || filePath)
            if (disposed || generation !== expectedGeneration) {
              removePath(savedPath)
              return resolve('')
            }
            const oldKey = manifest.slugs[book.slug]
            const oldPath = oldKey && oldKey !== key ? manifest.entries[oldKey] : ''
            if (oldKey && oldKey !== key) delete manifest.entries[oldKey]
            manifest.entries[key] = savedPath
            manifest.slugs[book.slug] = key
            persistManifest()
            removePath(oldPath)
            resolve(savedPath)
          },
          fail() { resolve(temporaryPath) }
        })
      } catch (_) {
        resolve(temporaryPath)
      }
    }).then((filePath) => {
      if (filePath && !disposed && generation === expectedGeneration) ready(book.slug, cacheKey(book), filePath)
    })
  }

  function attempt(book, expectedGeneration) {
    if (disposed || generation !== expectedGeneration || typeof api.downloadFile !== 'function') return
    const key = cacheKey(book)
    const number = (attemptsByKey.get(key) || 0) + 1
    if (number > MAX_ATTEMPTS) return
    attemptsByKey.set(key, number)
    let settled = false
    let task
    const failed = () => {
      if (settled) return
      settled = true
      if (task) tasks.delete(task)
      if (disposed || generation !== expectedGeneration || number >= MAX_ATTEMPTS) return
      const timer = api.setTimeout(() => {
        timers.delete(timer)
        attempt(book, expectedGeneration)
      }, RETRY_DELAYS_MS[number - 1])
      timers.add(timer)
    }
    try {
      task = api.downloadFile({
        url: book.coverUrl,
        success(result) {
          if (settled) return
          const statusCode = Number(result && result.statusCode) || 0
          const temporaryPath = String(result && result.tempFilePath || '')
          if (statusCode < 200 || statusCode >= 300 || !temporaryPath) return failed()
          settled = true
          if (task) tasks.delete(task)
          if (disposed || generation !== expectedGeneration) return
          save(book, temporaryPath, expectedGeneration)
        },
        fail: failed
      })
      if (task && !settled) tasks.add(task)
    } catch (_) {
      failed()
    }
  }

  function load(items) {
    generation += 1
    cancelWork()
    const expectedGeneration = generation
    for (const book of items || []) {
      if (book && book.cover && book.coverUrl && !cachedPath(book)) attempt(book, expectedGeneration)
    }
  }

  function retry(book) {
    if (disposed || !(book && book.cover && book.coverUrl)) return
    invalidate(book)
    attempt(book, generation)
  }

  function decorate(items) {
    return (items || []).map((book) => Object.assign({}, book, {
      coverDisplayUrl: cachedPath(book),
      coverCacheKey: cacheKey(book)
    }))
  }

  function dispose() {
    disposed = true
    generation += 1
    cancelWork()
  }

  return { cachedPath, decorate, load, retry, invalidate, dispose }
}

module.exports = { STORAGE_KEY, RETRY_DELAYS_MS, MAX_ATTEMPTS, cacheKey, createSession }
