const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

test('settings entry pages use the shared content start below the custom header', () => {
  const shared = read('app.wxss')
  assert.match(shared, /\.settings-screen\s*\{[^}]*padding:\s*0\s+32rpx/s)
  assert.match(shared, /--settings-content-top:\s*\d+rpx;/)
  assert.match(shared, /\.settings-screen\s*>\s*\.page-body,[\s\S]*\.settings-screen\s*>\s*\.settings-content\s*\{[^}]*padding-top:\s*var\(--settings-content-top\)\s*!important/s)

  for (const page of ['settings', 'account', 'usage', 'wechat-settings', 'about', 'blocked-users', 'audio-consent']) {
    assert.match(read(`pages/${page}/index.wxml`), /class="screen[^\"]*settings-screen/)
  }

  assert.match(read('pages/settings/index.wxml'), /<view class="screen settings-screen settings-page">/)
  assert.doesNotMatch(read('pages/settings/index.wxml'), /<view class="screen[^\"]*page-body/)

  const account = read('pages/account/index.wxss')
  const about = read('pages/about/index.wxss')
  assert.match(account, /\.account-card\s*\{[^}]*margin-top:\s*0;/s)
  assert.match(about, /\.about-card\s*\{[^}]*margin-top:\s*0;/s)
})

test('prompt and writing setting pages inherit the shared content start', () => {
  for (const page of ['style-settings', 'instruction-settings', 'instruction-edit', 'prompt-new', 'prompt-import']) {
    assert.match(read(`pages/${page}/index.wxml`), /settings-content/)
  }

  assert.doesNotMatch(read('pages/usage/index.wxss'), /padding-top:/)
})

test('writing style settings use one active version without multi-style comparison', () => {
  const markup = read('pages/style-settings/index.wxml')
  const logic = read('pages/style-settings/index.js')

  assert.match(markup, /v\{\{selectedHead\}\}/)
  assert.match(markup, /bindtap="selectStyleVersion"/)
  assert.doesNotMatch(markup, /多风格对比|compareMode|selectedStyles|最多选 3 个/)
  assert.doesNotMatch(logic, /saveStyleSelection|onCompareModeChange|selectedStyles/)
})

test('mini program omits the share collection page and service', () => {
  const app = JSON.parse(read('app.json'))
  const manual = read('assets/help_manual.md')

  assert.equal(app.pages.includes('pages/share-collect/index'), false)
  assert.equal(fs.existsSync(path.join(root, 'pages/share-collect')), false)
  assert.equal(fs.existsSync(path.join(root, 'services/share-collect.js')), false)
  assert.doesNotMatch(manual, /素材收集页|收集文风|风格数据集|提取文章风格/)
})

test('settings card dividers start at the menu text column', () => {
  const styles = read('pages/settings/index.wxss')

  assert.match(styles, /\.menu-item\s*\{[^}]*position:\s*relative;/s)
  assert.doesNotMatch(styles, /\.menu-item\s*\{[^}]*border-bottom:/s)
  assert.match(styles, /\.menu-item::after\s*\{[^}]*left:\s*124rpx;[^}]*right:\s*0;[^}]*height:\s*1rpx;[^}]*background:\s*#f0e8da;/s)
  assert.match(styles, /\.menu-item:last-child::after,\s*\.menu-item\.no-bottom-border::after\s*\{[^}]*display:\s*none;/s)
})

