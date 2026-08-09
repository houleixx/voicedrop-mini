const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

function freshPage() {
  let page
  global.Page = (definition) => { page = definition }
  global.wx = {
    getSystemInfoSync: () => ({ statusBarHeight: 0 }),
    reLaunch: (options) => { global.__route = options.url },
    navigateBack: () => { global.__back = true }
  }
  delete require.cache[require.resolve('../pages/shared-article/index')]
  require('../pages/shared-article/index')
  return page
}

test('shared article card preserves its public route when re-shared', () => {
  const page = freshPage()
  const ctx = {
    data: {
      shareId: 'Ab3xK9_p2Q', section: 1, article: { title: '公开文章' },
      moreMenuOpen: true,
      blocks: [{ type: 'photo', url: 'wxfile://shared-cover.jpg' }]
    },
    setData(update) { Object.assign(this.data, update) }
  }
  const payload = page.onShareAppMessage.call(ctx)
  assert.equal(payload.path, '/pages/shared-article/index?shareId=Ab3xK9_p2Q&section=1&fromShare=1')
  assert.equal(payload.imageUrl, 'wxfile://shared-cover.jpg')
  assert.equal(ctx.data.moreMenuOpen, false)
})

test('shared article back follows community-detail root-page behavior but returns to recordings', () => {
  const page = freshPage()
  global.getCurrentPages = () => [{ route: 'pages/shared-article/index' }]
  page.goBack.call({ openedFromShare: true })
  assert.equal(global.__route, '/pages/recordings/index')

  global.__route = ''
  global.__back = false
  global.getCurrentPages = () => [{ route: 'pages/recordings/index' }, { route: 'pages/shared-article/index' }]
  page.goBack.call({ openedFromShare: false })
  assert.equal(global.__route, '')
  assert.equal(global.__back, true)
})

test('shared article uses the same fixed toolbar button and transparent article styling as community detail', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'pages/shared-article/index.wxss'), 'utf8')

  assert.match(css, /\.tool-button\s*\{[^}]*width:\s*72rpx;[^}]*height:\s*72rpx;[^}]*max-width:\s*72rpx;[^}]*max-height:\s*72rpx;[^}]*flex:\s*0 0 72rpx;/s)
  assert.match(css, /\.community-detail-screen\s*\{[^}]*background:\s*#fbf7f0;/s)
  assert.match(css, /\.article,\s*\.empty\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;/s)
  assert.match(css, /\.paragraph\s*\{[^}]*color:\s*#514b44;[^}]*font-size:\s*35rpx;[^}]*line-height:\s*1\.72;/s)
})

test('shared article omits the author row like the iOS read-only share view', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '..', 'pages/shared-article/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(__dirname, '..', 'pages/shared-article/index.wxss'), 'utf8')

  assert.doesNotMatch(wxml, /article-meta|article-author|>VoiceDrop</)
  assert.doesNotMatch(css, /\.article-meta|\.article-author/)
})
