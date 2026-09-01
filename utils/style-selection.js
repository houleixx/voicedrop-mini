const i18n = require('./i18n')

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
  if (i18n.currentLanguage() === i18n.ENGLISH) {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function oneLinePreview(value) {
  return String(value || i18n.ui('未命名写作风格')).split(/\r?\n/)[0].trim() || i18n.ui('未命名写作风格')
}

module.exports = {
  selectedRows,
  oneLinePreview
}
