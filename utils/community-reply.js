function previewText(reply) {
  const article = reply && reply.doc && reply.doc.articles && reply.doc.articles[0]
  if (!article || !article.body) return ''
  const preview = String(article.body)
    .replace(/\[\[photo:[^\]]+\]\]/g, ' ')
    .replace(/[#>*`-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return preview.length > 600 ? preview.slice(0, 600) : preview
}

function viewModel(reply) {
  const preview = previewText(reply)
  return Object.assign({}, reply, {
    preview,
    hasMore: preview.length > 160,
    replyLabel: '续文'
  })
}

module.exports = {
  previewText,
  viewModel
}
