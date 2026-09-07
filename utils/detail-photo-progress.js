// Local hints only: a missing file is not proof of an active generation job.
const article = require('./article')
const WAIT_MS = 300000
function keys(doc, index) {
  const items = doc && doc.articles || []
  return items.flatMap((item, i) => index != null && i !== index ? [] :
    article.bodyBlocks(item.body || '').filter(b => b.type === 'photo')
      .map(b => article.resolvePhotoKey(b.key, doc.photos || []) || b.key))
}
function journal(page, scope) {
  const identity = `${scope || page.data.photoScope || ''}|${page.data.rec && page.data.rec.stem || ''}`
  if (page.photoJournalIdentity === identity && page.photoJournal) return page.photoJournal
  let value
  try { value = wx.getStorageSync(`voicedrop.photoProgress.${identity}`) } catch (_) {}
  page.photoJournalIdentity = identity
  page.photoJournal = value && value.version === 1 && value.photos && Array.isArray(value.edits)
    ? value : { version: 1, photos: {}, edits: [] }
  return page.photoJournal
}
function save(page) {
  if (!page.photoJournal) return
  try { wx.setStorageSync(`voicedrop.photoProgress.${page.photoJournalIdentity}`, page.photoJournal) } catch (_) {}
}
function enqueue(page, index, kind, images, instruction) {
  const state = journal(page)
  const uploaded = (images || []).map(image => image.key)
  // Uploaded-photo insertion supplies markers even when no thumbnail is available.
  const markers = Array.from(String(instruction || '').matchAll(/\[\[photo:([^\]]+)\]\]/g), m => m[1])
  const before = keys(page.data.doc, index)
  for (const key of uploaded.concat(markers.filter(key => !before.includes(key)))) {
    state.photos[key] = { intent: 'loaded' }
  }
  state.edits = state.edits.filter(edit => edit.deadline > Date.now())
  state.edits.push({ index, kind, before, deadline: Date.now() + WAIT_MS })
  save(page)
}
function observe(page, doc, scope) {
  const state = journal(page, scope)
  const now = Date.now()
  state.edits = state.edits.filter(edit => edit.deadline > now)
  for (const edit of state.edits.slice().reverse()) {
    const current = keys(doc, edit.index)
    for (const key of current) {
      if (!edit.before.includes(key) && !state.photos[key]) {
        state.photos[key] = { intent: edit.kind === 'image' ? 'generated' : 'unknown', deadline: edit.deadline }
      }
    }
    edit.before = Array.from(new Set(edit.before.concat(current)))
  }
  save(page)
  return state.photos
}
function remember(page, key, value) {
  journal(page).photos[key] = value
  save(page)
}
module.exports = { journal, enqueue, observe, remember }
