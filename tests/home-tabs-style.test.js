const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')

function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  return match ? match[1] : ''
}

test('home tabs fixed header matches the iOS 22pt side padding', () => {
  const css = fs.readFileSync(path.join(root, 'components/home-tabs/index.wxss'), 'utf8')
  const head = ruleBody(css, '.home-head')
  const tabs = ruleBody(css, '.section-tabs')

  assert.match(head, /padding-left:\s*44rpx;/)
  assert.match(head, /padding-right:\s*44rpx;/)
  assert.match(head, /box-sizing:\s*border-box;/)
  assert.match(tabs, /padding-left:\s*44rpx;/)
  assert.match(tabs, /padding-right:\s*44rpx;/)
  assert.match(tabs, /box-sizing:\s*border-box;/)
})

test('settings shortcut uses a recommended tap target and optically balanced icon size', () => {
  const css = fs.readFileSync(path.join(root, 'components/home-tabs/index.wxss'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'components/home-tabs/index.wxml'), 'utf8')
  const button = ruleBody(css, '.settings-button')
  const surface = ruleBody(css, '.settings-button-surface')
  const icon = ruleBody(css, '.settings-icon')

  assert.match(wxml, /class="settings-icon settings-icon-gear"><\/text>/)
  assert.match(wxml, /class="settings-button-surface">/)
  assert.doesNotMatch(wxml, /<image[^>]+settings-icon/)
  assert.match(button, /width:\s*44px;/)
  assert.match(button, /height:\s*44px;/)
  assert.match(surface, /width:\s*32px;/)
  assert.match(surface, /height:\s*32px;/)
  assert.match(surface, /border-radius:\s*8px;/)
  assert.match(icon, /width:\s*21px;/)
  assert.match(icon, /height:\s*21px;/)
  assert.match(icon, /font-family:\s*'remixicon'\s*!important;/)
  assert.match(icon, /font-size:\s*21px;/)
  assert.match(icon, /line-height:\s*21px;/)
  assert.match(css, /\.settings-icon-gear::before\s*\{[^}]*content:\s*"\\f0e8";/s)
})

test('home typography keeps readable contrast and full-size tab targets', () => {
  const css = fs.readFileSync(path.join(root, 'components/home-tabs/index.wxss'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'components/home-tabs/index.wxml'), 'utf8')
  const brand = ruleBody(css, '.brand-name')
  const tabs = ruleBody(css, '.section-tabs')
  const tab = ruleBody(css, '.section-tab')
  const tabText = ruleBody(css, '.section-tab-text')
  const muted = ruleBody(css, '.muted-tab')

  assert.match(wxml, />\{\{brandName\}\}<\/text>/)
  assert.match(brand, /color:\s*#746d63;/)
  assert.match(tabs, /margin-top:\s*-8rpx;/)
  assert.match(tab, /min-height:\s*88rpx;/)
  assert.match(tabText, /font-size:\s*40rpx;/)
  assert.match(tabText, /font-weight:\s*800;/)
  assert.match(muted, /color:\s*#756f66;/)
})
