const ANON_KEY = 'voicedrop.auth.anon'
const SESSION_KEY = 'voicedrop.auth.session'
const PRE_WECHAT_ANON_KEY = 'voicedrop.auth.pre_wechat_anon'
const accountState = require('./account-state')

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
  return session() || anonymousBearer()
}

function anonId() {
  const token = anonymousBearer()
  let hash = 0
  for (let i = 0; i < token.length; i += 1) {
    hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0
  }
  return `anon-${Math.abs(hash).toString(16).padStart(8, '0')}`
}

function decodeBase64Url(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const input = String(value || '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  let bits = 0
  let bitCount = 0
  let output = ''
  for (const char of input) {
    const index = alphabet.indexOf(char)
    if (index < 0) return ''
    bits = (bits << 6) | index
    bitCount += 6
    if (bitCount >= 8) {
      bitCount -= 8
      output += String.fromCharCode((bits >> bitCount) & 0xff)
      bits &= bitCount ? (1 << bitCount) - 1 : 0
    }
  }
  try {
    return decodeURIComponent(Array.from(output)
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''))
  } catch (_) {
    return output
  }
}

function libraryCacheIdentity() {
  const signed = session()
  if (signed) {
    try {
      const payload = JSON.parse(decodeBase64Url(signed.split('.')[1]))
      const scope = String(payload && payload.scope || '')
      if (scope.startsWith('users/') && scope.endsWith('/')) return scope
    } catch (_) {
    }
  }
  return anonId()
}

function adoptToken(token) {
  if (!token || !String(token).startsWith('anon_') || String(token).length < 20) return false
  const next = String(token).trim()
  if (accountState.identityChanged(anonymousBearer(), next)) {
    accountState.clearPendingAccountState(wxApi())
  }
  storageSet(ANON_KEY, next)
  storageRemove(SESSION_KEY)
  storageRemove(PRE_WECHAT_ANON_KEY)
  return true
}

function storeSession(token) {
  if (!isSessionToken(token)) return false
  storageSet(SESSION_KEY, token)
  return true
}

function switchToWechatAccount(token) {
  if (!isSessionToken(token)) return false
  accountState.clearPendingAccountState(wxApi())
  storageSet(PRE_WECHAT_ANON_KEY, anonymousBearer())
  storageSet(SESSION_KEY, token)
  return true
}

function signOutWechat() {
  const previous = storageGet(PRE_WECHAT_ANON_KEY)
  if (previous && String(previous).startsWith('anon_')) {
    accountState.clearPendingAccountState(wxApi())
    storageSet(ANON_KEY, previous)
  }
  storageRemove(SESSION_KEY)
  storageRemove(PRE_WECHAT_ANON_KEY)
}

function resetAnonymous() {
  accountState.clearDeletedAccountState(wxApi())
  storageSet(ANON_KEY, newAnon())
  storageRemove(SESSION_KEY)
  storageRemove(PRE_WECHAT_ANON_KEY)
}

module.exports = {
  bearer,
  anonymousBearer,
  session,
  communityBearer,
  anonId,
  libraryCacheIdentity,
  adoptToken,
  storeSession,
  switchToWechatAccount,
  signOutWechat,
  resetAnonymous,
  isSessionToken,
  isWechatAuthenticated: () => Boolean(session())
}
