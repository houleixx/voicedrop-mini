const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const storageKey = 'voicedrop.audioConsent.v3'

function freshAbout(options) {
  const config = options || {}
  const storage = {}
  const navigations = []
  const toasts = []
  const modals = []
  let page
  if (config.granted) {
    storage[storageKey] = {
      version: '2026-07-13-v1',
      agreedAt: '2026-07-13T00:00:00.000Z'
    }
  }
  global.Page = (definition) => { page = definition }
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => {
      if (config.removeFails) throw new Error('remove failed')
      delete storage[key]
    },
    navigateTo: ({ url }) => navigations.push(url),
    showToast: (toast) => toasts.push(toast),
    getAccountInfoSync: () => ({
      miniProgram: {
        version: config.version == null ? '' : config.version,
        envVersion: config.envVersion || 'develop'
      }
    }),
    showModal: (modal) => {
      modals.push(modal)
      if (modal.success) modal.success({ confirm: config.confirm !== false })
    }
  }
  ;[
    '../pages/about/index',
    '../utils/audio-consent',
    '../utils/block-store',
    '../utils/app-version'
  ].forEach((id) => { delete require.cache[require.resolve(id)] })
  require('../pages/about/index')
  const ctx = Object.assign({}, page, {
    data: Object.assign({}, page.data),
    setData(update) { Object.assign(this.data, update) }
  })
  return { page, ctx, storage, navigations, toasts, modals }
}

test('about page shows current audio consent state and opens the independent agreement', () => {
  const h = freshAbout({ granted: true, version: '1.2.3' })

  h.page.onShow.call(h.ctx)
  h.page.openAudioConsent.call(h.ctx)

  assert.equal(h.ctx.data.audioConsentGranted, true)
  assert.equal(h.ctx.data.appVersion, '1.2.3')
  assert.deepEqual(h.navigations, ['/pages/audio-consent/index'])
})

test('about page labels builds without a published version as development builds', () => {
  const h = freshAbout()

  h.page.onShow.call(h.ctx)

  assert.equal(h.ctx.data.appVersion, '开发版')
  const wxml = fs.readFileSync(path.join(root, 'pages/about/index.wxml'), 'utf8')
  assert.match(wxml, /当前版本\s+\{\{appVersion\}\}/)
})

test('about page identifies a trial build without claiming a version number', () => {
  const h = freshAbout({ envVersion: 'trial' })

  h.page.onShow.call(h.ctx)

  assert.equal(h.ctx.data.appVersion, '体验版')
})

test('about page keeps the agreement row without a withdrawal action', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/about/index.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(root, 'pages/about/index.js'), 'utf8')

  assert.match(wxml, /bindtap="openAudioConsent"/)
  assert.match(wxml, /音频信息授权协议/)
  assert.doesNotMatch(wxml, /撤回音频授权/)
  assert.doesNotMatch(wxml, /bindtap="withdrawAudioConsent"/)
  assert.doesNotMatch(js, /withdrawAudioConsent/)
  assert.doesNotMatch(js, /audioConsent\.revoke/)
})
