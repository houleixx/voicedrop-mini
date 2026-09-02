const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const community = require('../services/community')
const library = require('../services/library')
const settings = require('../services/settings')
const books = require('../services/books')

test('community defaults to latest and searches title author and preview', () => {
  const source = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
  assert.match(source, /communityFeedTab:\s*'latest'/)
  const posts = [
    { shareId: '1', title: 'VoiceDrop 手册' },
    { shareId: '2', author: 'Alice' },
    { shareId: '3', preview: '今天去了西湖' }
  ]
  assert.deepEqual(community.searchPosts(posts, ' 手册 ').map((p) => p.shareId), ['1'])
  assert.deepEqual(community.searchPosts(posts, 'alice').map((p) => p.shareId), ['2'])
  assert.deepEqual(community.searchPosts(posts, '西湖').map((p) => p.shareId), ['3'])
  assert.deepEqual(community.searchPosts(posts, '').map((p) => p.shareId), ['1', '2', '3'])
})

test('photo upload declares the true byte format instead of trusting the jpg key', () => {
  assert.equal(library.imageContentType(Uint8Array.from([0xff, 0xd8, 0xff]).buffer), 'image/jpeg')
  assert.equal(library.imageContentType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer), 'image/png')
  assert.equal(library.imageContentType(Uint8Array.from([0x47, 0x49, 0x46, 0x38]).buffer), 'image/gif')
  assert.equal(library.imageContentType(Uint8Array.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50]).buffer), 'image/webp')
  assert.equal(library.imageContentType(Uint8Array.from([1, 2, 3]).buffer), 'application/octet-stream')
})

test('feedback input is trimmed and capped at the backend contract limit', () => {
  assert.deepEqual(settings.feedbackBody('  建议增加搜索  ', ' 小王 ', ' 1.0 '), {
    text: '建议增加搜索', name: '小王', version: '1.0'
  })
  assert.equal(settings.feedbackBody('长'.repeat(2100), '', '').text.length, 2000)
})

test('book endpoint uses accepted, insufficient-credit and invalid-token states', () => {
  assert.match(books.message(202), /可以关闭小程序/)
  assert.match(books.message(401), /身份校验/)
  const insufficient = books.result({ statusCode: 402, data: { need_suanli: 320, suanli: 12.5 } })
  assert.equal(insufficient.accepted, false)
  assert.match(insufficient.message, /要 320 算力/)
  assert.match(insufficient.message, /现在有 12\.5/)
  assert.doesNotMatch(books.message(401), /文章/)
  assert.equal(books.formatBalance(1060.6), '1,061')
  assert.equal(books.shortfall(197.2), 123)
  assert.equal(books.shortfall(320), 0)
})

test('book writing requests an invite link only after confirming insufficient balance', async () => {
  const enoughCalls = []
  const enough = await books.writingContext({
    usage: { async balance() { enoughCalls.push('balance'); return { suanli: 320 } } },
    referral: { async link() { enoughCalls.push('invite'); return { url: 'unexpected' } } }
  })
  assert.deepEqual(enoughCalls, ['balance'])
  assert.deepEqual(enough, { balance: 320, invite: null })

  const shortCalls = []
  const invite = { url: 'https://example.test/invite' }
  const insufficient = await books.writingContext({
    usage: { async balance() { shortCalls.push('balance'); return { suanli: 100 } } },
    referral: { async link() { shortCalls.push('invite'); return invite } }
  })
  assert.deepEqual(shortCalls, ['balance', 'invite'])
  assert.deepEqual(insufficient, { balance: 100, invite })
})

test('about exposes help while settings does not duplicate the home book shelf', () => {
  const about = fs.readFileSync(path.join(root, 'pages/about/index.wxml'), 'utf8')
  const settingsPage = fs.readFileSync(path.join(root, 'pages/settings/index.wxml'), 'utf8')
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.match(about, /使用手册/)
  assert.match(about, /意见反馈/)
  assert.doesNotMatch(about, /写书/)
  assert.doesNotMatch(settingsPage, /实验功能/)
  assert.doesNotMatch(settingsPage, /写书/)
  ;['pages/manual/index', 'pages/feedback/index', 'pages/book-writing/index', 'pages/web/index']
    .forEach((page) => assert.ok(app.pages.includes(page)))
})

test('native manual uses the shared title bar and Android-style quick section navigation', () => {
  const about = fs.readFileSync(path.join(root, 'pages/about/index.js'), 'utf8')
  const markup = fs.readFileSync(path.join(root, 'pages/manual/index.wxml'), 'utf8')
  const source = fs.readFileSync(path.join(root, 'pages/manual/index.js'), 'utf8')
  const config = JSON.parse(fs.readFileSync(path.join(root, 'pages/manual/index.json'), 'utf8'))

  assert.match(about, /navigateTo\(\{ url: '\/pages\/manual\/index' \}\)/)
  assert.doesNotMatch(about, /help\/manual/)
  assert.equal(config.navigationStyle, 'custom')
  assert.match(markup, /<page-header[^>]*title="使用手册"/)
  assert.match(markup, /scroll-into-view="\{\{scrollTarget\}\}"/)
  assert.match(source, /manualService\.loadBundled\(\)/)
  assert.doesNotMatch(source, /syncManual|https:\/\/voicedrop\.cn\/help\/manual/)
  ;['1 上手', '2 录音', '3 改稿', '4 发布', '5 社区', '6 文风', '7 账号', '8 FAQ']
    .forEach((label) => assert.match(source, new RegExp(label)))
})

