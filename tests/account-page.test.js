const test = require('node:test')
const assert = require('node:assert/strict')

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
  ;['../pages/account/index', '../services/auth', '../services/library', '../services/wechat-auth', '../services/device-link'].forEach((id) => {
    delete require.cache[require.resolve(id)]
  })
  require.cache[require.resolve('../services/auth')] = { exports: auth }
  require.cache[require.resolve('../services/library')] = { exports: library }
  require.cache[require.resolve('../services/wechat-auth')] = { exports: wechatAuth }
  require.cache[require.resolve('../services/device-link')] = { exports: {} }
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
