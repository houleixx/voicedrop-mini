const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

function freshAccountPage(options) {
  let page
  const calls = []
  const config = options || {}
  const auth = {
    bearer: () => config.bearer || 'anon-token',
    anonymousBearer: () => config.anonymousBearer || 'anon-token',
    anonId: () => 'anon-current',
    adoptToken: (credential) => { calls.push(['adoptToken', credential]); return true },
    isWechatAuthenticated: () => false,
    storeSession: (session) => { calls.push(['storeSession', session]); return true },
    signOutWechat() {}
  }
  const library = {
    list: async () => [],
    ownerScope: async (settings) => {
      calls.push(['ownerScope', settings])
      if (config.ownerScope) return config.ownerScope(settings)
      return config.currentScope || 'users/anon-current/'
    }
  }
  const wechatAuth = {
    exchangeCode: async () => config.result
  }
  global.Page = (definition) => { page = definition }
  global.wx = {
    login({ success }) { success({ code: 'code-1' }) },
    showToast(options) { calls.push(['toast', options.title]) },
    setClipboardData(options) { calls.push(['clipboard', options.data]) },
    showModal(options) {
      calls.push(['modal', options])
      if (config.modalFail) {
        if (options.fail) options.fail({ errMsg: 'showModal:fail confirmText too long' })
        return
      }
      if (options.success) options.success({ confirm: Boolean(config.confirmSwitch), cancel: !config.confirmSwitch })
    },
    reLaunch(options) { calls.push(['reLaunch', options.url]) }
  }
  ;['../pages/account/index', '../services/auth', '../services/library', '../services/wechat-auth'].forEach((id) => {
    delete require.cache[require.resolve(id)]
  })
  require.cache[require.resolve('../services/auth')] = { exports: auth }
  require.cache[require.resolve('../services/library')] = { exports: library }
  require.cache[require.resolve('../services/wechat-auth')] = { exports: wechatAuth }
  require('../pages/account/index')
  return { page, calls }
}

test('account page displays and copies the anonymous account id', async () => {
  const { page, calls } = freshAccountPage({
    currentScope: 'users/anon-current/'
  })
  const ctx = context(page)

  await page.refresh.call(ctx)
  page.copyId.call(ctx)

  assert.equal(ctx.data.accountIdDisplay, 'anon-current')
  assert.deepEqual(calls.find(([name]) => name === 'clipboard'), ['clipboard', 'anon-current'])
  assert.deepEqual(calls.find(([name]) => name === 'ownerScope'), ['ownerScope', { anonymous: true }])
})

test('account detail uses the same Remix account icon as settings', () => {
  const accountWxml = fs.readFileSync(path.join(root, 'pages/account/index.wxml'), 'utf8')
  const settingsWxml = fs.readFileSync(path.join(root, 'pages/settings/index.wxml'), 'utf8')

  assert.match(accountWxml, /class="account-badge-icon ri-user-line"/)
  assert.match(settingsWxml, /class="menu-icon-text ri-user-line"/)
  assert.doesNotMatch(accountWxml, />✓</)
})

test('account page does not expose device pairing login', () => {
  const accountJs = fs.readFileSync(path.join(root, 'pages/account/index.js'), 'utf8')
  const accountWxml = fs.readFileSync(path.join(root, 'pages/account/index.wxml'), 'utf8')

  assert.doesNotMatch(accountWxml, /转移与登录|设备配对登录|startDeviceLink|pairing/)
  assert.doesNotMatch(accountJs, /device-link|startDeviceLink|verifyDeviceLink|cancelDeviceLink|pairingCode/)
})

test('token import dialog keeps the native input inside a styled field shell', () => {
  const accountWxml = fs.readFileSync(path.join(root, 'pages/account/index.wxml'), 'utf8')
  const accountWxss = fs.readFileSync(path.join(root, 'pages/account/index.wxss'), 'utf8')

  assert.match(
    accountWxml,
    /<view class="dialog-input-shell">\s*<input class="dialog-input"[^>]*>\s*<\/view>/
  )
  assert.match(accountWxss, /\.dialog-input-shell\s*{[^}]*height:\s*88rpx;/s)
  assert.match(accountWxss, /\.dialog-input\s*{[^}]*height:\s*100%;/s)
})

