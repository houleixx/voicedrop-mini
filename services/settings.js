const api = require('./api')
const auth = require('./auth')
const http = require('./request')

const WECHAT_CREDENTIAL_HELP_URL = 'https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Get_access_token.html'

async function loadStyle() {
  const res = await http.get(`${api.filesBase()}/style`, auth.bearer())
  return res.statusCode >= 200 && res.statusCode < 300 ? styleFromResponse(res.data) : { style: '', styles: [] }
}

async function loadStyleHistory() {
  const res = await http.get(`${api.filesBase()}/style/history`, auth.bearer())
  return res.statusCode >= 200 && res.statusCode < 300 ? res.data : { versions: [], head: 0 }
}

async function saveStyleHead(head) {
  const res = await http.patchJson(`${api.filesBase()}/style/head`, auth.bearer(), { head })
  return res.statusCode >= 200 && res.statusCode < 300
}

async function saveStyleSelection(styles) {
  const res = await http.putJson(`${api.filesBase()}/style`, auth.bearer(), styleSelectionBody(styles))
  return res.statusCode >= 200 && res.statusCode < 300
}

function styleSelectionBody(styles) {
  return { styles: styles || [] }
}

function styleFromResponse(data) {
  const obj = data || {}
  return {
    style: obj.style || '',
    name: obj.name || '',
    styles: Array.isArray(obj.styles) ? obj.styles.map((item) => {
      const value = Number.parseInt(item, 10)
      return Number.isNaN(value) ? 0 : value
    }) : []
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

function nameBody(name) {
  return { name: String(name || '').trim() }
}

async function loadWechat() {
  const res = await http.get(`${api.filesBase()}/download/WECHAT.json`, auth.bearer())
  return res.statusCode >= 200 && res.statusCode < 300 ? res.data : {}
}

async function saveWechat(appid, secret, enabled) {
  const res = await http.putJson(`${api.filesBase()}/upload/WECHAT.json`, auth.bearer(), { appid, secret, enabled })
  return res.statusCode >= 200 && res.statusCode < 300
}

function validateWechatCreds(appid, secret) {
  const cleanAppid = String(appid || '').trim()
  const cleanSecret = String(secret || '').trim()
  if (!cleanAppid.startsWith('wx') || cleanAppid.length < 8) return 'AppID 格式不对'
  if (cleanSecret.length < 16) return 'AppSecret 太短'
  return ''
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
  WECHAT_CREDENTIAL_HELP_URL,
  loadStyle,
  loadStyleHistory,
  saveStyleHead,
  saveStyleSelection,
  styleSelectionBody,
  styleFromResponse,
  saveStyle,
  saveName,
  nameBody,
  loadWechat,
  saveWechat,
  validateWechatCreds,
  loadConfig,
  saveConfig,
  articlesPageUrl
}
