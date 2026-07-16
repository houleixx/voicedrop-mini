const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

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
