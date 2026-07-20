const api = require('./api')
const auth = require('./auth')
const http = require('./request')

const WECHAT_CREDENTIAL_HELP_URL = 'https://developers.weixin.qq.com/console/'

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
  if (!/^wx[0-9A-Za-z]{16}$/.test(cleanAppid)) return 'AppID 格式不对（应以 wx 开头，共 18 位）'
  if (!/^[0-9a-f]{32}$/.test(cleanSecret)) return 'AppSecret 格式不对（应为 32 位小写十六进制，别把 AppID 填进来）'
  return ''
}

function wechatValidationMessage(data) {
  const result = data || {}
  if (result.ok === true) return ''
  switch (Number(result.errcode)) {
    case 40164:
      return '服务器 IP 还没生效：把下方 IP 加入公众号后台的「IP 白名单」，保存白名单后等一两分钟再点保存'
    case 40013: return 'AppID 无效，找不到这个公众号'
    case 40125: return 'AppSecret 无效'
    case 41002: return '缺少 AppID'
    case 41004: return '缺少 AppSecret'
    default: return `验证失败：${result.errmsg || '未知错误'}`
  }
}

async function validateWechatRemote(appid, secret) {
  const localError = validateWechatCreds(appid, secret)
  if (localError) return localError
  try {
    const res = await http.postJson(`${api.filesBase()}/wechat-validate`, auth.bearer(), {
      appid: String(appid || '').trim(),
      secret: String(secret || '').trim()
    })
    if (!res || res.statusCode < 200 || res.statusCode >= 300) {
      return '暂时连不上验证服务，请稍后再试（配置未保存）'
    }
    return wechatValidationMessage(res.data)
  } catch (_) {
    return '暂时连不上验证服务，请稍后再试（配置未保存）'
  }
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
  validateWechatRemote,
  wechatValidationMessage,
  loadConfig,
  saveConfig,
  articlesPageUrl
}
