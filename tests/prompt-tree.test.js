const test = require('node:test')
const assert = require('node:assert/strict')
const tree = require('../utils/prompt-tree')

const resolved = { schema: 1, items: [{ id: 'sys_rewrite', type: 'group', label: '改写', origin: 'system', children: [{ id: 'sys_concise', type: 'action', label: '精简', origin: 'system', prompt: 'P', appliesTo: ['text'] }] }] }

test('system group serializes as a ref with children', () => {
  const [group] = tree.decodeItems(resolved).items
  assert.deepEqual(tree.rawItems([group]), [{ ref: 'sys_rewrite', children: [{ ref: 'sys_concise' }] }])
})

test('pasted eight-digit runs are not truncated to a code', () => {
  assert.equal(tree.extractShareCode('12345678'), null)
  assert.equal(tree.mergeCodeInput('12', '12345678'), '12')
  assert.equal(tree.extractShareCode('https://voicedrop.cn/7654321'), '7654321')
})

test('actions move into and out of groups without nesting groups', () => {
  const action = { id: 'p_action01', type: 'action', label: 'A', origin: 'user', prompt: 'P', appliesTo: ['text'] }
  const group = { id: 'p_group001', type: 'group', label: 'G', origin: 'user', children: [] }
  const second = { id: 'p_group002', type: 'group', label: 'G2', origin: 'user', children: [] }
  const moved = tree.move([group, action, second], 'p_action01', 'p_group001', 0)
  assert.equal(moved[0].children[0].id, 'p_action01')
  assert.throws(() => tree.move(moved, 'p_group001', 'p_group002', 0))
  assert.equal(tree.move(moved, 'p_action01', null, 1)[1].id, 'p_action01')
})

test('menu filters anchors and system edits fork in place', () => {
  const items = tree.decodeItems(resolved).items
  assert.equal(tree.menu(items, 'text').groups[0][0].children[0].id, 'sys_concise')
  assert.equal(tree.menu(items, 'text').groups[0][0].origin, 'system')
  assert.equal(tree.menu(items, 'text').groups[0][0].children[0].origin, 'system')
  assert.equal(tree.menu(items, 'image').groups.length, 0)
  const fork = tree.fork(items[0].children[0], () => 'p_abcdefgh')
  assert.equal(fork.forkedFrom, 'sys_concise')
  assert.equal(fork.origin, 'custom')
})

test('import provenance survives cache and server serialization', () => {
  const imported = {
    id: 'p_imported',
    type: 'action',
    label: '植物和光斑合影',
    origin: 'user',
    prompt: '保持人物不变，只改变视觉风格。',
    appliesTo: ['image'],
    kind: 'image',
    importedFrom: '3295225'
  }
  const [decoded] = tree.decodeItems({ schema: 1, items: [imported] }).items

  assert.equal(decoded.importedFrom, '3295225')
  assert.equal(tree.rawItems([decoded])[0].importedFrom, '3295225')
  assert.equal(tree.containsImport([decoded], '3295225'), true)
  assert.equal(tree.containsImport([{ id: 'g', type: 'group', children: [decoded] }], '3295225'), true)
  assert.equal(tree.containsImport([decoded], '7654321'), false)
})
