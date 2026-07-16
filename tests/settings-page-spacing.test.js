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

  for (const page of ['settings', 'account', 'usage', 'wechat-settings', 'about', 'audio-consent']) {
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

test('settings card dividers start at the menu text column', () => {
  const styles = read('pages/settings/index.wxss')

  assert.match(styles, /\.menu-item\s*\{[^}]*position:\s*relative;/s)
  assert.doesNotMatch(styles, /\.menu-item\s*\{[^}]*border-bottom:/s)
  assert.match(styles, /\.menu-item::after\s*\{[^}]*left:\s*124rpx;[^}]*right:\s*0;[^}]*height:\s*1rpx;[^}]*background:\s*#f0e8da;/s)
  assert.match(styles, /\.menu-item:last-child::after,\s*\.menu-item\.no-bottom-border::after\s*\{[^}]*display:\s*none;/s)
})