test('settings landing page keeps compact groups and readable secondary text', () => {
  const styles = read('pages/settings/index.wxss')

  assert.match(styles, /\.settings-page\s*\{[^}]*--settings-content-top:\s*198rpx;/s)
  assert.match(styles, /\.menu-card\s*\{[^}]*margin-top:\s*12rpx;/s)
  assert.match(styles, /\.section-header\s*\{[^}]*margin-top:\s*36rpx;[^}]*margin-bottom:\s*12rpx;[^}]*color:\s*#756f66;[^}]*font-size:\s*26rpx;[^}]*line-height:\s*36rpx;/s)
  assert.match(styles, /\.menu-item\s*\{[^}]*min-height:\s*120rpx;[^}]*padding:\s*20rpx 28rpx;/s)
  assert.match(styles, /\.menu-title\s*\{[^}]*font-size:\s*32rpx;/s)
  assert.match(styles, /\.menu-subtitle\s*\{[^}]*color:\s*#756f66;[^}]*font-size:\s*24rpx;/s)
  assert.match(styles, /\.menu-id\s*\{[^}]*color:\s*#756f66;/s)
  assert.match(styles, /\.menu-status\s*\{[^}]*color:\s*#756f66;/s)
  assert.match(styles, /\.menu-arrow\s*\{[^}]*color:\s*#9b8f7f;/s)
})

test('settings icon tiles use the shared semantic palette', () => {
  const styles = read('pages/settings/index.wxss')

  assert.match(styles, /\.icon-dark\s*\{[^}]*background:\s*#2a2521;/s)
  assert.match(styles, /\.icon-dark \.menu-icon-text\s*\{[^}]*color:\s*#ffffff;/s)
  assert.match(styles, /\.icon-amber\s*\{[^}]*background:\s*#fbead2;/s)
  assert.match(styles, /\.icon-amber \.menu-icon-text\s*\{[^}]*color:\s*#c98a2e;/s)
  assert.match(styles, /\.icon-beige\s*\{[^}]*background:\s*#f1ece3;/s)
  assert.match(styles, /\.icon-beige \.menu-icon-text\s*\{[^}]*color:\s*#8a8175;/s)
  assert.match(styles, /\.icon-pink\s*\{[^}]*background:\s*#f6e4dc;/s)
  assert.match(styles, /\.icon-pink \.menu-icon-text\s*\{[^}]*color:\s*#d8593b;/s)
  assert.match(styles, /\.icon-green\s*\{[^}]*background:\s*#eaf1ec;/s)
  assert.match(styles, /\.icon-green \.menu-icon-text\s*\{[^}]*color:\s*#5e8a6a;/s)
})

test('profile name dialog buttons stay inside the dialog', () => {
  const styles = read('pages/settings/index.wxss')

  assert.match(styles, /\.dialog-actions\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;[^}]*gap:\s*18rpx;/s)
  assert.match(styles, /\.dialog-button\s*\{[^}]*flex:\s*1\s+1\s+0;[^}]*width:\s*0;[^}]*min-width:\s*0;[^}]*margin:\s*0;/s)
})

test('about pages inherit the compact settings rhythm and readable secondary text', () => {
  const aboutMarkup = read('pages/about/index.wxml')
  const aboutStyles = read('pages/about/index.wxss')
  const agreementMarkup = read('pages/audio-consent/index.wxml')
  const agreementStyles = read('pages/audio-consent/index.wxss')

  assert.match(aboutMarkup, /class="screen settings-screen about-page"/)
  assert.match(aboutStyles, /\.about-page\s*\{[^}]*--settings-content-top:\s*198rpx;/s)
  assert.match(aboutStyles, /\.about-card\s*\{[^}]*margin-top:\s*0;[^}]*padding:\s*32rpx;/s)
  assert.match(aboutStyles, /\.desc\s*\{[^}]*color:\s*#756f66;[^}]*font-size:\s*26rpx;/s)
  assert.match(aboutStyles, /\.version\s*\{[^}]*color:\s*#756f66;[^}]*font-size:\s*24rpx;/s)
  assert.match(aboutStyles, /\.menu\s*\{[^}]*margin-top:\s*0;/s)
  assert.match(aboutMarkup, /class="row blocked-entry" bindtap="openBlockedUsers"/)
  assert.match(aboutMarkup, /\{\{blockedAuthors\.length \+ i18n\[' 人'\]\}\}/)
  assert.doesNotMatch(aboutMarkup, /class="card blocked"/)
  assert.match(aboutStyles, /\.menu \.row\s*\{[^}]*min-height:\s*120rpx;[^}]*padding:\s*20rpx 28rpx;/s)
  assert.match(aboutStyles, /\.about-menu-subtitle,[\s\S]*\.about-menu-status\s*\{[^}]*color:\s*#756f66;[^}]*font-size:\s*24rpx;/s)
  assert.match(aboutStyles, /\.about-arrow\s*\{[^}]*color:\s*#9b8f7f;/s)

  const blockedMarkup = read('pages/blocked-users/index.wxml')
  const blockedStyles = read('pages/blocked-users/index.wxss')
  assert.match(blockedMarkup, /社区屏蔽管理/)
  assert.match(blockedMarkup, /wx:for="\{\{blockedAuthors\}\}"/)
  assert.match(blockedMarkup, /取消屏蔽/)
  assert.match(blockedStyles, /\.blocked-row\s*\{[^}]*min-height:\s*112rpx;/s)
  assert.match(blockedStyles, /\.blocked-action\s*\{[^}]*width:\s*176rpx;[^}]*margin-left:\s*auto;[^}]*flex:\s*0 0 176rpx;/s)
  assert.match(blockedStyles, /\.unblock\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*margin:\s*0;[^}]*background:\s*#fbe8df;/s)

  assert.match(agreementMarkup, /class="screen settings-screen agreement-page"/)
  assert.match(agreementStyles, /\.agreement-page\s*\{[^}]*--settings-content-top:\s*198rpx;/s)
  assert.match(agreementStyles, /\.agreement-card\s*\{[^}]*padding:\s*32rpx;/s)
  assert.match(agreementStyles, /\.agreement-section\s*\{[^}]*margin-top:\s*32rpx;/s)
  assert.match(agreementStyles, /\.agreement-meta\s*\{[^}]*margin-top:\s*40rpx;[^}]*color:\s*#756f66;/s)
})
