const api = require('./api')
const auth = require('./auth')
const http = require('./request')

function normalizeWechatBindStatus(statusCode, data) {
  const body = data && typeof data === 'object' ? data : {}
  const connected = statusCode >= 200 && statusCode < 300 && body.connected === true
  return {
    connected,
    accountName: connected ? String(body.account_name || '') : '',
    authorizerAppid: connected ? String(body.authorizer_appid || '') : '',
    enabled: connected && body.enabled !== false
  }
}

async function wechatBindStatus() {
  const res = await http.get(`${api.filesBase()}/wechat/bind-status`, auth.bearer())
  return normalizeWechatBindStatus(res && res.statusCode || 0, res && res.data)
}

function isWechatAuthorizationUrl(value) {
  const candidate = String(value || '')
  const bases = [api.filesBase(), 'https://voicedrop.cn/files/api']
  return bases.some((base) => {
    const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`^${escapedBase}/wechat/scan\\?state=[A-Za-z0-9._~-]+$`).test(candidate)
  })
}

async function createWechatAuthorization() {
  const res = await http.postJson(`${api.filesBase()}/wechat/authorization`, auth.bearer(), {})
  if (!res || res.statusCode < 200 || res.statusCode >= 300) return ''
  const scanUrl = res.data && res.data.scan_url || ''
  return isWechatAuthorizationUrl(scanUrl) ? scanUrl : ''
}

async function unbindWechat() {
  const res = await http.postJson(`${api.filesBase()}/wechat/unbind`, auth.bearer(), {})
  return Boolean(res && res.statusCode >= 200 && res.statusCode < 300)
}

async function loadStyle() {
  const res = await http.get(`${api.filesBase()}/style`, auth.bearer())
  return res.statusCode >= 200 && res.statusCode < 300 ? styleFromResponse(res.data) : { style: '', name: '' }
}

async function loadStyleHistory() {
  const res = await http.get(`${api.filesBase()}/style/history`, auth.bearer())
  return res.statusCode >= 200 && res.statusCode < 300 ? res.data : { versions: [], head: 0 }
}

async function saveStyleHead(head) {
  const res = await http.patchJson(`${api.filesBase()}/style/head`, auth.bearer(), { head })
  return res.statusCode >= 200 && res.statusCode < 300
}

function styleFromResponse(data) {
  const obj = data || {}
  return {
    style: obj.style || '',
    name: obj.name || ''
  }
}

async function saveStyle(style) {
  const res = await http.putJson(`${api.filesBase()}/style`, auth.bearer(), { style: String(style || '').trim() })
  return res.statusCode >= 200 && res.statusCode < 300
}

async function saveName(name) {
  const res = await http.putJson(`${api.filesBase()}/style`, auth.bearer(), nameBody(name))
  return res.statusCode >= 200 && res.statusCode < 300
}

function feedbackBody(text, name, version) {
  return {
    text: String(text || '').trim().slice(0, 2000),
    name: String(name || '').trim(),
    version: String(version || '').trim()
  }
}

async function sendFeedback(text, name, version) {
  const body = feedbackBody(text, name, version)
  if (!body.text) return false
  const res = await http.postJson(`${api.agentBase()}/feedback`, auth.bearer(), body)
  return res.statusCode >= 200 && res.statusCode < 300
}

function nameBody(name) {
  return { name: String(name || '').trim() }
}

async function loadConfig() {
  const res = await http.get(`${api.filesBase()}/download/CONFIG.json`, auth.bearer())
  return res.statusCode >= 200 && res.statusCode < 300 ? res.data : {}
}

async function saveConfig(autoShareCommunity) {
  const res = await http.putJson(`${api.filesBase()}/upload/CONFIG.json`, auth.bearer(), { autoShareCommunity })
  return res.statusCode >= 200 && res.statusCode < 300
}

async function articlesPageUrl() {
  const res = await http.get(`${api.filesBase()}/token/articles`, auth.bearer())
  return res.statusCode >= 200 && res.statusCode < 300 && res.data ? res.data.url : ''
}

module.exports = {
  normalizeWechatBindStatus,
  wechatBindStatus,
  isWechatAuthorizationUrl,
  createWechatAuthorization,
  unbindWechat,
  loadStyle,
  loadStyleHistory,
  saveStyleHead,
  styleFromResponse,
  saveStyle,
  saveName,
  nameBody,
  feedbackBody,
  sendFeedback,
  loadConfig,
  saveConfig,
  articlesPageUrl
}
