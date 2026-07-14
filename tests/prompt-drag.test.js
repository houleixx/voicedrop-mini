const test = require('node:test')
const assert = require('node:assert/strict')
const drag = require('../utils/prompt-drag')

const action = (id) => ({ id, type: 'action', label: id, origin: 'user', prompt: id, appliesTo: ['text'] })
const group = (id) => ({ id, type: 'group', label: id, origin: 'user', children: [] })

test('draft moves across groups, rejects nesting, cancels, and passes baseline', async () => {
  const controller = drag.create(); controller.begin([action('a'), action('b'), group('g')])
  assert.equal(controller.move('b', null, 0)[0].id, 'b')
  assert.equal(controller.move('a', 'g', 0)[1].children[0].id, 'a')
  assert.throws(() => controller.move('g', 'g', 0))
  assert.equal(controller.cancel()[0].id, 'a')
  let received
  const result = await controller.commit({ applyReorder: async (draft, baseline) => { received = { draft, baseline }; return { ok: false, error: 'save_failed' } } })
  assert.equal(result.error, 'save_failed')
  assert.deepEqual(received.baseline, ['a', 'b', 'g'])
})
