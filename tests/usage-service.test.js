const test = require('node:test')
const assert = require('node:assert/strict')

function freshUsage(response) {
  const requests = []
  const storage = new Map()
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) }
  }
  const api = { agentBase: () => 'https://example.test' }
  const auth = { bearer: () => 'test-token' }
  const http = {
    get: async (url, token) => {
      requests.push({ url, token })
      return typeof response === 'function' ? response({ url, token }) : (response || {
        statusCode: 200,
        data: { granted: [{ reason: '注册赠送' }], spent: [] }
      })
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

test('caches the public book prices for 24 hours and sends no bearer token', async () => {
  const { usage, requests } = freshUsage(({ url }) => ({
    statusCode: 200,
    data: url.endsWith('/usage/prices') ? { book: 160, book_revise: 40 } : {}
  }))

  assert.deepEqual(await usage.prices({ now: 100 }), { book: 160, book_revise: 40, fetchedAt: 100 })
  assert.equal(requests[0].url, 'https://example.test/usage/prices')
  assert.equal(requests[0].token, '')
  assert.deepEqual(await usage.prices({ now: 100 + usage.PRICES_TTL_MS }), { book: 160, book_revise: 40, fetchedAt: 100 })
  assert.equal(requests.length, 1)
})

test('rejects invalid remote price tables and falls back safely', async () => {
  const { usage } = freshUsage({ statusCode: 200, data: { book: 0, book_revise: 40 } })
  assert.deepEqual(await usage.prices({ now: 1 }), { book: 160, book_revise: 40, fetchedAt: 0 })
  assert.equal(usage.normalizePrices({ book: 160, book_revise: -1, fetchedAt: 1 }), null)
})

test('keeps the previous revision price when the remote table omits it', async () => {
  let calls = 0
  const { usage } = freshUsage(() => {
    calls += 1
    return calls === 1
      ? { statusCode: 200, data: { book: 160, book_revise: 41 } }
      : { statusCode: 200, data: { book: 200 } }
  })
  await usage.prices({ now: 100 })
  assert.deepEqual(await usage.prices({ now: 100 + usage.PRICES_TTL_MS + 1 }), {
    book: 200, book_revise: 41, fetchedAt: 100 + usage.PRICES_TTL_MS + 1
  })
})

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
