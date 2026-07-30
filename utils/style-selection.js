function selectedRows(versions, selectedVersion) {
  const current = selectedVersion == null ? Number.NaN : Number(selectedVersion)
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
      selected: !Number.isNaN(current) && current === version
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

module.exports = {
  selectedRows,
  oneLinePreview
}
