const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')

function ruleBody(css, selector) {
  const match = css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))
  return match ? match[1] : ''
}

test('page header back button stays left aligned', () => {
  const css = fs.readFileSync(path.join(root, 'components/page-header/index.wxss'), 'utf8')
  const body = ruleBody(css, '.header-back')

  assert.match(body, /position:\s*absolute;/)
  assert.match(body, /left:\s*32rpx;/)
  assert.match(body, /bottom:\s*24rpx;/)
  assert.match(body, /z-index:\s*1;/)
})

test('page header title stays below the status bar', () => {
  const css = fs.readFileSync(path.join(root, 'components/page-header/index.wxss'), 'utf8')
  const title = ruleBody(css, '.header-title')
  const right = ruleBody(css, '.header-right')

  assert.doesNotMatch(title, /top:\s*0;/)
  assert.match(title, /bottom:\s*24rpx;/)
  assert.match(title, /height:\s*88rpx;/)
  assert.match(right, /height:\s*88rpx;/)
})

test('page header back icon is centered inside the button', () => {
  const css = fs.readFileSync(path.join(root, 'components/page-header/index.wxss'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'components/page-header/index.wxml'), 'utf8')
  const icon = ruleBody(css, '.header-back-icon')

  assert.doesNotMatch(wxml, />‹<\/text>/)
  assert.match(wxml, /class="header-back-icon header-back-icon-arrow"><\/text>/)
  assert.doesNotMatch(wxml, /&#xea60;/)
  assert.doesNotMatch(icon, /margin-top:\s*-/)
  assert.match(icon, /width:\s*38rpx;/)
  assert.match(icon, /height:\s*38rpx;/)
  assert.match(icon, /font-family:\s*'remixicon'\s*!important;/)
  assert.match(icon, /font-size:\s*38rpx;/)
  assert.match(icon, /font-weight:\s*700;/)
  assert.match(icon, /line-height:\s*38rpx;/)

  assert.match(css, /\.header-back-icon-arrow::before\s*\{[^}]*content:\s*"\\ea64";/s)
})

test('style settings page uses shared page header alignment', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/style-settings/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/style-settings/index.wxss'), 'utf8')

  assert.match(wxml, /<page-header title="写作风格"/)
  assert.match(wxml, /slot="right"[\s\S]*bindtap="done"[\s\S]*完成/)
  assert.doesNotMatch(wxml, /class="style-nav"/)
  assert.doesNotMatch(css, /\.style-nav\s*\{/)
})
