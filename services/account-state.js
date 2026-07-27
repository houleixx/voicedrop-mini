const FIXED_PENDING_KEYS = new Set([
  'voicedrop.commandqueue.default',
  'voicedrop.commandcontrols.default',
  'voicedrop.commandconfirms.default'
])
const PENDING_PREFIXES = [
  'voicedrop.editqueue.'
]

function isPendingAccountKey(key) {
  const value = String(key || '')
  return FIXED_PENDING_KEYS.has(value) ||
    PENDING_PREFIXES.some((prefix) => value.startsWith(prefix))
}

function clearPendingAccountState(storageApi) {
  if (!storageApi || typeof storageApi.removeStorageSync !== 'function') return
  let keys = Array.from(FIXED_PENDING_KEYS)
  if (typeof storageApi.getStorageInfoSync === 'function') {
    try {
      const info = storageApi.getStorageInfoSync()
      if (info && Array.isArray(info.keys)) keys = info.keys
    } catch (_) {
    }
  }
  keys.filter(isPendingAccountKey).forEach((key) => storageApi.removeStorageSync(key))
}

function clearDeletedAccountState(storageApi) {
  if (!storageApi) return
  if (typeof storageApi.clearStorageSync === 'function') {
    storageApi.clearStorageSync()
    return
  }
  if (typeof storageApi.getStorageInfoSync !== 'function' ||
      typeof storageApi.removeStorageSync !== 'function') return
  try {
    const info = storageApi.getStorageInfoSync()
    ;(info && Array.isArray(info.keys) ? info.keys : [])
      .forEach((key) => storageApi.removeStorageSync(key))
  } catch (_) {
  }
}

function identityChanged(previous, current) {
  return String(previous || '') !== String(current || '')
}

module.exports = {
  clearDeletedAccountState,
  clearPendingAccountState,
  identityChanged,
  isPendingAccountKey
}
