// Compatibility facade. New pages use PromptStore directly.
const promptStore = require('./prompt-store')
const tree = require('../utils/prompt-tree')

function leaves(items, prefix = '') {
  return (items || []).flatMap((item) => item.type === 'group' ? leaves(item.children, `${prefix}${item.label} · `) : [{
    ...tree.cloneNode(item),
    defaultName: item.label,
    defaultText: item.prompt || '',
    effective: item.prompt || '',
    effectiveLabel: item.label,
    label: `${prefix}${item.label}`,
    customized: item.origin !== 'system',
    hidden: false
  }])
}

async function load() {
  const result = await promptStore.refresh()
  return { ok: result.ok, items: leaves(promptStore.items()), error: result.error }
}

async function save(id, instruction, label) {
  const item = leaves(promptStore.items()).find((entry) => entry.id === id)
  if (!item) return { ok: false, error: 'not_found' }
  const next = tree.cloneNode(item); next.prompt = String(instruction || next.prompt); next.label = String(label || next.label)
  return promptStore.replace(id, item.origin === 'system' ? tree.fork(next) : next)
}

module.exports = { load, save, setSharing: promptStore.setSharing }
