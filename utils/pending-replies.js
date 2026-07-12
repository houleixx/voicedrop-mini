const PREFIX = 'vd.pendingReply.'

function wxStorage() {
  return {
    get: (key) => (typeof wx === 'undefined' ? null : wx.getStorageSync(key)),
    put: (key, value) => { if (typeof wx !== 'undefined') wx.setStorageSync(key, value) },
    remove: (key) => { if (typeof wx !== 'undefined') wx.removeStorageSync(key) }
  }
}

function memoryStorage() {
  const data = {}
  return {
    get: (key) => data[key],
    put: (key, value) => { data[key] = value },
    remove: (key) => { delete data[key] }
  }
}

function key(audioName) {
  return `${PREFIX}${audioName}`
}

function put(audioName, replyToShareId, storage) {
  if (!audioName || !replyToShareId) return
  ;(storage || wxStorage()).put(key(audioName), replyToShareId)
}

function replyTo(audioName, storage) {
  if (!audioName) return null
  const value = (storage || wxStorage()).get(key(audioName))
  return value || null
}

function remove(audioName, storage) {
  if (audioName) (storage || wxStorage()).remove(key(audioName))
}

async function publishReadyReplies(recordings, publisher, storage) {
  let published = 0
  if (!recordings || !publisher) return published
  for (const rec of recordings) {
    if (!rec || !rec.hasArticles) continue
    const target = replyTo(rec.audioName, storage)
    if (!target) continue
    if (await publisher(rec, target)) {
      remove(rec.audioName, storage)
      published += 1
    }
  }
  return published
}

module.exports = {
  memoryStorage,
  put,
  replyTo,
  remove,
  publishReadyReplies
}
