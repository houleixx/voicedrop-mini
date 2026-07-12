const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function freshComponent() {
  let definition
  global.Component = (value) => { definition = value }
  global.wx = { vibrateShort() {} }
  delete require.cache[require.resolve('../components/config-menu/index')]
  require('../components/config-menu/index')
  return definition
}

function ctx(component) {
  const events = []
  return {
    data: {
      groups: [[{ id: 'style', label: '图片风格', type: 'submenu', children: [{ id: 'cartoon', label: '卡通', instruction: '画图' }] }]],
      openNode: null
    },
    setData(update) { Object.assign(this.data, update) },
    triggerEvent(name, detail) { events.push({ name, detail }) },
    events
  }
}

test('config menu enters and returns from a submenu', () => {
  const component = freshComponent()
  const state = ctx(component)
  component.methods.openSubmenu.call(state, { currentTarget: { dataset: { group: 0, index: 0 } } })
  assert.equal(state.data.openNode.id, 'style')
  component.methods.back.call(state)
  assert.equal(state.data.openNode, null)
})

test('config menu emits a picked leaf and lets the parent close after consuming it', () => {
  const component = freshComponent()
  const state = ctx(component)
  state.data.openNode = state.data.groups[0][0]
  component.methods.pickChild.call(state, { currentTarget: { dataset: { index: 0 } } })
  assert.equal(state.events[0].name, 'pick')
  assert.equal(state.events[0].detail.node.id, 'cartoon')
  assert.equal(state.events.length, 1)
})

test('config menu renders an overlay, lifted target, and submenu back row', () => {
  const root = path.join(__dirname, '..')
  const wxml = fs.readFileSync(path.join(root, 'components/config-menu/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(root, 'components/config-menu/index.wxss'), 'utf8')
  assert.match(wxml, /config-menu-scrim/)
  assert.match(wxml, /config-menu-anchor/)
  assert.match(wxml, /bindtap="back"/)
  assert.match(wxml, /class="config-menu-card"[^>]*max-height:\{\{anchor\.menuMaxHeight\}\}px;[^>]*>[\s\S]*wx:if="\{\{openNode\}\}"[\s\S]*wx:else/)
  assert.match(wxss, /#faf6ef/i)
  assert.match(wxss, /border-radius:\s*13px/)
  assert.match(wxss, /\.config-menu-card\{[^}]*overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch/s)
})
