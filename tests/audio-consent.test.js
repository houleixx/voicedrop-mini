const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const storageKey = 'voicedrop.audioConsent'

function loadConsent(initial, overrides) {
  const storage = Object.assign({}, initial)
  global.wx = Object.assign({
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] }
  }, overrides)
  delete require.cache[require.resolve('../utils/audio-consent')]
  return { consent: require('../utils/audio-consent'), storage }
}

test('audio consent is versioned and fails closed for missing or stale state', () => {
  assert.equal(loadConsent().consent.isGranted(), false)

  const stale = loadConsent({
    [storageKey]: { version: 'old', agreedAt: '2026-01-01T00:00:00.000Z' }
  }).consent
  assert.equal(stale.isGranted(), false)
})

test('grant stores the current version and revoke clears it', () => {
  const { consent, storage } = loadConsent()

  consent.grant(new Date('2026-07-13T00:00:00.000Z'))

  assert.deepEqual(storage[storageKey], {
    version: '2026-07-13-v1',
    agreedAt: '2026-07-13T00:00:00.000Z'
  })
  assert.equal(consent.isGranted(), true)
  assert.equal(consent.revoke(), true)
  assert.equal(consent.isGranted(), false)
})

test('agreement copy states audio purposes, handling, deletion, and contact details', () => {
  const { consent } = loadConsent()
  const copy = [
    consent.SUMMARY,
    ...consent.SECTIONS.flatMap((section) => [section.title, ...section.paragraphs])
  ].join('\n')

  assert.match(copy, /转写/)
  assert.match(copy, /生成和编辑文章/)
  assert.match(copy, /语音指令/)
  assert.match(copy, /社区回应/)
  assert.match(copy, /加密网络/)
  assert.match(copy, /删除单条录音/)
  assert.match(copy, /jianshuo@hotmail\.com/)
  assert.match(copy, /不提取声纹模板/)
  assert.match(copy, /不进行声纹身份识别/)
})

test('storage errors fail closed', () => {
  const { consent } = loadConsent({}, {
    getStorageSync() { throw new Error('read failed') },
    setStorageSync() { throw new Error('write failed') },
    removeStorageSync() { throw new Error('remove failed') }
  })

  assert.equal(consent.isGranted(), false)
  assert.throws(() => consent.grant(), /write failed/)
  assert.equal(consent.revoke(), false)
})

test('agreement metadata uses the approved first version and date', () => {
  const { consent } = loadConsent()

  assert.equal(consent.TITLE, '音频信息授权协议')
  assert.equal(consent.VERSION, '2026-07-13-v1')
  assert.equal(consent.EFFECTIVE_DATE, '2026-07-13')
  assert.equal(fs.existsSync(path.join(root, 'utils/audio-consent.js')), true)
})
