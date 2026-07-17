const assert = require('node:assert/strict')
const test = require('node:test')

function freshWechatAuth(response, wxOverrides = {}) {
  const storage = {}
  const requests = []
  global.wx = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => {
      storage[key] = value
    },
    removeStorageSync: (key) => {
      delete storage[key]
    },
    getAccountInfoSync: () => ({
      miniProgram: { appId: 'wx-test-runtime-appid' }
    }),
    request: (options) => {
      requests.push(options)
      options.success(response || {
        statusCode: 200,
        data: { session: 'aaaaaaaa.bbbbbbbb.cccccccc', scope: 'wechat' }
      })
    },
    ...wxOverrides
  }

  delete require.cache[require.resolve('../services/auth')]
  delete require.cache[require.resolve('../services/request')]
  delete require.cache[require.resolve('../services/wechat-auth')]
  const wechatAuth = require('../services/wechat-auth')
  return { wechatAuth, requests, storage }
}

test('wechat auth exchanges mini program code without switching accounts before confirmation', async () => {
  const { wechatAuth, requests, storage } = freshWechatAuth()

  const result = await wechatAuth.exchangeCode(' code-1 ', 'Nick', 'avatar.png')

  assert.equal(result.ok, true)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].method, 'POST')
  assert.equal(requests[0].url, 'https://jianshuo.dev/files/api/auth/wechat')
  assert.equal(requests[0].data.code, 'code-1')
  assert.equal(requests[0].data.appid, 'wx-test-runtime-appid')
  assert.equal(requests[0].data.platform, 'mini_program')
  assert.equal(requests[0].data.nickname, 'Nick')
  assert.equal(requests[0].data.avatar, 'avatar.png')
  assert.equal(result.session, 'aaaaaaaa.bbbbbbbb.cccccccc')
  assert.equal(result.scope, 'wechat')
  assert.equal(storage['voicedrop.auth.session'], undefined)
})

test('auth keeps the anonymous token as the account bearer after WeChat login', () => {
  const { storage } = freshWechatAuth()
  const auth = require('../services/auth')
  const anonymous = auth.anonymousBearer()

  assert.equal(auth.bearer(), anonymous)
  assert.equal(auth.storeSession('aaaaaaaa.bbbbbbbb.cccccccc'), true)
  assert.equal(auth.bearer(), anonymous)
  assert.equal(auth.communityBearer(), 'aaaaaaaa.bbbbbbbb.cccccccc')
  assert.equal(auth.anonymousBearer(), anonymous)

  auth.signOutWechat()
  assert.equal(storage['voicedrop.auth.session'], undefined)
  assert.equal(auth.bearer(), anonymous)
})

test('auth imports only an anonymous account token', () => {
  const { storage } = freshWechatAuth()
  const auth = require('../services/auth')
  const session = 'aaaaaaaa.bbbbbbbb.cccccccc'

  assert.equal(auth.adoptToken(session), false)
  assert.equal(storage['voicedrop.auth.session'], undefined)

  const anonymous = `anon_${'a'.repeat(64)}`
  assert.equal(auth.adoptToken(anonymous), true)
  assert.equal(auth.bearer(), anonymous)
  assert.equal(storage['voicedrop.auth.session'], undefined)
})

test('wechat auth refuses missing login code without network request', async () => {
  const { wechatAuth, requests } = freshWechatAuth()

  const result = await wechatAuth.exchangeCode('  ')

  assert.deepEqual(result, {
    ok: false,
    error: 'missing_code',
    detail: '微信登录没有返回 code'
  })
  assert.equal(requests.length, 0)
})

test('wechat auth reports a missing runtime AppID without network request', async () => {
  const { wechatAuth, requests } = freshWechatAuth(undefined, {
    getAccountInfoSync: () => ({ miniProgram: {} })
  })

  const result = await wechatAuth.exchangeCode('code-1')

  assert.deepEqual(result, {
    ok: false,
    error: 'missing_appid',
    detail: '无法读取当前小程序 AppID'
  })
  assert.equal(requests.length, 0)
})