test('book writing page matches the current iOS price, seed and pipeline composition', () => {
  const markup = fs.readFileSync(path.join(root, 'pages/book-writing/index.wxml'), 'utf8')
  const source = fs.readFileSync(path.join(root, 'pages/book-writing/index.js'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/book-writing/index.wxss'), 'utf8')
  const config = JSON.parse(fs.readFileSync(path.join(root, 'pages/book-writing/index.json'), 'utf8'))

  assert.match(markup, /写一本书的价钱，提交时一次扣清/)
  assert.match(markup, /<page-header[^>]*title="写书"/)
  assert.equal(config.usingComponents['page-header'], '/components/page-header/index')
  assert.match(markup, /class="bolt ri-flashlight-line"/)
  assert.match(markup, /class="earn-summary"/)
  assert.match(markup, /i18n\["还差 "\]\}\}\{\{shortfall\}\}\{\{i18n\[" 算力，两条来路："\]/)
  assert.match(markup, /earn-icon-feed ri-flashlight-line/)
  assert.match(markup, /earn-icon-invite ri-group-line/)
  assert.match(markup, /placeholder="\{\{i18n\[seedPlaceholderKey\]\}\}"/)
  assert.match(source, /比如：为什么一切都在变乱？\\n或：钱不脏，是我一直躲着它。/)
  assert.match(markup, /中心思想/)
  assert.match(markup, /拆大纲[\s\S]*并行写[\s\S]*独立评审[\s\S]*上你的架/)
  assert.match(markup, /开始写书 · 320 算力/)
  assert.match(css, /\.price-card\s*\{[^}]*padding:\s*32rpx 36rpx;[^}]*border:\s*2rpx solid #ebd9b8;[^}]*border-radius:\s*24rpx;/s)
  assert.match(css, /\.feature-editor\s*\{[^}]*height:\s*316rpx;[^}]*border:\s*3rpx solid #d8593b;/s)
  assert.match(css, /\.book-placeholder\s*\{[^}]*font-size:\s*26rpx;/s)
  assert.match(css, /\.price\s*\{[^}]*align-items:\s*center;/s)
  assert.match(css, /\.step \+ \.step::before\s*\{[^}]*left:\s*116rpx;/s)
  assert.match(css, /\.num\s*\{[^}]*border-radius:\s*16rpx;[^}]*background:\s*#fae4dd;/s)
  assert.match(css, /\.feature-primary,[\s\S]*\.done\s*\{[^}]*height:\s*108rpx;/)
  assert.match(css, /\.done\s*\{[^}]*width:\s*260rpx;[^}]*height:\s*88rpx;[^}]*border-radius:\s*24rpx;/s)
  assert.doesNotMatch(css, /\.done\s*\{[^}]*border-radius:\s*999rpx;/s)
})

test('public shelf follows current iOS with a native shelf and in-app reader', () => {
  const source = fs.readFileSync(path.join(root, 'pages/book-writing/index.js'), 'utf8')
  const readerSource = fs.readFileSync(path.join(root, 'pages/book-reader/index.js'), 'utf8')
  const readerMarkup = fs.readFileSync(path.join(root, 'pages/book-reader/index.wxml'), 'utf8')
  const readerConfig = JSON.parse(fs.readFileSync(path.join(root, 'pages/book-reader/index.json'), 'utf8'))
  const webMarkup = fs.readFileSync(path.join(root, 'pages/web/index.wxml'), 'utf8')
  const webConfig = JSON.parse(fs.readFileSync(path.join(root, 'pages/web/index.json'), 'utf8'))
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))

  assert.match(source, /books\.writingContext\(\)/)
  assert.match(webMarkup, /<web-view[^>]*src="\{\{url\}\}"/)
  assert.notEqual(webConfig.navigationStyle, 'custom')
  assert.ok(app.pages.includes('pages/web/index'))
  assert.ok(app.pages.includes('pages/book-shelf/index'))
  assert.ok(app.pages.includes('pages/book-reader/index'))
  assert.equal(readerConfig.navigationStyle, 'custom')
  assert.match(readerMarkup, /bindload="onWebLoad"[^>]*binderror="onWebError"[\s\S]*class="reader-loading"/)
  assert.match(readerSource, /onLoad\(options\)[\s\S]*this\.bookUrl = books\.readerPageUrl\(book, decoded\(options\.page\)\)[\s\S]*onReady\(\)/)
  assert.doesNotMatch(readerSource, /wx\.(?:show|hide)Loading/)
  assert.match(readerSource, /this\.setData\(\{ url: this\.bookUrl,[^}]*\}\)[\s\S]*onReady\(\)[\s\S]*LOADING_LAYOUT_DELAY_MS/)
  assert.match(readerSource, /onWebLoad\(event\)[\s\S]*this\.bookUrl = books\.readerPageUrl\(this\.book, source \|\| this\.bookUrl\)[\s\S]*this\.finishLoading\(\)/)
  assert.match(readerSource, /wx\.showToast\(\{ title: '书籍加载失败', icon: 'none' \}\)/)
  const shelf = fs.readFileSync(path.join(root, 'pages/book-shelf/index.wxml'), 'utf8')
  assert.match(shelf, /写一本新书/)
  assert.match(shelf, /src="\{\{item\.coverDisplayUrl\}\}"/)
})

test('restyle requests use the five minute client timeout', () => {
  const source = fs.readFileSync(path.join(root, 'services/library.js'), 'utf8')
  assert.match(source, /agentBase\(\)\}\/restyle[\s\S]*timeout:\s*300000/)
})
