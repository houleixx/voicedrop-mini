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

test('page header title stays below the status bar and centers with the back button', () => {
  const css = fs.readFileSync(path.join(root, 'components/page-header/index.wxss'), 'utf8')
  const title = ruleBody(css, '.header-title')
  const right = ruleBody(css, '.header-right')

  assert.doesNotMatch(title, /top:\s*0;/)
  assert.match(title, /bottom:\s*24rpx;/)
  assert.match(title, /height:\s*64rpx;/)
  assert.match(title, /line-height:\s*64rpx;/)
  assert.match(right, /height:\s*88rpx;/)
})

test('page header can move actions clear of the WeChat capsule and left-align detail titles', () => {
  const css = fs.readFileSync(path.join(root, 'components/page-header/index.wxss'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'components/page-header/index.wxml'), 'utf8')
  assert.match(wxml, /safeRightAction/)
  assert.match(wxml, /titleAlign/)
  assert.match(wxml, /header-right[^>]*right:/)
  assert.match(wxml, /safeRightAction \? toolbarTop/)
  assert.match(wxml, /safeRightAction \? toolbarHeight/)
  assert.match(css, /\.header-title\.title-left\s*\{[^}]*text-align:\s*left;/s)
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
