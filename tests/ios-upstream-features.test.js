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
})

test('about exposes help while settings owns the experimental book entry', () => {
  const about = fs.readFileSync(path.join(root, 'pages/about/index.wxml'), 'utf8')
  const settingsPage = fs.readFileSync(path.join(root, 'pages/settings/index.wxml'), 'utf8')
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.match(about, /使用手册/)
  assert.match(about, /意见反馈/)
  assert.doesNotMatch(about, /写书/)
  assert.match(settingsPage, /实验功能[\s\S]*写书[\s\S]*每本 320 算力/)
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
  assert.match(markup, /<page-header title="使用手册"/)
  assert.match(markup, /scroll-into-view="\{\{scrollTarget\}\}"/)
  assert.match(source, /manualService\.loadBundled\(\)/)
  assert.doesNotMatch(source, /syncManual|https:\/\/voicedrop\.cn\/help\/manual/)
  ;['1 上手', '2 录音', '3 改稿', '4 发布', '5 社区', '6 文风', '7 账号', '8 FAQ']
    .forEach((label) => assert.match(source, new RegExp(label)))
})

test('book writing page matches the supplied shelf composition and uses a real book icon', () => {
  const markup = fs.readFileSync(path.join(root, 'pages/book-writing/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/book-writing/index.wxss'), 'utf8')

  assert.match(markup, /先写大纲、再每章一个写手并行写正文/)
  assert.match(markup, /voicedrop\.cn\/books · 已出版的书都在这/)
  assert.match(markup, /ri-book-open-line/)
  assert.doesNotMatch(markup, /📚/)
  assert.match(markup, /书的种子：一个词、一句话，或一整篇文章……/)
  assert.match(css, /\.feature-editor\s*\{[^}]*height:\s*356rpx;[^}]*padding:\s*15rpx;[^}]*border:\s*2rpx solid #d8593b;/s)
})

test('public shelf follows iOS by opening the website under WeChat system navigation', () => {
  const source = fs.readFileSync(path.join(root, 'pages/book-writing/index.js'), 'utf8')
  const webMarkup = fs.readFileSync(path.join(root, 'pages/web/index.wxml'), 'utf8')
  const webConfig = JSON.parse(fs.readFileSync(path.join(root, 'pages/web/index.json'), 'utf8'))
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))

  assert.match(source, /pages\/web\/index\?url=/)
  assert.match(source, /encodeURIComponent\(books\.SHELF\)/)
  assert.match(source, /encodeURIComponent\('公开书架'\)/)
  assert.match(webMarkup, /<web-view[^>]*src="\{\{url\}\}"/)
  assert.notEqual(webConfig.navigationStyle, 'custom')
  assert.ok(app.pages.includes('pages/web/index'))
  assert.ok(!app.pages.includes('pages/book-shelf/index'))
  assert.ok(!app.pages.includes('pages/book-reader/index'))
})

test('restyle requests use the five minute client timeout', () => {
  const source = fs.readFileSync(path.join(root, 'services/library.js'), 'utf8')
  assert.match(source, /agentBase\(\)\}\/restyle[\s\S]*timeout:\s*300000/)
})
