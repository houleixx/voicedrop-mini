const api = require('./api')
const auth = require('./auth')
const http = require('./request')

const MINI_PROGRAM_PLATFORM = 'mini_program'

function miniProgramAppId() {
  try {
    const account = typeof wx.getAccountInfoSync === 'function'
      ? wx.getAccountInfoSync()
      : null
    return String(account && account.miniProgram && account.miniProgram.appId || '').trim()
  } catch (error) {
    return ''
  }
}

async function exchangeCode(code, nickname, avatar) {
  const jsCode = String(code || '').trim()
  if (!jsCode) {
    return {
      ok: false,
      error: 'missing_code',
      detail: '微信登录没有返回 code'
    }
  }
  const appid = miniProgramAppId()
  if (!appid) {
    return {
      ok: false,
      error: 'missing_appid',
      detail: '无法读取当前小程序 AppID'
    }
  }
  const payload = {
    code: jsCode,
    appid,
    platform: MINI_PROGRAM_PLATFORM
  }
  if (nickname) payload.nickname = nickname
  if (avatar) payload.avatar = avatar
  const res = await http.postJson(`${api.filesBase()}/auth/wechat`, auth.anonymousBearer(), payload)
  if (res.statusCode < 200 || res.statusCode >= 300) {
    return {
      ok: false,
      error: res.data && res.data.error || 'wechat_auth_failed',
      detail: res.data && res.data.detail || ''
    }
  }
  const session = res.data && res.data.session
  const scope = res.data && res.data.scope || ''
  const ok = auth.isSessionToken(session) && Boolean(scope)
  return {
    ok,
    error: ok ? null : 'bad_session',
    detail: '',
    session: ok ? session : '',
    scope: ok ? scope : ''
  }
}

module.exports = {
  exchangeCode,
  miniProgramAppId,
  MINI_PROGRAM_PLATFORM
}
