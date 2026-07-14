const tree = require('./prompt-tree')

function create() {
  let original = []
  let current = []
  let ids = []
  return {
    begin(items) { original = tree.clone(items); current = tree.clone(items); ids = tree.flattenIds(items); return this.draft() },
    move(id, groupId, index) { current = tree.move(current, id, groupId || null, index); return this.draft() },
    draft: () => tree.clone(current),
    baseline: () => [...ids],
    cancel() { current = tree.clone(original); return this.draft() },
    async commit(store) { return store.applyReorder(current, ids) }
  }
}

module.exports = { create }
