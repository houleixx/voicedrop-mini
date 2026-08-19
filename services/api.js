const route = require('./api-route')

const CN_HOST = 'voicedrop.cn'
const WS_HOST = 'jianshuo.dev'
const PHOTO_TRANSFORM_HOST = WS_HOST

function filesBase() {
  return `https://${route.currentHost()}/files/api`
}

function photoBase() {
  return `https://${route.currentHost()}/files/api`
}

function agentBase() {
  return `https://${route.currentHost()}/agent`
}

function recoBase() {
  return `https://${route.currentHost()}/reco`
}

function agentWs() {
  return `wss://${WS_HOST}/agent`
}

function sharePage(id) {
  return `https://${CN_HOST}/${path(id)}`
}

function downloadUrl(key) {
  return `${filesBase()}/download/${path(key)}`
}

function photoUrl(key) {
  return `${filesBase()}/photo/${path(key)}`
}

function photoCdnUrl(key) {
  return `${photoBase()}/photo/${path(key)}`
}

// Cloudflare Images is only available on the CF host.  This is intentionally
// separate from photoCdnUrl: EdgeOne accelerates the original; it does not resize it.
function photoThumbnailUrl(key) {
  return `https://${PHOTO_TRANSFORM_HOST}/cdn-cgi/image/width=512,quality=60/files/api/photo/${path(key)}`
}

function path(key) {
  return String(key || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/%20/g, '%20'))
    .join('/')
}

const api = {
  CN_HOST,
  PHOTO_TRANSFORM_HOST,
  WS_HOST,
  filesBase,
  photoBase,
  agentBase,
  recoBase,
  agentWs,
  sharePage,
  downloadUrl,
  photoUrl,
  photoCdnUrl,
  photoThumbnailUrl,
  path
}

// Keep the legacy fields for callers outside this repository, but make their
// semantics match the selected HTTP route instead of freezing them to CN.
Object.defineProperties(api, {
  HOST: { enumerable: true, get: () => route.currentHost() },
  PHOTO_HOST: { enumerable: true, get: () => route.currentHost() }
})

module.exports = api
