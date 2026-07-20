const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

function freshWechatSettingsPage(settingsOverrides, wxOverrides) {
  let page
  const settings = Object.assign({
    WECHAT_CREDENTIAL_HELP_URL: 'https://developers.weixin.qq.com/console/',
    loadWechat: async () => ({}),
    saveWechat: async () => true,
    validateWechatCreds(appid, secret) {
      const cleanAppid = String(appid || '').trim()
      const cleanSecret = String(secret || '').trim()
      if (!/^wx[0-9A-Za-z]{16}$/.test(cleanAppid)) return 'AppID 格式不对'
      if (!/^[0-9a-f]{32}$/.test(cleanSecret)) return 'AppSecret 格式不对'
      return ''
    },
    validateWechatRemote: async () => ''
  }, settingsOverrides || {})

  global.Page = (definition) => {
    page = definition
  }
  global.wx = Object.assign({
    showToast: () => {},
    setClipboardData: () => {}
  }, wxOverrides || {})

  delete require.cache[require.resolve('../pages/wechat-settings/index')]
  delete require.cache[require.resolve('../services/settings')]
  require.cache[require.resolve('../services/settings')] = { exports: settings }
  require('../pages/wechat-settings/index')
  return page
}

function pageContext(page, initialData) {
  return {
    data: Object.assign({}, page.data, initialData || {}),
    setData(update) {
      Object.assign(this.data, update)
    },
    refreshCanSave: page.refreshCanSave,
    refreshConfigured: page.refreshConfigured,
    refreshFormState: page.refreshFormState,
    hasWechatCredentials: page.hasWechatCredentials
  }
}

test('wechat settings enables save only after valid remote-loaded credentials exist', async () => {
  const page = freshWechatSettingsPage({
    loadWechat: async () => ({
      appid: 'wx1234567890abcdef',
      secret: '0123456789abcdef0123456789abcdef',
      enabled: true
    })
  })
  const ctx = pageContext(page)

  await page.load.call(ctx)

  assert.equal(ctx.data.appid, 'wx1234567890abcdef')
  assert.equal(ctx.data.secret, '0123456789abcdef0123456789abcdef')
  assert.equal(ctx.data.enabled, true)
  assert.equal(ctx.data.canSave, true)
  assert.equal(ctx.data.wechatConfigured, true)
})

test('wechat settings recomputes save availability while editing credentials', () => {
  const page = freshWechatSettingsPage()
  const ctx = pageContext(page)

  page.onInput.call(ctx, { currentTarget: { dataset: { key: 'appid' } }, detail: { value: 'wx1234567890abcdef' } })
  assert.equal(ctx.data.canSave, false)
  assert.equal(ctx.data.wechatConfigured, false)

  page.onInput.call(ctx, { currentTarget: { dataset: { key: 'secret' } }, detail: { value: '0123456789abcdef0123456789abcdef' } })
  assert.equal(ctx.data.canSave, true)
  assert.equal(ctx.data.wechatConfigured, true)
})

test('wechat settings marks credentials connected after successful remote save', async () => {
  const saves = []
  const page = freshWechatSettingsPage({
    saveWechat: async (appid, secret, enabled) => {
      saves.push({ appid, secret, enabled })
      return true
    }
  })
  const ctx = pageContext(page, {
    appid: ' wx1234567890abcdef ',
    secret: ' 0123456789abcdef0123456789abcdef ',
    enabled: true,
    canSave: true
  })

  await page.save.call(ctx)

  assert.deepEqual(saves, [{ appid: 'wx1234567890abcdef', secret: '0123456789abcdef0123456789abcdef', enabled: true }])
  assert.equal(ctx.data.saving, false)
  assert.equal(ctx.data.canSave, true)
  assert.equal(ctx.data.wechatConfigured, true)
})

test('wechat settings disconnect clears credentials and persists empty remote config', async () => {
  const saves = []
  const page = freshWechatSettingsPage({
    saveWechat: async (appid, secret, enabled) => {
      saves.push({ appid, secret, enabled })
      return true
    }
  })
  const ctx = pageContext(page, {
    appid: 'wx1234567890abcdef',
    secret: '0123456789abcdef0123456789abcdef',
    enabled: true,
    canSave: true,
    wechatConfigured: true
  })

  await page.disconnectWechat.call(ctx)

  assert.deepEqual(saves, [{ appid: '', secret: '', enabled: false }])
  assert.equal(ctx.data.appid, '')
  assert.equal(ctx.data.secret, '')
  assert.equal(ctx.data.enabled, false)
  assert.equal(ctx.data.canSave, false)
  assert.equal(ctx.data.wechatConfigured, false)
})

test('wechat settings binds iOS-style banner, save, and disconnect states', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/wechat-settings/index.wxml'), 'utf8')

  assert.match(wxml, /wx:if="\{\{wechatConfigured\}\}"/)
  assert.match(wxml, /公众号已连接/)
  assert.match(wxml, /凭据已保存/)
  assert.match(wxml, /wx:else/)
  assert.match(wxml, /填入公众号 AppID \/ AppSecret 即可连接。/)
  assert.match(wxml, /<button[^>]+class="save-button \{\{canSave \? 'save-button-active' : ''\}\}"/)
  assert.match(wxml, /disabled="\{\{!canSave \|\| saving\}\}"/)
  assert.match(wxml, /loading="\{\{saving\}\}"/)
  assert.match(wxml, /wx:if="\{\{wechatConfigured\}\}"[\s\S]*bindtap="disconnectWechat"[\s\S]*断开连接/)
  assert.match(wxml, /扫一扫 → 右上角相册/)
  assert.match(wxml, /IP 白名单/)
  assert.match(wxml, /wx:if="\{\{validationError\}\}"/)
})

test('wechat settings blocks persistence when remote validation fails', async () => {
  let saved = false
  const toasts = []
  const page = freshWechatSettingsPage({
    validateWechatRemote: async () => 'AppSecret 无效',
    saveWechat: async () => { saved = true; return true }
  }, { showToast: (toast) => toasts.push(toast) })
  const ctx = pageContext(page, {
    appid: 'wx1234567890abcdef',
    secret: '0123456789abcdef0123456789abcdef',
    canSave: true
  })

  await page.save.call(ctx)

  assert.equal(saved, false)
  assert.equal(ctx.data.saving, false)
  assert.equal(ctx.data.validationError, 'AppSecret 无效')
  assert.equal(toasts[0].title, 'AppSecret 无效')
})
