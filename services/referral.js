const api = require('./api')
const auth = require('./auth')
const http = require('./request')

const DONE_PREFIX = 'voicedrop.referral.done.'
const inFlight = new Set()

function inviteCode(value) {
  const code = String(value || '').trim()
  return /^[A-Za-z0-9]{6,16}$/.test(code) ? code : ''
}

async function link() {
  const res = await http.get(`${api.agentBase()}/referral/link`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`invite link HTTP ${res.statusCode}`)
  const data = res.data || {}
  if (!inviteCode(data.code) || !data.url) throw new Error('邀请链接暂不可用')
  return {
    code: inviteCode(data.code),
    url: String(data.url),
    name: String(data.name || ''),
    suanliInviter: Number(data.suanliInviter) || 0,
    suanliFriend: Number(data.suanliFriend) || 0
  }
}

async function claim(value) {
  const token = inviteCode(value)
  if (!token || inFlight.has(token) || wx.getStorageSync(`${DONE_PREFIX}${token}`)) return false
  inFlight.add(token)
  try {
    const res = await http.postJson(`${api.agentBase()}/referral/claim`, auth.bearer(), { source: 'link', token })
    if (res.statusCode < 200 || res.statusCode >= 300) return false
    const data = res.data || {}
    if (data.attributed || ['not-new', 'device-used', 'disabled'].includes(data.reason)) {
      wx.setStorageSync(`${DONE_PREFIX}${token}`, true)
    }
    return Boolean(data.attributed)
  } finally {
    inFlight.delete(token)
  }
}

function codeFromLaunch(options) {
  const query = options && options.query || {}
  const direct = inviteCode(query.inviteCode)
  if (direct) return direct
  let scene = ''
  try { scene = decodeURIComponent(query.scene || '') } catch (_) { scene = String(query.scene || '') }
  const match = scene.match(/(?:^|[?&])inviteCode=([A-Za-z0-9]{6,16})(?:&|$)/)
  return inviteCode(match ? match[1] : scene)
}

module.exports = { link, claim, inviteCode, codeFromLaunch }
