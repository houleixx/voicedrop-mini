const test = require('node:test')
const assert = require('node:assert/strict')
const i18n = require('../utils/i18n')
const recording = require('../utils/recording')
const books = require('../services/books')
const article = require('../utils/article')
const styleRewrite = require('../utils/style-rewrite')
const fs = require('fs')
const path = require('path')

test('language selection accepts only supported app languages', () => {
  assert.equal(i18n.normalizeLanguage('en_US'), 'en')
  assert.equal(i18n.normalizeLanguage('zh_CN'), 'zh-Hans')
  assert.equal(i18n.normalizeLanguage('fr-FR'), '')
})

test('follow-system resolves from the WeChat system locale', () => {
  const storage = { get: () => '', put: () => {} }
  assert.equal(i18n.currentLanguage(storage, { language: 'en_US' }), 'en')
  assert.equal(i18n.currentLanguage(storage, { language: 'zh_CN' }), 'zh-Hans')
})

test('a fixed language persists independently of the system locale', () => {
  const values = {}
  const storage = { get: (key) => values[key], put: (key, value) => { values[key] = value } }
  i18n.setSelectedLanguage('en', storage)
  assert.equal(i18n.selectedLanguage(storage), 'en')
  assert.equal(i18n.currentLanguage(storage, { language: 'zh_CN' }), 'en')
  assert.equal(i18n.languageLabel('', storage, { language: 'en_US' }), 'Follow System')
  assert.equal(i18n.ui('设置', 'en'), 'Settings')
  assert.equal(i18n.ui('设置', 'zh-Hans'), '设置')
})

test('language changes notify active pages and update app-wide language state', () => {
  const previousGetApp = global.getApp
  const previousGetCurrentPages = global.getCurrentPages
  const app = { globalData: {} }
  let observed = ''
  global.getApp = () => app
  global.getCurrentPages = () => [{ onLanguageChanged: (language) => { observed = language } }]
  assert.equal(i18n.notifyLanguageChanged('en'), 'en')
  assert.equal(app.globalData.language, 'en')
  assert.equal(app.globalData.languageRevision, 1)
  assert.equal(observed, 'en')
  global.getApp = previousGetApp
  global.getCurrentPages = previousGetCurrentPages
})

test('language settings applies a selected option only after Done', () => {
  let page
  const values = {}
  const navigations = []
  global.Page = (definition) => { page = definition }
  global.wx = {
    getStorageSync: (key) => values[key],
    setStorageSync: (key, value) => { values[key] = value },
    getSystemInfoSync: () => ({ language: 'zh_CN' }),
    showToast: () => {},
    reLaunch: () => { throw new Error('language selection must not relaunch the home page') },
    navigateBack: (options) => navigations.push(options)
  }
  delete require.cache[require.resolve('../pages/language-settings/index')]
  require('../pages/language-settings/index')
  const ctx = {
    data: Object.assign({}, page.data),
    setData(update) { Object.assign(this.data, update) }
  }

  page.selectLanguage.call(ctx, { detail: { value: 'en' } })

  assert.equal(values[i18n.LANGUAGE_KEY], undefined)
  assert.equal(ctx.data.selectedLanguage, 'en')

  page.applyLanguage.call(ctx)

  assert.equal(values[i18n.LANGUAGE_KEY], 'en')
  assert.equal(ctx.data.effectiveLanguage, 'en')
  assert.equal(ctx.data.labels.title, 'Language')
  assert.deepEqual(navigations, [{ delta: 1 }])
})

test('language settings page presents exactly the three iOS-equivalent choices', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '..', 'pages/language-settings/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(__dirname, '..', 'pages/language-settings/index.wxss'), 'utf8')
  assert.match(wxml, /value="" checked="\{\{selectedLanguage === ''\}\}"/)
  assert.match(wxml, /value="zh-Hans"/)
  assert.match(wxml, /value="en"/)
  assert.match(wxml, /<button class="language-done" bindtap="applyLanguage">/)
  assert.doesNotMatch(wxml, /section-header/)
  assert.match(wxml, /class="language-hint">\{\{labels\.hint\}\}<\/text>\s*<view class="card language-card">/)
  assert.match(wxss, /--settings-content-top:\s*198rpx/)
  assert.match(wxss, /\.language-hint\s*\{[^}]*margin:\s*0 12rpx 20rpx;/s)
})

