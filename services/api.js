const HOST = 'jianshuo.dev'
const PHOTO_HOST = 'voicedrop.cn'

function filesBase() {
  return `https://${HOST}/files/api`
}

function photoBase() {
  return `https://${PHOTO_HOST}/files/api`
}

function agentBase() {
  return `https://${HOST}/agent`
}

function recoBase() {
  return `https://${HOST}/reco`
}

function agentWs() {
  return `wss://${HOST}/agent`
}

function sharePage(id) {
  return `https://${HOST}/voicedrop/${id}`
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

function path(key) {
  return String(key || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/%20/g, '%20'))
    .join('/')
}

module.exports = {
  HOST,
  PHOTO_HOST,
  filesBase,
  photoBase,
  agentBase,
  recoBase,
  agentWs,
  sharePage,
  downloadUrl,
  photoUrl,
  photoCdnUrl,
  path
}
