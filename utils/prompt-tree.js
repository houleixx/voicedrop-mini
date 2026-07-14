function cloneNode(node) {
  return {
    id: String(node && node.id || ''),
    type: node && node.type === 'group' ? 'group' : 'action',
    label: String(node && node.label || ''),
    origin: String(node && node.origin || 'user'),
    ...(node && node.prompt != null ? { prompt: String(node.prompt) } : {}),
    ...(node && Array.isArray(node.appliesTo) ? { appliesTo: node.appliesTo.map(String) } : {}),
    ...(node && node.kind != null ? { kind: String(node.kind) } : {}),
    ...(node && node.forkedFrom != null ? { forkedFrom: String(node.forkedFrom) } : {}),
    ...(node && node.type === 'group' ? { children: (node.children || []).map(cloneNode) } : {})
  }
}

function clone(items) { return (items || []).map(cloneNode) }

function decodeItems(raw) {
  const doc = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!doc || Number(doc.schema || 1) > 1 || !Array.isArray(doc.items)) throw new Error('unsupported prompt schema')
  return { schema: 1, items: clone(doc.items) }
}

function rawItem(node) {
  if (node.origin === 'system') return node.type === 'group'
    ? { ref: node.id, children: rawItems(node.children || []) }
    : { ref: node.id }
  const out = { id: node.id, type: node.type, label: node.label }
  if (node.forkedFrom) out.forkedFrom = node.forkedFrom
  if (node.type === 'group') out.children = rawItems(node.children || [])
  else {
    out.prompt = node.prompt || ''
    out.appliesTo = Array.isArray(node.appliesTo) ? [...node.appliesTo] : []
    if (node.kind) out.kind = node.kind
  }
  return out
}

function rawItems(items) { return (items || []).map(rawItem) }

function newUserId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let suffix = ''
  for (let i = 0; i < 8; i += 1) suffix += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `p_${suffix}`
}

function fork(node, ids = newUserId) {
  return Object.assign(cloneNode(node), { id: ids(), forkedFrom: node.id, origin: 'custom' })
}

function replace(items, id, replacement) {
  let changed = false
  const next = clone(items).map((node) => {
    if (node.id === id) { changed = true; return cloneNode(replacement) }
    if (node.type === 'group') {
      const nested = replace(node.children || [], id, replacement)
      if (nested.changed) { node.children = nested.items; changed = true }
    }
    return node
  })
  return { items: next, changed }
}

function remove(items, id) {
  const next = []
  let removed = null
  for (const source of clone(items)) {
    if (!removed && source.id === id) { removed = source; continue }
    if (!removed && source.type === 'group') {
      const nested = remove(source.children || [], id)
      if (nested.removed) { source.children = nested.items; removed = nested.removed }
    }
    next.push(source)
  }
  return { items: next, removed }
}

function append(items, node, groupId = null) {
  const next = clone(items)
  if (!groupId) return [...next, cloneNode(node)]
  const group = next.find((item) => item.id === groupId && item.type === 'group')
  if (!group || node.type === 'group') throw new Error('invalid prompt group')
  group.children.push(cloneNode(node))
  return next
}

function move(items, id, targetGroup, index) {
  if (id === targetGroup) throw new Error('groups cannot contain groups')
  const result = remove(items, id)
  if (!result.removed) return clone(items)
  if (targetGroup && result.removed.type === 'group') throw new Error('groups cannot contain groups')
  if (!targetGroup) {
    const at = Math.max(0, Math.min(Number(index) || 0, result.items.length))
    result.items.splice(at, 0, result.removed)
    return result.items
  }
  const group = result.items.find((item) => item.id === targetGroup && item.type === 'group')
  if (!group) throw new Error('target group not found')
  const at = Math.max(0, Math.min(Number(index) || 0, group.children.length))
  group.children.splice(at, 0, result.removed)
  return result.items
}

function flattenIds(items) {
  return (items || []).flatMap((node) => [node.id, ...flattenIds(node.children || [])])
}

function menuNode(node, anchor) {
  if (node.type === 'group') {
    const children = (node.children || []).map((child) => menuNode(child, anchor)).filter(Boolean)
    return children.length ? { id: node.id, label: node.label, type: 'submenu', children } : null
  }
  return (node.appliesTo || []).includes(anchor)
    ? { id: node.id, label: node.label, instruction: node.prompt || '' }
    : null
}

function menu(items, anchor) {
  const groups = []
  let loose = []
  for (const node of items || []) {
    const rendered = menuNode(node, anchor)
    if (!rendered) continue
    if (node.type === 'group') {
      if (loose.length) { groups.push(loose); loose = [] }
      groups.push([rendered])
    } else loose.push(rendered)
  }
  if (loose.length) groups.push(loose)
  return { groups }
}

function extractShareCode(value) {
  const match = String(value || '').match(/(?<![0-9])[1-9][0-9]{6}(?![0-9])/)
  return match ? match[0] : null
}

function mergeCodeInput(previous, incoming) {
  const oldValue = String(previous || '')
  const next = String(incoming || '')
  if (oldValue === next) return next
  const typing = (next.length === oldValue.length + 1 && next.startsWith(oldValue)) ||
    (next.length === oldValue.length - 1 && oldValue.startsWith(next))
  if (typing) return next.replace(/[^0-9]/g, '').slice(0, 7)
  return extractShareCode(next) || oldValue
}

module.exports = { cloneNode, clone, decodeItems, rawItems, fork, newUserId, replace, remove, append, move, flattenIds, menu, extractShareCode, mergeCodeInput }
