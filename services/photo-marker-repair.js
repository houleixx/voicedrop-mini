const library = require('./library')

const STORAGE_KEY = 'vd.pendingPhotoMarkerRepairs.v1'
let repairPromise = null

function pending() {
  try {
    const value = wx.getStorageSync(STORAGE_KEY)
    if (!Array.isArray(value)) return []
    return value
      .map((item) => ({
        name: String(item && item.name || ''),
        photoKeys: uniquePhotoKeys(item && item.photoKeys)
      }))
      .filter((item) => item.name && item.photoKeys.length)
  } catch (_) {
    return []
  }
}

function persist(items) {
  wx.setStorageSync(STORAGE_KEY, items)
}

function uniquePhotoKeys(keys) {
  return Array.from(new Set(
    (keys || [])
      .map((key) => String(key || '').trim())
      .filter((key) => /^photos\/.+\.(?:jpe?g|png)$/i.test(key))
  ))
}

function remember(name, photoKeys) {
  const cleanName = String(name || '').trim()
  const cleanKeys = uniquePhotoKeys(photoKeys)
  if (!cleanName || !cleanKeys.length) return false
  const items = pending()
  const existing = items.find((item) => item.name === cleanName)
  if (existing) existing.photoKeys = uniquePhotoKeys(existing.photoKeys.concat(cleanKeys))
  else items.push({ name: cleanName, photoKeys: cleanKeys })
  persist(items)
  return true
}

function discard(name) {
  const items = pending().filter((item) => item.name !== name)
  persist(items)
}

function photoKeysIn(articles) {
  const found = new Set()
  for (const item of articles || []) {
    const marker = /\[\[photo:([^\]]+)\]\]/g
    let match
    while ((match = marker.exec(String(item && item.body || '')))) {
      found.add(match[1].trim())
    }
  }
  return found
}

function missingPhotoKeys(articles, photoKeys) {
  const existing = photoKeysIn(articles)
  return uniquePhotoKeys(photoKeys).filter((key) => !existing.has(key))
}

function ensurePhotoMarkers(articles, photoKeys) {
  const next = (articles || []).map((item) => Object.assign({}, item))
  if (!next.length) return { articles: next, changed: false }
  const missing = missingPhotoKeys(next, photoKeys)
  if (!missing.length) return { articles: next, changed: false }
  const last = next[next.length - 1]
  const body = String(last.body || '').replace(/\s+$/, '')
  const markers = missing.map((key) => `[[photo:${key}]]`).join('\n\n')
  last.body = body ? `${body}\n\n${markers}` : markers
  return { articles: next, changed: true }
}

function stemOf(name) {
  return String(name || '').endsWith('.m4a') ? String(name).slice(0, -4) : String(name || '')
}

function repairReady(records) {
  if (repairPromise) return repairPromise
  repairPromise = (async () => {
    const ready = new Set(
      (records || [])
        .filter((record) => record && record.hasArticles)
        .map((record) => String(record.stem || ''))
        .filter(Boolean)
    )
    let repaired = 0
    for (const plan of pending()) {
      const stem = stemOf(plan.name)
      if (!ready.has(stem)) continue
      try {
        const doc = await library.fetchDoc(stem)
        if (!doc || !Array.isArray(doc.articles) || !doc.articles.length) continue
        const missing = missingPhotoKeys(doc.articles, plan.photoKeys)
        if (!missing.length) {
          discard(plan.name)
          continue
        }
        const result = ensurePhotoMarkers(doc.articles, missing)
        if (result.changed) {
          await library.saveArticles(stem, result.articles)
        } else if (library.invalidateArticleCaches) {
          library.invalidateArticleCaches([stem])
        }
        repaired += 1
        discard(plan.name)
      } catch (_) {
        // Keep the plan; the recordings page will retry after the next refresh.
      }
    }
    return repaired
  })().finally(() => { repairPromise = null })
  return repairPromise
}

module.exports = {
  STORAGE_KEY,
  pending,
  remember,
  missingPhotoKeys,
  ensurePhotoMarkers,
  repairReady
}
