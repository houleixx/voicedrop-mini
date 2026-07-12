const MAX_SELECTED = 3

function normalized(selection) {
  const out = []
  ;(selection || []).forEach((value) => {
    const n = Number(value)
    if (!Number.isNaN(n) && !out.includes(n)) out.push(n)
  })
  return out.slice(0, MAX_SELECTED)
}

function toggle(selection, version) {
  const current = normalized(selection)
  const value = Number(version)
  if (Number.isNaN(value)) return { selected: current, ok: false, limit: false }
  if (current.includes(value)) return { selected: current.filter((item) => item !== value), ok: true, limit: false }
  if (current.length >= MAX_SELECTED) return { selected: current, ok: false, limit: true }
  return { selected: current.concat(value), ok: true, limit: false }
}

function selectedRows(versions, selection) {
  const current = normalized(selection)
  return (versions || []).map((item, index) => {
    const version = Number(item && item.v != null ? item.v : index)
    const styleText = item && (item.style || item.source || '')
    const preview = oneLinePreview(styleText)
    const words = styleText.length
    const savedAt = item && item.savedAt
    const date = savedAt ? formatDate(savedAt) : ''
    return Object.assign({}, item, {
      v: version,
      preview,
      words,
      date,
      selected: current.includes(version)
    })
  }).sort((a, b) => b.v - a.v)
}

function formatDate(timestamp) {
  const date = new Date(timestamp)
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${month}月${day}日`
}

function oneLinePreview(value) {
  return String(value || '未命名写作风格').split(/\r?\n/)[0].trim() || '未命名写作风格'
}

function summary(selection) {
  const current = normalized(selection)
  if (!current.length) return '未选择风格'
  return `已选 ${current.map((item) => `v${item}`).join('、')}`
}

module.exports = {
  MAX_SELECTED,
  normalized,
  toggle,
  selectedRows,
  summary
}
