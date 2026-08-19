const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const capsuleLayout = require('../utils/capsule-layout')

test('converts the shared toolbar gap from rpx to device pixels', () => {
  assert.equal(capsuleLayout.rpxToPx({ windowWidth: 375 }, 14), 7)
  assert.equal(capsuleLayout.rpxToPx({ windowWidth: 750 }, 14), 14)
})

test('community article uses the same capsule gap as audio detail', () => {
  const detail = fs.readFileSync(path.join(root, 'pages/detail/index.js'), 'utf8')
  const communityDetail = fs.readFileSync(path.join(root, 'pages/community-detail/index.js'), 'utf8')
  const communityDetailStyles = fs.readFileSync(path.join(root, 'pages/community-detail/index.wxss'), 'utf8')

  for (const source of [detail, communityDetail]) {
    assert.match(source, /const TOOLBAR_ACTION_GAP_RPX = 14/)
    assert.match(
      source,
      /capsuleLayout\.safeRightPx\([\s\S]*?capsuleLayout\.rpxToPx\(sysInfo, TOOLBAR_ACTION_GAP_RPX\)/
    )
  }
  assert.match(communityDetailStyles, /\.detail-toolbar\s*\{[^}]*padding:\s*0 0 0 32rpx;/s)
})

function loadComponent(modulePath, wxApi) {
  let definition
  global.Component = (value) => { definition = value }
  global.wx = wxApi
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const ctx = {
    data: Object.assign({}, definition.data),
    setData(update) { Object.assign(this.data, update) }
  }
  definition.lifetimes.attached.call(ctx)
  return ctx
}

test('page header moves right actions left of a wide desktop capsule', () => {
  const ctx = loadComponent('../components/page-header/index', {
    getSystemInfoSync: () => ({ statusBarHeight: 0, windowWidth: 900 }),
    getMenuButtonBoundingClientRect: () => ({ top: 8, height: 32, left: 742, right: 890, width: 148 })
  })

  assert.equal(ctx.data.capsuleSafeRightPx, 168)
})

test('home settings button uses the same desktop capsule safe edge', () => {
  const ctx = loadComponent('../components/home-tabs/index', {
    getSystemInfoSync: () => ({ statusBarHeight: 0, windowWidth: 900 }),
    getMenuButtonBoundingClientRect: () => ({ top: 8, height: 32, left: 742, right: 890, width: 148 })
  })

  assert.equal(ctx.data.capsuleSafeRightPx, 168)
})

test('all custom top actions bind their right edge to the measured capsule inset', () => {
  const pageHeader = fs.readFileSync(path.join(root, 'components/page-header/index.wxml'), 'utf8')
  const homeTabs = fs.readFileSync(path.join(root, 'components/home-tabs/index.wxml'), 'utf8')
  const detail = fs.readFileSync(path.join(root, 'pages/detail/index.wxml'), 'utf8')
  const communityDetail = fs.readFileSync(path.join(root, 'pages/community-detail/index.wxml'), 'utf8')

  assert.match(pageHeader, /safeRightAction \? capsuleSafeRightPx \+ 'px'/)
  assert.match(homeTabs, /right: \{\{capsuleSafeRightPx\}\}px/)
  assert.match(detail, /inline-edit-action done[^>]*right: \{\{capsuleSafeRightPx\}\}px/)
  assert.match(detail, /toolbar-actions[^>]*padding-right: \{\{capsuleSafeRightPx\}\}px/)
  assert.match(communityDetail, /toolbar-actions[^>]*padding-right: \{\{capsuleSafeRightPx\}\}px/)
})

test('all more-menu buttons use the shared font icon instead of dot characters', () => {
  const menuPages = [
    'pages/detail/index.wxml',
    'pages/community-detail/index.wxml',
    'pages/shared-article/index.wxml'
  ]

  for (const relativePath of menuPages) {
    const wxml = fs.readFileSync(path.join(root, relativePath), 'utf8')
    const menuButton = wxml.match(/<button\b[^>]*aria-label="更多"[^>]*>[\s\S]*?<\/button>/)?.[0]

    assert.ok(menuButton, `${relativePath} should contain a more-menu button`)
    assert.match(menuButton, /\bri-more-fill\b/, `${relativePath} should use the shared font icon`)
    assert.doesNotMatch(menuButton, /•{3}|⋯/, `${relativePath} should not render dot characters`)
  }
})

test('detail toolbar surfaces match the home settings button size', () => {
  const home = fs.readFileSync(path.join(root, 'components/home-tabs/index.wxss'), 'utf8')
  const detail = fs.readFileSync(path.join(root, 'pages/detail/index.wxss'), 'utf8')
  const community = fs.readFileSync(path.join(root, 'pages/community-detail/index.wxss'), 'utf8')
  const shared = fs.readFileSync(path.join(root, 'pages/shared-article/index.wxss'), 'utf8')

  assert.match(home, /\.settings-button-surface\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/s)
  for (const css of [detail, community, shared]) {
    assert.match(css, /\.tool-button\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/s)
  }
  assert.match(detail, /\.back-icon\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/s)
  assert.match(community, /\.back-icon\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/s)
  assert.match(shared, /\.back-icon\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/s)
  for (const css of [detail, community, shared]) {
    assert.match(css, /\.back-button\s*\{[^}]*margin-left:\s*-5px;[^}]*width:\s*44px;[^}]*height:\s*44px;/s)
  }
})
