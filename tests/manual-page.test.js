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

test('manual exposes all Android section shortcuts and jumps to the selected section', () => {
  const h = freshManual()

  h.page.jumpToSection.call(h.ctx, { currentTarget: { dataset: { id: 'ch4' } } })

  assert.equal(h.ctx.data.activeSection, 'ch4')
  assert.equal(h.ctx.data.scrollTarget, 'ch4')
  assert.deepEqual(h.ctx.data.sections.map((item) => item.label), [
    '1 上手', '2 录音', '3 改稿', '4 发布', '5 社区', '6 文风', '7 账号', '8 FAQ'
  ])
})

test('manual uses a custom title bar and native scroll content instead of web-view', () => {
  const markup = fs.readFileSync(path.join(root, 'pages/manual/index.wxml'), 'utf8')

  assert.match(markup, /<page-header title="使用手册"/)
  assert.match(markup, /class="manual-tabs" scroll-x/)
  assert.match(markup, /class="manual-content" scroll-y scroll-into-view="\{\{scrollTarget\}\}"/)
  assert.match(markup, /wx:for="\{\{chapters\}\}"/)
  assert.match(markup, /<rich-text class="manual-rich" nodes="\{\{item\.html\}\}"/)
  assert.doesNotMatch(markup, /<web-view/)
  assert.doesNotMatch(markup, /VoiceDrop 把口述录音整理成/)
})
