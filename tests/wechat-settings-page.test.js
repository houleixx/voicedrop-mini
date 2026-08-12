const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

function freshWechatSettingsPage(settingsOverrides, wxOverrides) {
  let page
  const settings = Object.assign({
    wechatBindStatus: async () => ({ connected: false, accountName: '', authorizerAppid: '' }),
    createWechatAuthorization: async () => '',
    unbindWechat: async () => true
  }, settingsOverrides || {})
  global.Page = (definition) => { page = definition }
  global.wx = Object.assign({
    showToast: () => {},
    showLoading: () => {},
    hideLoading: () => {},
    setClipboardData: () => {}
  }, wxOverrides || {})
  delete require.cache[require.resolve('../pages/wechat-settings/index')]
  delete require.cache[require.resolve('../services/settings')]
  require.cache[require.resolve('../services/settings')] = { exports: settings }
  require('../pages/wechat-settings/index')
  return page
}

function context(page) {
  return {
    data: Object.assign({}, page.data),
    setData(update) { Object.assign(this.data, update) },
    refreshStatus: page.refreshStatus
  }
}

test('wechat settings renders third-party connection status from bind-status', async () => {
  const page = freshWechatSettingsPage({
    wechatBindStatus: async () => ({
      connected: true,
      accountName: 'VoiceDrop 测试号',
      authorizerAppid: 'wx-authorizer'
    })
  })
  const ctx = context(page)

  await page.refreshStatus.call(ctx)

  assert.equal(ctx.data.loading, false)
  assert.equal(ctx.data.connected, true)
  assert.equal(ctx.data.accountName, 'VoiceDrop 测试号')
  assert.equal(ctx.data.authorizerAppid, 'wx-authorizer')
})

test('wechat settings generates and immediately copies the signed authorization link', async () => {
  const scanUrl = 'https://voicedrop.cn/files/api/wechat/scan?state=signed.state'
  const copied = []
  const toasts = []
  const page = freshWechatSettingsPage({
    createWechatAuthorization: async () => scanUrl
  }, {
    setClipboardData: ({ data, success }) => { copied.push(data); success() },
    showToast: (toast) => toasts.push(toast)
  })
  const ctx = context(page)

  await page.connectWechat.call(ctx)

  assert.equal(ctx.data.connecting, false)
  assert.deepEqual(copied, [scanUrl])
  assert.equal(toasts.at(-1).title, '授权链接已复制')
})

test('wechat settings disconnects through the third-party unbind endpoint', async () => {
  let unbound = 0
  const page = freshWechatSettingsPage({
    unbindWechat: async () => { unbound += 1; return true },
    wechatBindStatus: async () => ({ connected: false, accountName: '', authorizerAppid: '' })
  })
  const ctx = context(page)
  ctx.data.connected = true

  await page.disconnectWechat.call(ctx)

  assert.equal(unbound, 1)
  assert.equal(ctx.data.connected, false)
  assert.equal(ctx.data.disconnecting, false)
})

test('wechat settings replaces AppID and Secret form with authorization actions', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/wechat-settings/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(root, 'pages/wechat-settings/index.wxss'), 'utf8')

  assert.match(wxml, /连接微信公众号/)
  assert.match(wxml, /已授权账号/)
  assert.match(wxml, /bindtap="connectWechat"/)
  assert.match(wxml, /bindtap="disconnectWechat"/)
  assert.match(wxml, /任选一种方式打开链接/)
  assert.match(wxml, /电脑打开/)
  assert.match(wxml, /手机微信扫码/)
  assert.match(wxml, /手机浏览器/)
  assert.match(wxml, /截图二维码/)
  assert.match(wxml, /微信“扫一扫”/)
  assert.match(wxss, /\.method-options\s*\{[^}]*flex-direction:\s*column;/)
  assert.match(wxss, /\.steps-card\s*\{[^}]*margin:\s*34rpx -8rpx 0;[^}]*border:\s*2rpx solid #ece3d5;/)
  assert.doesNotMatch(wxml, /AppID|AppSecret|IP 白名单/)
})

test('wechat settings does not register or render an authorization web-view', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  const wxml = fs.readFileSync(path.join(root, 'pages/wechat-settings/index.wxml'), 'utf8')

  assert.ok(!app.pages.includes('pages/wechat-authorization/index'))
  assert.doesNotMatch(wxml, /<web-view/)
  assert.doesNotMatch(wxml, /authorizationUrl|copyAuthorizationUrl|授权链接已生成/)
})
