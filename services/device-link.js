const api = require('./api')
const auth = require('./auth')
const http = require('./request')

async function start(prefix, pubkey) {
  const res = await http.postJson(`${api.agentBase()}/link/start`, auth.bearer(), { prefix, pubkey })
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`link start HTTP ${res.statusCode}`)
  return res.data
}

async function verify(pairingId, code) {
  const res = await http.postJson(`${api.agentBase()}/link/verify`, auth.bearer(), { pairingId, code })
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`link verify HTTP ${res.statusCode}`)
  return res.data
}

async function complete(pairingId, blob) {
  const res = await http.postJson(`${api.agentBase()}/link/complete`, auth.bearer(), { pairingId, blob })
  return res.statusCode >= 200 && res.statusCode < 300
}

async function cancel(pairingId) {
  await http.postJson(`${api.agentBase()}/link/cancel`, auth.bearer(), { pairingId })
}

module.exports = {
  start,
  verify,
  complete,
  cancel
}
