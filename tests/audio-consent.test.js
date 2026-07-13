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

function loadDialog() {
  const events = []
  let definition
  global.Component = (next) => { definition = next }
  delete require.cache[require.resolve('../utils/audio-consent')]
  const componentPath = '../components/audio-consent-dialog/index'
  delete require.cache[require.resolve(componentPath)]
  require(componentPath)
  const ctx = {
    data: Object.assign({}, definition.data),
    triggerEvent(name, detail) { events.push({ name, detail }) }
  }
  Object.entries(definition.methods).forEach(([name, method]) => {
    ctx[name] = method.bind(ctx)
  })
  return { ctx, definition, events }
}

test('dialog exposes controlled visibility and emits explicit actions', () => {
  const { ctx, definition, events } = loadDialog()

  assert.deepEqual(definition.properties.visible, { type: Boolean, value: false })
  ctx.agree()
  ctx.decline()
  ctx.viewAgreement()

  assert.deepEqual(events.map((event) => event.name), [
    'agree',
    'decline',
    'viewagreement'
  ])
})

test('dialog leaves host readiness to the page lifecycle', () => {
  const { definition } = loadDialog()

  assert.equal(definition.lifetimes, undefined)
})

test('dialog has separate view, decline, and agree actions', () => {
  const wxml = fs.readFileSync(path.join(root, 'components/audio-consent-dialog/index.wxml'), 'utf8')

  assert.match(wxml, /bindtap="viewAgreement"/)
  assert.match(wxml, /bindtap="decline"/)
  assert.match(wxml, /bindtap="agree"/)
  assert.match(wxml, /wx:if="\{\{visible\}\}"/)
  assert.match(wxml, /查看完整协议/)
  assert.match(wxml, /不同意/)
  assert.match(wxml, /同意并继续/)
})

test('standalone agreement page is registered and reading it does not grant consent', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  const js = fs.readFileSync(path.join(root, 'pages/audio-consent/index.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'pages/audio-consent/index.wxml'), 'utf8')

  assert.ok(app.pages.includes('pages/audio-consent/index'))
  assert.match(js, /audioConsent\.SECTIONS/)
  assert.doesNotMatch(js, /\.grant\(/)
  assert.match(wxml, /wx:for="\{\{sections\}\}"/)
  assert.match(wxml, /生效日期/)
})

test('app does not declare platform microphone authorization', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.equal(app.permission, undefined)
})
