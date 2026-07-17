const test = require('node:test')
const assert = require('node:assert/strict')

const storageKey = 'voicedrop.audioConsent.v3'

function loadFlow(overrides) {
  const storage = {}
  const toasts = []
  global.wx = Object.assign({
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    showToast: (options) => toasts.push(options)
  }, overrides)

  delete require.cache[require.resolve('../utils/audio-consent')]
  const flowPath = '../utils/audio-consent-flow'
  delete require.cache[require.resolve(flowPath)]
  const flow = require(flowPath)
  const page = {
    data: { audioConsentVisible: false },
    setData(update) { Object.assign(this.data, update) }
  }
  return { flow, page, storage, toasts }
}

test('first request opens the dialog and agreement persists before continuing', async () => {
  const { flow, page, storage } = loadFlow()

  const pending = flow.request(page)
  assert.equal(page.data.audioConsentVisible, true)
  flow.agree(page)

  assert.equal(await pending, true)
  assert.equal(storage[storageKey].version, '2026-07-13-v1')
  assert.equal(page.data.audioConsentVisible, false)
  assert.equal(await flow.request(page), true)
  assert.equal(page.data.audioConsentVisible, false)
})

test('decline is not stored and the next request opens the dialog again', async () => {
  const { flow, page, storage } = loadFlow()

  const first = flow.request(page)
  flow.decline(page)
  assert.equal(await first, false)
  assert.equal(storage[storageKey], undefined)

  const second = flow.request(page)
  assert.equal(page.data.audioConsentVisible, true)
  flow.decline(page)
  assert.equal(await second, false)
})

test('pending requests are deduplicated and dispose resolves them false', async () => {
  const { flow, page } = loadFlow()

  const first = flow.request(page)
  assert.equal(flow.request(page), first)
  flow.dispose(page)

  assert.equal(await first, false)
})

test('request reports an unavailable dialog instead of failing silently', async () => {
  const { flow, page, toasts } = loadFlow()
  page.setData = () => { throw new Error('view unavailable') }

  assert.equal(await flow.request(page), false)
  assert.deepEqual(toasts.at(-1), {
    title: '授权组件加载失败，请重试',
    icon: 'none'
  })
})

test('failed local persistence keeps consent denied and reports the error', async () => {
  const { flow, page, storage, toasts } = loadFlow({
    setStorageSync() { throw new Error('disk full') }
  })

  const pending = flow.request(page)
  flow.agree(page)

  assert.equal(await pending, false)
  assert.equal(storage[storageKey], undefined)
  assert.deepEqual(toasts.at(-1), {
    title: '授权状态保存失败',
    icon: 'none'
  })
  assert.equal(page.data.audioConsentVisible, false)
})
