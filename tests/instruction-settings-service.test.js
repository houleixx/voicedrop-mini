const assert = require('node:assert/strict')
const test = require('node:test')

function freshService(responses) {
  const requests = []
  const http = {
    get: async (url, token) => {
      requests.push({ method: 'GET', url, token })
      return responses.shift()
    },
    putJson: async (url, token, data) => {
      requests.push({ method: 'PUT', url, token, data })
      return responses.shift()
    },
    postJson: async (url, token, data) => {
      requests.push({ method: 'POST', url, token, data })
      const response = responses.shift()
      if (response instanceof Error) throw response
      return response
    },
    del: async (url, token) => {
      requests.push({ method: 'DELETE', url, token })
      const response = responses.shift()
      if (response instanceof Error) throw response
      return response
    }
  }
  for (const id of ['../services/instruction-settings', '../services/api', '../services/auth', '../services/request']) {
    try { delete require.cache[require.resolve(id)] } catch (_) {}
  }
  require.cache[require.resolve('../services/auth')] = { exports: { bearer: () => 'anon_test' } }
  require.cache[require.resolve('../services/request')] = { exports: http }
  return { service: require('../services/instruction-settings'), requests }
}

test('loads normalized prompt customization items', async () => {
  const { service, requests } = freshService([{ statusCode: 200, data: { items: [{
    id: 'item-1', label: '图片风格 · 卡通', default: '默认提示词', override: null, customLabel: null, hidden: false
  }] } }])
  const result = await service.load()
  assert.equal(requests[0].url, 'https://jianshuo.dev/agent/ui-config/custom')
  assert.equal(requests[0].token, 'anon_test')
  assert.equal(result.ok, true)
  assert.equal(result.items[0].defaultText, '默认提示词')
})

test('saves full prompt state with a trimmed 20 character label', async () => {
  const { service, requests } = freshService([{ statusCode: 200, data: { ok: true } }])
  const result = await service.save('item-1', ' 我的提示词 ', '123456789012345678901234', true)
  assert.deepEqual(requests[0].data, {
    id: 'item-1', instruction: ' 我的提示词 ', label: '12345678901234567890', hidden: true
  })
  assert.equal(result.ok, true)
})

test('reports HTTP failures without pretending the save succeeded', async () => {
  const { service } = freshService([{ statusCode: 500, data: {} }])
  const result = await service.save('item-1', '', '', false)
  assert.deepEqual(result, { ok: false, error: 'save_failed' })
})

test('enables prompt sharing and validates the seven digit code', async () => {
  const { service, requests } = freshService([{ statusCode: 200, data: { code: '1234567', url: 'https://voicedrop.cn/1234567', sharing: true } }])
  const result = await service.setSharing('item/a', true)
  assert.deepEqual(requests[0], { method: 'POST', url: 'https://jianshuo.dev/agent/prompt-share', token: 'anon_test', data: { id: 'item/a' } })
  assert.deepEqual(result, { ok: true, code: '1234567', url: 'https://voicedrop.cn/1234567', sharing: true })
})

test('disables prompt sharing with an encoded item id', async () => {
  const { service, requests } = freshService([{ statusCode: 200, data: { code: '1234567', sharing: false } }])
  const result = await service.setSharing('item/a', false)
  assert.equal(requests[0].method, 'DELETE')
  assert.equal(requests[0].url, 'https://jianshuo.dev/agent/prompt-share/item%2Fa')
  assert.deepEqual(result, { ok: true, code: '1234567', sharing: false })
})

test('maps prompt sharing caps, network failures, and malformed success responses', async () => {
  let harness = freshService([{ statusCode: 429, data: {} }])
  assert.deepEqual(await harness.service.setSharing('a', true), { ok: false, error: 'daily_cap' })
  harness = freshService([new Error('offline')])
  assert.deepEqual(await harness.service.setSharing('a', true), { ok: false, error: 'network_error' })
  harness = freshService([{ statusCode: 200, data: { sharing: true } }])
  assert.deepEqual(await harness.service.setSharing('a', true), { ok: false, error: 'bad_share_code' })
})
