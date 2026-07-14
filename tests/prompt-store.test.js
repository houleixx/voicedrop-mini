const test = require('node:test')
const assert = require('node:assert/strict')
const { createStore, CACHE_KEY } = require('../services/prompt-store')

const resolved = { schema: 1, items: [{ id: 'sys_concise', type: 'action', label: '精简', origin: 'system', prompt: 'P', appliesTo: ['text'] }] }

function deps() {
  const values = new Map([[CACHE_KEY, JSON.stringify(resolved)]])
  const calls = []
  const queue = []
  const request = {}
  for (const method of ['get', 'putJson', 'postJson', 'del']) request[method] = async (url, token, data) => {
    calls.push({ method, url, token, data })
    return queue.shift()
  }
  return { calls, queue, request, storage: { get: (key) => values.get(key), set: (key, value) => values.set(key, value) }, auth: { bearer: () => 'token' }, base: 'https://example.test/agent' }
}

test('refresh keeps cached items and exposes an error on network failure', async () => {
  const d = deps(); d.request.get = async () => { throw new Error('offline') }
  const store = createStore(d)
  const result = await store.refresh()
  assert.equal(result.ok, false)
  assert.equal(store.items().length, 1)
  assert.equal(store.error(), '加载失败')
})

test('failed save restores the full snapshot and stale reorder never puts', async () => {
  const d = deps(); d.queue.push({ statusCode: 500, data: {} })
  const store = createStore(d); const before = store.items()
  assert.equal((await store.remove('sys_concise')).ok, false)
  assert.deepEqual(store.items(), before)
  assert.equal((await store.applyReorder(before, ['old'])).error, 'conflict')
  assert.equal(d.calls.filter((call) => call.method === 'putJson').length, 1)
})

test('uses exact restore preview import and share endpoints', async () => {
  const d = deps(); const store = createStore(d)
  d.queue.push({ statusCode: 200, data: resolved })
  assert.equal((await store.restoreDefaults()).ok, true)
  assert.equal(d.calls.at(-1).url, 'https://example.test/agent/prompts/restore-defaults')
  d.queue.push({ statusCode: 200, data: { label: '共享', prompt: 'P', appliesTo: ['text'] } })
  assert.equal((await store.preview('1234567')).data.label, '共享')
  assert.equal(d.calls.at(-1).url, 'https://example.test/agent/prompt-share/1234567')
  d.queue.push({ statusCode: 200, data: { item: { id: 'p_12345678', type: 'action', label: '共享', origin: 'user', prompt: 'P', appliesTo: ['text'] } } })
  assert.equal((await store.importCode('1234567')).ok, true)
  assert.equal(d.calls.at(-1).url, 'https://example.test/agent/prompts/import')
  d.queue.push({ statusCode: 200, data: { code: '1234567', sharing: true } })
  assert.equal((await store.setSharing('p_12345678', true)).code, '1234567')
  assert.equal(d.calls.at(-1).url, 'https://example.test/agent/prompt-share')
})
