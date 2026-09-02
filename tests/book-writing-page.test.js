const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('book writing page prominently discloses AI-generated content', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/book-writing/index.wxml'), 'utf8')
  assert.match(wxml, /class="ai-generated-notice"/)
  assert.match(wxml, />\{\{i18n\["AI生成"\]\}\}</)
  assert.match(wxml, /i18n\["本功能使用人工智能生成书籍内容"\]/)
})

test('book writing template keeps its placeholder expression compiler-safe', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/book-writing/index.wxml'), 'utf8')
  assert.match(wxml, /placeholder="\{\{i18n\[seedPlaceholderKey\]\}\}"/)
  assert.doesNotMatch(wxml, /placeholder="\{\{seedArticle \?/, 'seed placeholder must not use a ternary')
})

test('book writing page localizes its dynamic labels and keeps the submit button full-width at a fixed height', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/book-writing/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(__dirname, '../pages/book-writing/index.wxss'), 'utf8')
  const i18n = require('../utils/i18n')

  assert.match(wxml, /i18n\[seedTitleKey\]/)
  assert.match(wxml, /i18n\[seedPlaceholderKey\]/)
  assert.match(wxml, /<button class="feature-primary" bindtap="start" disabled="\{\{!canSubmit\}\}">/)
  assert.equal(i18n.ui('中心思想', 'en'), 'Central idea')
  assert.equal(i18n.ui('AI生成', 'en'), 'AI-Generated')
  assert.match(i18n.ui('AI生成 · 提交后可关闭小程序，10–30 分钟写完并出现在「写书」书架', 'en'), /^AI-Generated ·/)
  assert.match(i18n.ui('比如：为什么一切都在变乱？\n或：钱不脏，是我一直躲着它。', 'en'), /^For example:/)
  assert.equal(i18n.ui('算力不够 · 还差 ', 'en') + 12, 'Not enough credits · Need 12')
  assert.equal(i18n.ui('开始写书 · ', 'en') + 160 + i18n.ui(' 算力', 'en'), 'Start writing · 160 credits')
  assert.match(css, /\.feature-primary\s*\{[^}]*width:\s*100%;[^}]*height:\s*auto;[^}]*min-height:\s*108rpx;[^}]*white-space:\s*normal;[^}]*word-break:\s*break-word;/s)
  assert.match(css, /\.feature-primary\[disabled\]\s*\{[^}]*border:\s*2rpx solid #d1cac0;[^}]*background:\s*#9b9388;[^}]*box-shadow:\s*none;/s)
})

test('book writing footer hint aligns with the body content', () => {
  const css = fs.readFileSync(path.join(__dirname, '../pages/book-writing/index.wxss'), 'utf8')

  assert.match(css, /\.writing-body\s*\{[^}]*padding:\s*8rpx 40rpx 60rpx;/s)
  assert.match(css, /\.writing-scroll\s*\{[^}]*bottom:\s*calc\(236rpx \+ env\(safe-area-inset-bottom\)\);/s)
  assert.match(css, /\.writing-bottom\s*\{[^}]*height:\s*calc\(236rpx \+ env\(safe-area-inset-bottom\)\);[^}]*padding:\s*20rpx 16rpx calc\(20rpx \+ env\(safe-area-inset-bottom\)\);/s)
  assert.match(css, /\.bottom-hint\s*\{[^}]*margin:\s*18rpx 24rpx 0;[^}]*text-align:\s*left;/s)
})

function loadWritingPage(start) {
  const events = []
  let definition
  const app = { globalData: {} }
  global.wx = {
    showLoading(options) { events.push(['showLoading', options]) },
    hideLoading() { events.push(['hideLoading']) }
  }
  global.getApp = () => app
  const booksPath = require.resolve('../services/books')
  const pagePath = require.resolve('../pages/book-writing/index.js')
  const originalBooks = require.cache[booksPath]
  require.cache[booksPath] = { exports: {
    BOOK_SUANLI: 320,
    start,
    result(response) { return { accepted: Boolean(response && response.statusCode === 202), message: '开始写了' } },
    formatBalance(value) { return String(value) },
    shortfall() { return 0 }
  } }
  global.Page = (value) => { definition = value }
  delete require.cache[pagePath]
  require(pagePath)
  delete global.Page
  delete require.cache[pagePath]
  if (originalBooks) require.cache[booksPath] = originalBooks
  else delete require.cache[booksPath]
  const page = {
    ...definition,
    data: { ...definition.data, seed: '一本书的种子', balance: 320 },
    setData(patch) {
      Object.assign(this.data, patch)
      if (patch.submitted) events.push(['submitted'])
    }
  }
  return { page, events, app }
}

test('book submission uses the system loading and hides it before success state', async () => {
  const { page, events } = loadWritingPage(async () => ({ statusCode: 202 }))
  await page.start()
  assert.deepEqual(events[0], ['showLoading', { title: '提交中…', mask: true }])
  assert.equal(events.filter(([name]) => name === 'hideLoading').length, 1)
  assert.ok(events.findIndex(([name]) => name === 'hideLoading') < events.findIndex(([name]) => name === 'submitted'))
  assert.equal(page.data.submitted, true)
})

test('book submission also hides loading when the request fails', async () => {
  const { page, events } = loadWritingPage(async () => { throw new Error('offline') })
  await page.start()
  assert.equal(events.filter(([name]) => name === 'showLoading').length, 1)
  assert.equal(events.filter(([name]) => name === 'hideLoading').length, 1)
  assert.equal(page.data.submitted, false)
})

test('article seed can start a book without supplemental input and keeps markers out of the request', async () => {
  let submittedSeed = ''
  const { page } = loadWritingPage(async (seed) => {
    submittedSeed = seed
    return { statusCode: 202 }
  })
  page.data.seed = ''
  page.data.seedArticle = { title: '我的文章', body: '第一段\n\n[[photo:photos/1.jpg]]\n\n第二段' }

  page.updateSubmit()
  assert.equal(page.data.canSubmit, true)
  await page.start()

  assert.equal(page.data.submitted, true)
  assert.match(submittedSeed, /《我的文章》/)
  assert.doesNotMatch(submittedSeed, /\[\[photo:/)
})

test('article seed combines optional instructions and clips the single server seed at 20,000 characters', () => {
  const { page } = loadWritingPage(async () => ({ statusCode: 202 }))
  page.data.seed = '写成科普书'
  page.data.seedArticle = { title: '标题', body: '文'.repeat(25000) }

  const seed = page.submissionSeed()
  assert.equal(seed.length, 20000)
  assert.match(seed, /^写书要求：写成科普书/)
  assert.match(seed, /以下这篇文章是种子素材，把它扩展成一本完整的书：/)
})
