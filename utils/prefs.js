const DELETE_LOCAL = 'deleteLocalAfterUpload'
const LIKED_COMMUNITY_POSTS = 'likedCommunityPosts'
const FOLLOW_UP_ENABLED = 'followUpEnabled'

function wxStorage() {
  return {
    get: (key) => (typeof wx === 'undefined' ? undefined : wx.getStorageSync(key)),
    put: (key, value) => { if (typeof wx !== 'undefined') wx.setStorageSync(key, value) }
  }
}

function memoryStorage() {
  const data = {}
  return {
    get: (key) => data[key],
    put: (key, value) => { data[key] = value }
  }
}

function storageOf(storage) {
  return storage || wxStorage()
}

function deleteLocalAfterUpload(storage) {
  const value = storageOf(storage).get(DELETE_LOCAL)
  return value == null ? true : Boolean(value)
}

function setDeleteLocalAfterUpload(value, storage) {
  storageOf(storage).put(DELETE_LOCAL, Boolean(value))
}

function likedSet(storage) {
  const raw = storageOf(storage).get(LIKED_COMMUNITY_POSTS)
  return new Set(Array.isArray(raw) ? raw : [])
}

function likedCommunityPost(shareId, storage) {
  return Boolean(shareId) && likedSet(storage).has(shareId)
}

function setLikedCommunityPost(shareId, liked, storage) {
  if (!shareId) return
  const current = likedSet(storage)
  if (liked) current.add(shareId)
  else current.delete(shareId)
  setLikedCommunityPosts(current, storage)
}

function setLikedCommunityPosts(shareIds, storage) {
  storageOf(storage).put(LIKED_COMMUNITY_POSTS, Array.from(shareIds || []))
}

function followUpEnabled(storage) {
  const value = storageOf(storage).get(FOLLOW_UP_ENABLED)
  return value == null ? true : Boolean(value)
}

function setFollowUpEnabled(value, storage) {
  storageOf(storage).put(FOLLOW_UP_ENABLED, Boolean(value))
}

module.exports = {
  memoryStorage,
  deleteLocalAfterUpload,
  setDeleteLocalAfterUpload,
  followUpEnabled,
  setFollowUpEnabled,
  likedCommunityPost,
  setLikedCommunityPost,
  setLikedCommunityPosts
}