test('home tabs recomputes its brand and accessibility copy after a language change', () => {
  let component
  const previousComponent = global.Component
  const previousWx = global.wx
  global.Component = (definition) => { component = definition }
  global.wx = {
    getStorageSync: (key) => key === i18n.LANGUAGE_KEY ? 'en' : undefined,
    getSystemInfoSync: () => ({ language: 'zh_CN' })
  }
  delete require.cache[require.resolve('../components/home-tabs/index')]
  require('../components/home-tabs/index')
  const ctx = {
    data: Object.assign({}, component.data),
    properties: {
      tabs: [
        { key: 'recordings', label: '我的录音' },
        { key: 'community', label: 'VD社区' },
        { key: 'books', label: '写书' }
      ]
    },
    setData(update) { Object.assign(this.data, update) }
  }

  component.methods.refreshTabs.call(ctx)

  assert.equal(ctx.data.brandName, 'VoiceDrop Dictation')
  assert.equal(ctx.data.settingsLabel, 'Settings')
  assert.deepEqual(ctx.data.displayTabs.map((tab) => tab.label), ['My recordings', 'VD Community', 'Write a book'])
  global.Component = previousComponent
  global.wx = previousWx
})

test('native interface feedback is English without translating user-facing content labels', () => {
  assert.equal(i18n.message('加载失败', i18n.ENGLISH), 'Failed to load')
  assert.equal(i18n.message('上传失败，请稍后再试', i18n.ENGLISH), 'Upload failed, Please try again later')
  assert.doesNotMatch(i18n.message('上传失败，请稍后再试', i18n.ENGLISH), /[\u4e00-\u9fff]/)
  // Titles may be user-created content, so shell translation remains exact-only.
  assert.equal(i18n.ui('我的中文提示词', i18n.ENGLISH), '我的中文提示词')
})

test('recording state and About privacy copy follow the app language', () => {
  assert.equal(i18n.ui('正在录音', i18n.ENGLISH), 'Recording')
  assert.match(i18n.message('录音、文章、图片、文风和公众号配置会按访问令牌同步到 VoiceDrop 后端。请妥善保存访问令牌。', i18n.ENGLISH), /synced to the VoiceDrop backend/)
})

test('audio detail overflow-menu actions follow the app language', () => {
  assert.equal(i18n.ui('发布公众号草稿', i18n.ENGLISH), 'Publish Official Account draft')
  assert.equal(i18n.ui('更新公众号草稿', i18n.ENGLISH), 'Update Official Account draft')
  assert.match(i18n.ui('微信卡片准备失败，点此重试', i18n.ENGLISH), /Tap to retry/)
})

test('style rewrite labels and actions follow the app language', () => {
  const originalCurrentLanguage = i18n.currentLanguage
  try {
    i18n.currentLanguage = () => i18n.ENGLISH
    assert.equal(styleRewrite.styleLabel(3), 'v3 style')
    assert.equal(styleRewrite.buttonText(3, {}), 'Rewrite this article with v3 style')
    assert.equal(styleRewrite.buttonText(3, { 3: { v: 1 } }), 'Switch to v3 style')
  } finally {
    i18n.currentLanguage = originalCurrentLanguage
  }
})

test('recording-generated metadata follows the app language', () => {
  const originalCurrentLanguage = i18n.currentLanguage
  try {
    i18n.currentLanguage = () => i18n.ENGLISH
    const row = recording.fromRemoteFile({ name: 'VoiceDrop-2026-09-01-090000-1m30s-Mon-Morning.m4a' }, new Set())
    assert.equal(row.rowTitle, 'Tue·Morning')
    assert.equal(row.timeLabel, 'Sep 1, 09:00')
    assert.equal(row.statusLabel, 'Pending')
  } finally {
    i18n.currentLanguage = originalCurrentLanguage
  }
})

test('book revision timestamps follow the app language', () => {
  const originalCurrentLanguage = i18n.currentLanguage
  try {
    i18n.currentLanguage = () => i18n.ENGLISH
    assert.equal(books.formatThreadStamp(new Date(2026, 8, 1, 9, 5).getTime()), 'Sep 1, 09:05')
  } finally {
    i18n.currentLanguage = originalCurrentLanguage
  }
})

test('book service feedback follows the app language', () => {
  const originalCurrentLanguage = i18n.currentLanguage
  try {
    i18n.currentLanguage = () => i18n.ENGLISH
    assert.match(books.message(402, { need_suanli: 320, suanli: 10 }), /^Not enough credits:/)
    assert.match(books.reviseMessage(403), /Only this book/)
  } finally {
    i18n.currentLanguage = originalCurrentLanguage
  }
})

test('WeChat publishing feedback follows the app language', () => {
  const originalCurrentLanguage = i18n.currentLanguage
  try {
    i18n.currentLanguage = () => i18n.ENGLISH
    assert.match(article.wechatMessage(45009), /publishing limit/i)
  } finally {
    i18n.currentLanguage = originalCurrentLanguage
  }
})
