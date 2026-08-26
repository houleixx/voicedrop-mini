const test = require('node:test')
const assert = require('node:assert/strict')

function freshSettings(responses, apiOverrides) {
  const calls = []
  const http = {
    async get(url, token) { calls.push({ method: 'GET', url, token }); return responses.shift() },
    async postJson(url, token, data) { calls.push({ method: 'POST', url, token, data }); return responses.shift() }
  }
  const auth = { bearer: () => 'Bearer test-token' }
  for (const id of ['../services/settings', '../services/request', '../services/auth', '../services/api']) {
    delete require.cache[require.resolve(id)]
  }
  require.cache[require.resolve('../services/request')] = { exports: http }
  require.cache[require.resolve('../services/auth')] = { exports: auth }
  if (apiOverrides) {
    require.cache[require.resolve('../services/api')] = {
      exports: Object.assign({ filesBase: () => 'https://voicedrop.cn/files/api' }, apiOverrides)
    }
  }
  const settings = require('../services/settings')
  return { settings, calls }
}

test('wechat binding service uses the third-party platform endpoints', async () => {
  const scanUrl = 'https://voicedrop.cn/files/api/wechat/scan?state=payload.signature'
  const { settings, calls } = freshSettings([
    { statusCode: 200, data: { connected: true, account_name: '测试号', authorizer_appid: 'wx-a' } },
    { statusCode: 200, data: { scan_url: scanUrl } },
    { statusCode: 200, data: { connected: false } }
  ])

  assert.equal((await settings.wechatBindStatus()).connected, true)
  assert.equal(await settings.createWechatAuthorization(), scanUrl)
  assert.equal(await settings.unbindWechat(), true)
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    'GET https://voicedrop.cn/files/api/wechat/bind-status',
    'POST https://voicedrop.cn/files/api/wechat/authorization',
    'POST https://voicedrop.cn/files/api/wechat/unbind'
  ])
})

test('wechat binding accepts the canonical scan URL after API route failover', async () => {
  const scanUrl = 'https://voicedrop.cn/files/api/wechat/scan?state=payload.signature'
  const { settings } = freshSettings([
    { statusCode: 200, data: { scan_url: scanUrl } }
  ], {
    filesBase: () => 'https://jianshuo.dev/files/api'
  })

  assert.equal(await settings.createWechatAuthorization(), scanUrl)
})

test('wechat draft publishing uses the current article endpoint after bind preflight', async () => {
  const calls = []
  const http = {
    async postJson(url, token, data) {
      calls.push({ url, token, data })
      return { statusCode: 200, data: { ok: true, created: 1, updated: 0 } }
    }
  }
  for (const id of ['../services/library', '../services/request', '../services/auth', '../services/api']) {
    delete require.cache[require.resolve(id)]
  }
  require.cache[require.resolve('../services/request')] = { exports: http }
  require.cache[require.resolve('../services/auth')] = { exports: { bearer: () => 'Bearer test-token' } }
  const library = require('../services/library')

  const result = await library.publishWechat({ stem: 'VoiceDrop-test' })

  assert.equal(result.ok, true)
  assert.equal(calls[0].url, 'https://voicedrop.cn/files/api/wechat/articles/VoiceDrop-test.json')
  assert.equal(calls[0].token, 'Bearer test-token')
})