test('account page keeps the id blank until the account scope loads', async () => {
  let resolveScope
  const { page } = freshAccountPage({
    ownerScope: () => new Promise((resolve) => { resolveScope = resolve })
  })
  const ctx = context(page)

  const refreshing = page.refresh.call(ctx)
  assert.equal(ctx.data.accountIdDisplay, '')

  resolveScope('users/anon-current/')
  await refreshing
  assert.equal(ctx.data.accountIdDisplay, 'anon-current')
})

test('account page keeps the id blank when the account scope cannot be read', async () => {
  const { page } = freshAccountPage({
    ownerScope: async () => { throw new Error('network unavailable') }
  })
  const ctx = context(page)

  await page.refresh.call(ctx)

  assert.equal(ctx.data.accountId, '')
  assert.equal(ctx.data.accountIdDisplay, '')
})

test('account page copies and imports only the anonymous account token', async () => {
  const { page, calls } = freshAccountPage()
  const ctx = context(page)
  await page.refresh.call(ctx)
  page.copyToken.call(ctx)
  ctx.data.importToken = ` anon_${'a'.repeat(64)} `

  page.confirmImport.call(ctx)

  assert.deepEqual(calls.find(([name]) => name === 'clipboard'), ['clipboard', 'anon-token'])
  assert.deepEqual(calls.find(([name]) => name === 'adoptToken'), [
    'adoptToken',
    `anon_${'a'.repeat(64)}`
  ])
})

function context(page) {
  return {
    data: Object.assign({}, page.data),
    setData(update) { Object.assign(this.data, update) },
    refresh() {},
    loadStats() {},
    confirmWechatAccountSwitch: page.confirmWechatAccountSwitch,
    completeWechatLogin: page.completeWechatLogin
  }
}

test('account page stores a WeChat session immediately when scopes match', async () => {
  const { page, calls } = freshAccountPage({
    currentScope: 'users/anon-current/',
    result: { ok: true, session: 'session-token', scope: 'users/anon-current/' }
  })
  page.exchangeWechat.call(context(page), {})
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(calls.filter(([name]) => name === 'storeSession'), [['storeSession', 'session-token']])
  assert.equal(calls.some(([name]) => name === 'modal'), false)
})

test('account page keeps anon account when WeChat is linked to another scope', async () => {
  const { page, calls } = freshAccountPage({
    currentScope: 'users/anon-current/',
    result: { ok: true, session: 'session-token', scope: 'users/wechat-existing/' },
    confirmSwitch: true
  })
  page.exchangeWechat.call(context(page), {})
  await new Promise((resolve) => setImmediate(resolve))

  const modal = calls.find(([name]) => name === 'modal')[1]
  assert.equal(modal.title, '该微信已关联另一个云端空间')
  assert.equal(modal.confirmText, '知道了')
  assert.equal(modal.showCancel, false)
  assert.ok(modal.confirmText.length <= 4)
  assert.equal(calls.some(([name]) => name === 'storeSession'), false)
  assert.equal(calls.some(([name]) => name === 'reLaunch'), false)
})

test('account page keeps the anonymous account when scope switch is canceled', async () => {
  const { page, calls } = freshAccountPage({
    currentScope: 'users/anon-current/',
    result: { ok: true, session: 'session-token', scope: 'users/wechat-existing/' },
    confirmSwitch: false
  })
  page.exchangeWechat.call(context(page), {})
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(calls.some(([name]) => name === 'storeSession'), false)
  assert.equal(calls.some(([name]) => name === 'reLaunch'), false)
})

test('account page reports a native scope modal failure without switching accounts', async () => {
  const { page, calls } = freshAccountPage({
    currentScope: 'users/anon-current/',
    result: { ok: true, session: 'session-token', scope: 'users/wechat-existing/' },
    modalFail: true
  })
  page.exchangeWechat.call(context(page), {})
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(calls.some(([name]) => name === 'storeSession'), false)
  assert.deepEqual(calls.find(([name]) => name === 'toast'), ['toast', '账号切换提示打开失败'])
})
