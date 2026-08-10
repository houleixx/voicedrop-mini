const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')

function freshManual() {
  let page
  global.Page = (definition) => { page = definition }
  global.wx = { nextTick: (callback) => callback() }
  delete require.cache[require.resolve('../pages/manual/index')]
  require('../pages/manual/index')
  const ctx = Object.assign({}, page, {
    data: Object.assign({}, page.data),
    setData(update) { Object.assign(this.data, update) }
  })
  return { page, ctx }
}

test('manual loads all chapters synchronously from bundled markdown', () => {
  const h = freshManual()

  h.page.onLoad.call(h.ctx)

  assert.equal(h.ctx.data.chapters.length, 8)
  assert.equal(h.ctx.data.error, '')
  assert.equal(Object.prototype.hasOwnProperty.call(h.ctx.data, 'loading'), false)
})

test('manual exposes all Android section shortcuts and jumps to the selected section', () => {
  const h = freshManual()

  h.page.jumpToSection.call(h.ctx, { currentTarget: { dataset: { id: 'ch4' } } })

  assert.equal(h.ctx.data.activeSection, 'ch4')
  assert.equal(h.ctx.data.scrollTarget, 'ch4')
  assert.deepEqual(h.ctx.data.sections.map((item) => item.label), [
    '1 上手', '2 录音', '3 改稿', '4 发布', '5 社区', '6 文风', '7 账号', '8 FAQ'
  ])
  h.page.onUnload.call(h.ctx)
})

test('manual keeps the tapped chapter selected while animated scrolling passes other chapters', () => {
  const h = freshManual()

  h.page.jumpToSection.call(h.ctx, { currentTarget: { dataset: { id: 'ch5' } } })
  for (const id of ['ch2', 'ch3', 'ch4']) {
    h.page.onSectionVisible.call(h.ctx, { currentTarget: { dataset: { id } } })
    assert.equal(h.ctx.data.activeSection, 'ch5')
  }
  h.page.onSectionVisible.call(h.ctx, { currentTarget: { dataset: { id: 'ch5' } } })
  h.page.onSectionVisible.call(h.ctx, { currentTarget: { dataset: { id: 'ch4' } } })
  assert.equal(h.ctx.data.activeSection, 'ch4')
  h.page.onUnload.call(h.ctx)
})

test('manual uses a custom title bar and native scroll content instead of web-view', () => {
  const markup = fs.readFileSync(path.join(root, 'pages/manual/index.wxml'), 'utf8')

  assert.match(markup, /<page-header title="使用手册"/)
  assert.match(markup, /class="manual-tabs" scroll-x/)
  assert.match(markup, /class="manual-content" scroll-y scroll-into-view="\{\{scrollTarget\}\}"/)
  assert.equal((markup.match(/bounces="\{\{true\}\}"/g) || []).length, 2)
  assert.match(markup, /wx:for="\{\{chapters\}\}"/)
  assert.match(markup, /<rich-text class="manual-rich" nodes="\{\{item\.html\}\}"/)
  assert.doesNotMatch(markup, /<web-view/)
  assert.doesNotMatch(markup, /VoiceDrop 把口述录音整理成/)
})

test('manual chapter shortcuts use explicit real-device-safe spacing', () => {
  const markup = fs.readFileSync(path.join(root, 'pages/manual/index.wxml'), 'utf8')
  const styles = fs.readFileSync(path.join(root, 'pages/manual/index.wxss'), 'utf8')
  const tabsInner = styles.match(/\.manual-tabs-inner\s*\{([^}]*)\}/)

  assert.doesNotMatch(markup, /<button[^>]*class="manual-tab/)
  assert.match(markup, /<view[^>]*class="manual-tab[^>]*bindtap="jumpToSection"/)
  assert.ok(tabsInner)
  assert.doesNotMatch(tabsInner[1], /\bgap\s*:/)
  assert.match(styles, /\.manual-tab\s*\+\s*\.manual-tab\s*\{[^}]*margin-left:\s*12rpx/)
})

test('manual content matches the iOS warm-paper reading surface without chapter cards', () => {
  const styles = fs.readFileSync(path.join(root, 'pages/manual/index.wxss'), 'utf8')
  const content = styles.match(/\.manual-content\s*\{([^}]*)\}/)
  const section = styles.match(/\.manual-section\s*\{([^}]*)\}/)

  assert.ok(content)
  assert.match(content[1], /background:\s*#f0ede7;/)
  assert.ok(section)
  assert.match(section[1], /border:\s*0;/)
  assert.match(section[1], /border-radius:\s*0;/)
  assert.match(section[1], /background:\s*transparent;/)
  assert.match(styles, /\.manual-section\s*\+\s*\.manual-section\s*\{[^}]*border-top:\s*2rpx solid #e5dfd5;/)
})
