const ANON_KEY = 'voicedrop.auth.anon'
const SESSION_KEY = 'voicedrop.auth.session'

function wxApi() {
  return typeof wx === 'undefined' ? null : wx
}

function randomHex(length) {
  const chars = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

function newAnon() {
  return `anon_${randomHex(64)}`
}

function storageGet(key) {
  const api = wxApi()
  if (!api) return ''
  return api.getStorageSync(key) || ''
}

function storageSet(key, value) {
  const api = wxApi()
  if (api) api.setStorageSync(key, value)
}

function storageRemove(key) {
  const api = wxApi()
  if (api) api.removeStorageSync(key)
}

function isSessionToken(token) {
  if (!token) return false
  const parts = String(token).split('.')
  return parts.length === 3 && parts.every((part) => part.length >= 8 && /^[A-Za-z0-9_-]+$/.test(part))
}

function ensureAnon() {
  const existing = storageGet(ANON_KEY)
  if (existing) {
    if (isSessionToken(existing)) {
      if (!storageGet(SESSION_KEY)) storageSet(SESSION_KEY, existing)
      const token = newAnon()
      storageSet(ANON_KEY, token)
      return token
    }
    return existing
  }
  const token = newAnon()
  storageSet(ANON_KEY, token)
  return token
}

function anonymousBearer() {
  return ensureAnon()
}

function session() {
  const token = storageGet(SESSION_KEY)
  return isSessionToken(token) ? token : ''
}

function communityBearer() {
  return session() || anonymousBearer()
}

function bearer() {
  return anonymousBearer()
}

function anonId() {
  const token = anonymousBearer()
  let hash = 0
  for (let i = 0; i < token.length; i += 1) {
    hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0
  }
  return `anon-${Math.abs(hash).toString(16).padStart(8, '0')}`
}

function adoptToken(token) {
  if (!token || !String(token).startsWith('anon_') || String(token).length < 20) return false
  storageSet(ANON_KEY, String(token).trim())
  storageRemove(SESSION_KEY)
  return true
}

function storeSession(token) {
  if (!isSessionToken(token)) return false
  storageSet(SESSION_KEY, token)
  return true
}

function signOutWechat() {
  storageRemove(SESSION_KEY)
}

module.exports = {
  bearer,
  anonymousBearer,
  session,
  communityBearer,
  anonId,
  adoptToken,
  storeSession,
  signOutWechat,
  isSessionToken,
  isWechatAuthenticated: () => Boolean(session())
}
