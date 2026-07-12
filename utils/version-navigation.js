function headsFromVersions(versions) {
  return (versions || []).map((item, index) => Number(item && item.v != null ? item.v : index))
}

function targetHead(current, heads, direction, editing) {
  if (editing) return null
  const head = Number(current) || 0
  const values = (heads || []).map(Number).filter((value) => !Number.isNaN(value))
  if (direction < 0) {
    const earlier = values.filter((value) => value < head).sort((a, b) => b - a)
    return earlier.length ? earlier[0] : null
  }
  const later = values.filter((value) => value > head).sort((a, b) => a - b)
  return later.length ? later[0] : null
}

function state(history, editing) {
  const versions = history && history.versions || []
  const heads = headsFromVersions(versions)
  const fallbackHead = heads.length ? heads[heads.length - 1] : 0
  const current = history && history.head != null ? Number(history.head) : fallbackHead
  const undoHead = targetHead(current, heads, -1, editing)
  const redoHead = targetHead(current, heads, 1, editing)
  return {
    head: current,
    heads,
    undoHead,
    redoHead,
    canUndo: undoHead != null,
    canRedo: redoHead != null
  }
}

module.exports = {
  headsFromVersions,
  targetHead,
  state
}
