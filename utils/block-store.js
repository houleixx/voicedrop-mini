const KEY = 'vd.blockedAuthors'

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

function blocked(storage) {
  const raw = (storage || wxStorage()).get(KEY)
  return Array.isArray(raw) ? raw : []
}

function save(list, storage) {
  ;(storage || wxStorage()).put(KEY, Array.from(new Set(list.filter(Boolean))))
}

function isBlocked(author, storage) {
  return Boolean(author) && blocked(storage).includes(author)
}

function block(author, storage) {
  if (!author) return
  save(blocked(storage).concat(author), storage)
}

function unblock(author, storage) {
  save(blocked(storage).filter((item) => item !== author), storage)
}

function blockedList(storage) {
  return blocked(storage).slice().sort()
}

module.exports = {
  memoryStorage,
  blocked,
  isBlocked,
  block,
  unblock,
  blockedList
}
