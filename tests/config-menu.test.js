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
      fixedNodes: [{ id: 'style', label: '图片风格', type: 'submenu', children: [{ id: 'cartoon', label: '卡通', instruction: '画图' }] }],
      customNodes: [],
      openNode: null
    },
    properties: { anchor: { menuMaxHeight: 320 } },
    setData(update) { Object.assign(this.data, update) },
    triggerEvent(name, detail) { events.push({ name, detail }) },
    events
  }
}

test('config menu enters and returns from a submenu', () => {
  const component = freshComponent()
  const state = ctx(component)
  component.methods.openSubmenu.call(state, { currentTarget: { dataset: { zone: 'fixed', index: 0 } } })
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

test('config menu keeps system rows fixed and allocates overflow only to custom rows', () => {
  const component = freshComponent()
  const state = ctx(component)
  component.observers['open,menu,anchor,localRows'].call(state, true, { groups: [[
    { id: 'sys', label: '系统', origin: 'system', instruction: 'S' },
    { id: 'custom-a', label: '自定义 A', origin: 'user', instruction: 'A' },
    { id: 'custom-b', label: '自定义 B', origin: 'custom', instruction: 'B' }
  ]] }, { menuMaxHeight: 200 }, [{ id: 'copy', label: '拷贝' }, { id: 'edit', label: '编辑' }])

  assert.deepEqual(state.data.fixedNodes.map((node) => node.id), ['sys'])
  assert.deepEqual(state.data.customNodes.map((node) => node.id), ['custom-a', 'custom-b'])
  assert.equal(state.data.rootScrollHeight, 55)
})

test('config menu renders fixed actions outside custom and second-level scroll regions', () => {
  const root = path.join(__dirname, '..')
  const wxml = fs.readFileSync(path.join(root, 'components/config-menu/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(root, 'components/config-menu/index.wxss'), 'utf8')
  assert.match(wxml, /config-menu-scrim/)
  assert.match(wxml, /config-menu-anchor/)
  assert.match(wxml, /bindtap="back"/)
  assert.match(wxml, /class="config-menu-back-icon"[^>]*>‹<\/text>/)
  assert.doesNotMatch(wxml, /config-menu-back[^>]*[\s\S]*ri-arrow-left-s-line/)
  assert.match(wxml, /class="config-menu-card"[^>]*width:\{\{anchor\.menuWidth\}\}px;[^>]*max-height:\{\{anchor\.menuMaxHeight\}\}px;/)
  assert.match(wxml, /class="config-menu-scroll"[^>]*height:\{\{submenuScrollHeight\}\}px;[^>]*scroll-y="\{\{true\}\}"[^>]*show-scrollbar="\{\{true\}\}"/)
  assert.match(wxml, /wx:if="\{\{customNodes\.length\}\}" class="config-menu-scroll"[^>]*height:\{\{rootScrollHeight\}\}px;[^>]*scroll-y="\{\{true\}\}"[^>]*show-scrollbar="\{\{true\}\}"/)
  assert.match(wxml, /data-zone="fixed"[^>]*bindtap="openSubmenu"[\s\S]*class="config-menu-chevron"[^>]*>›<\/text>/)
  assert.doesNotMatch(wxml, /config-menu-chevron ri-arrow-right-s-line/)
  assert.match(wxss, /border-radius:\s*14px/)
  assert.match(wxss, /box-shadow:\s*0 0 16px/)
  assert.match(wxss, /\.config-menu-card\{[^}]*overflow:hidden/s)
  assert.match(wxss, /\.config-menu-row::after,\.config-menu-back::after\{[^}]*right:18px;[^}]*left:18px;[^}]*height:1px/s)
})
