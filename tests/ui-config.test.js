const assert = require('node:assert/strict')
const test = require('node:test')
const uiConfig = require('../utils/ui-config')

test('filters invalid leaves, empty submenus, and empty groups', () => {
  const groups = uiConfig.renderableGroups({ groups: [[
    { id: 'empty', label: '空', type: 'submenu', children: [] },
    { id: 'bad', label: '坏节点' },
    { id: 'style', label: '图片风格', type: 'submenu', children: [
      { id: 'cartoon', label: '卡通', instruction: '画 {{KEY}}' },
      { id: 'missing', label: '无指令' }
    ] }
  ], [{ id: 'unknown', label: '未知', type: 'future' }]] })

  assert.deepEqual(groups, [[{
    id: 'style', label: '图片风格', type: 'submenu', children: [
      { id: 'cartoon', label: '卡通', instruction: '画 {{KEY}}' }
    ]
  }]])
})

test('normalizes instruction items and derives effective values', () => {
  const item = uiConfig.normalizeInstructionItem({
    id: 'voice-editor.longpress.image.style.cartoon',
    label: '图片风格 · 卡通',
    default: '默认提示词',
    override: '我的提示词',
    customLabel: '手绘',
    hidden: true
  })

  assert.equal(item.defaultText, '默认提示词')
  assert.equal(item.defaultName, '卡通')
  assert.equal(item.effective, '我的提示词')
  assert.equal(item.effectiveLabel, '手绘')
  assert.equal(item.customized, true)
  assert.equal(item.hidden, true)
})

test('normalizes prompt sharing fields with old-server fallbacks', () => {
  const shared = uiConfig.normalizeInstructionItem({ shareCode: '1234567', sharing: true })
  assert.equal(shared.shareCode, '1234567')
  assert.equal(shared.sharing, true)
  const old = uiConfig.normalizeInstructionItem({})
  assert.equal(old.shareCode, null)
  assert.equal(old.sharing, false)
})
