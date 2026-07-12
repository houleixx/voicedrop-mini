const test = require('node:test')
const assert = require('node:assert/strict')

function freshUsage(response) {
  const requests = []
  const api = { agentBase: () => 'https://example.test' }
  const auth = { bearer: () => 'test-token' }
  const http = {
    get: async (url, token) => {
      requests.push({ url, token })
      return response || {
        statusCode: 200,
        data: { granted: [{ reason: '注册赠送' }], spent: [] }
      }
    }
  }

  ;['../services/usage', '../services/api', '../services/auth', '../services/request'].forEach((id) => {
    delete require.cache[require.resolve(id)]
  })
  require.cache[require.resolve('../services/api')] = { exports: api }
  require.cache[require.resolve('../services/auth')] = { exports: auth }
  require.cache[require.resolve('../services/request')] = { exports: http }

  return { usage: require('../services/usage'), requests }
}

test('loads full usage summary with authenticated request', async () => {
  const { usage, requests } = freshUsage()
  const result = await usage.summary()
  assert.equal(requests[0].url, 'https://example.test/usage/summary')
  assert.deepEqual(result, { granted: [{ reason: '注册赠送' }], spent: [] })
})

test('normalizes a usage summary with missing response data', async () => {
  const { usage } = freshUsage({ statusCode: 200 })

  assert.deepEqual(await usage.summary(), { granted: [], spent: [] })
})

test('normalizes non-array usage summary groups', async () => {
  const { usage } = freshUsage({
    statusCode: 200,
    data: { granted: null, spent: { suanli: 18 } }
  })

  assert.deepEqual(await usage.summary(), { granted: [], spent: [] })
})
