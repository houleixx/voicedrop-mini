const article = require('./article')

function styleVersionForArticle(item) {
  if (!item) return null
  if (item.style != null) {
    const value = Number(item.style)
    if (!Number.isNaN(value)) return value
  }
  return article.styleVersion(item.body || '')
}

function generatedVersions(history) {
  const out = {}
  ;((history && history.versions) || []).forEach((version, index) => {
    const articles = version && version.articles || []
    for (let i = 0; i < articles.length; i += 1) {
      const styleVersion = styleVersionForArticle(articles[i])
      if (styleVersion != null) {
        out[styleVersion] = Object.assign({ v: index }, version)
        break
      }
    }
  })
  return out
}

function buttonText(styleVersion, generated) {
  const version = Number(styleVersion)
  if (version < 0 || Number.isNaN(version)) return '选一个版本'
  return generated && generated[version] ? `切换到 v${version} 风格` : `用 v${version} 重写本文`
}

function choiceLabel(item, generated) {
  const version = Number(item && item.v != null ? item.v : -1)
  const style = String(item && (item.style || item.source) || '').trim()
  const preview = style.length > 18 ? `${style.slice(0, 18)}...` : style
  const prefix = generated && generated[version] ? '已生成' : '重写'
  return `v${version} ${prefix}${preview ? ` · ${preview}` : ''}`
}

module.exports = {
  generatedVersions,
  styleVersionForArticle,
  buttonText,
  choiceLabel
}
