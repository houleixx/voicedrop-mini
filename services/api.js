const HOST = 'jianshuo.dev'

function filesBase() {
  return `https://${HOST}/files/api`
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

function path(key) {
  return String(key || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/%20/g, '%20'))
    .join('/')
}

module.exports = {
  HOST,
  filesBase,
  agentBase,
  recoBase,
  agentWs,
  sharePage,
  downloadUrl,
  photoUrl,
  path
}
