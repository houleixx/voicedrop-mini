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

test('home tabs fixed header keeps screen side padding', () => {
  const css = fs.readFileSync(path.join(root, 'components/home-tabs/index.wxss'), 'utf8')
  const head = ruleBody(css, '.home-head')
  const tabs = ruleBody(css, '.section-tabs')

  assert.match(head, /padding-left:\s*32rpx;/)
  assert.match(head, /padding-right:\s*32rpx;/)
  assert.match(head, /box-sizing:\s*border-box;/)
  assert.match(tabs, /padding-left:\s*32rpx;/)
  assert.match(tabs, /padding-right:\s*32rpx;/)
  assert.match(tabs, /box-sizing:\s*border-box;/)
})

test('settings shortcut uses recommended tap target and icon size', () => {
  const css = fs.readFileSync(path.join(root, 'components/home-tabs/index.wxss'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'components/home-tabs/index.wxml'), 'utf8')
  const button = ruleBody(css, '.settings-button')
  const icon = ruleBody(css, '.settings-icon')

  assert.match(wxml, /class="settings-icon settings-icon-gear"><\/text>/)
  assert.doesNotMatch(wxml, /<image[^>]+settings-icon/)
  assert.match(button, /width:\s*32px;/)
  assert.match(button, /height:\s*32px;/)
  assert.match(button, /border-radius:\s*8px;/)
  assert.match(icon, /width:\s*44rpx;/)
  assert.match(icon, /height:\s*44rpx;/)
  assert.match(icon, /font-family:\s*'remixicon'\s*!important;/)
  assert.match(icon, /font-size:\s*42rpx;/)
  assert.match(icon, /line-height:\s*44rpx;/)
  assert.match(css, /\.settings-icon-gear::before\s*\{[^}]*content:\s*"\\f0e8";/s)
})
