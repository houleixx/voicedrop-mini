const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const storageKey = 'voicedrop.audioConsent'

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
    showModal: (modal) => {
      modals.push(modal)
      if (modal.success) modal.success({ confirm: config.confirm !== false })
    }
  }
  ;[
    '../pages/about/index',
    '../utils/audio-consent',
    '../utils/block-store'
  ].forEach((id) => { delete require.cache[require.resolve(id)] })
  require('../pages/about/index')
  const ctx = Object.assign({}, page, {
    data: Object.assign({}, page.data),
    setData(update) { Object.assign(this.data, update) }
  })
  return { page, ctx, storage, navigations, toasts, modals }
}

test('about page shows current audio consent state and opens the independent agreement', () => {
  const h = freshAbout({ granted: true })

  h.page.onShow.call(h.ctx)
  h.page.openAudioConsent.call(h.ctx)

  assert.equal(h.ctx.data.audioConsentGranted, true)
  assert.deepEqual(h.navigations, ['/pages/audio-consent/index'])
})

test('about page withdrawal clears consent but explains that recordings remain', () => {
  const h = freshAbout({ granted: true })
  h.page.onShow.call(h.ctx)

  h.page.withdrawAudioConsent.call(h.ctx)

  assert.equal(h.storage[storageKey], undefined)
  assert.equal(h.ctx.data.audioConsentGranted, false)
  assert.match(h.modals[0].content, /已有录音和处理结果不会自动删除/)
  assert.equal(h.toasts.at(-1).title, '已撤回')
})

test('about page keeps consent when withdrawal storage fails', () => {
  const h = freshAbout({ granted: true, removeFails: true })
  h.page.onShow.call(h.ctx)

  h.page.withdrawAudioConsent.call(h.ctx)

  assert.equal(h.ctx.data.audioConsentGranted, true)
  assert.equal(h.toasts.at(-1).title, '撤回失败，请重试')
})

test('about page renders separate agreement and withdrawal rows', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/about/index.wxml'), 'utf8')

  assert.match(wxml, /bindtap="openAudioConsent"/)
  assert.match(wxml, /音频信息授权协议/)
  assert.match(wxml, /bindtap="withdrawAudioConsent"/)
  assert.match(wxml, /wx:if="\{\{audioConsentGranted\}\}"/)
})
