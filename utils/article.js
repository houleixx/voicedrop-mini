function parseDoc(input) {
  const obj = typeof input === 'string' ? JSON.parse(input || '{}') : (input || {})
  let articles = []
  if (Array.isArray(obj.articles)) {
    articles = obj.articles.map((item) => ({
      title: item.title || '(无题)',
      body: item.body || '',
      style: item.style == null ? null : item.style,
      wechatMediaId: item.wechatMediaId || null
    }))
  } else if (Object.prototype.hasOwnProperty.call(obj, 'body')) {
    articles = [{
      title: obj.title || '(无题)',
      body: obj.body || '',
      style: null,
      wechatMediaId: null
    }]
  }
  return {
    id: obj.id || '',
    transcript: obj.transcript || '',
    articles,
    tags: Array.isArray(obj.tags) ? obj.tags.filter(Boolean) : [],
    photos: Array.isArray(obj.photos) ? obj.photos.filter(Boolean) : [],
    owner: obj.owner || ''
  }
}

function bodyBlocks(body) {
  const blocks = []
  segments(body).forEach((segment) => {
    if (segment.type === 'photo') {
      blocks.push({ type: 'photo', key: segment.value })
      return
    }
    String(segment.value || '').split(/\n+/).forEach((part) => {
      const text = part.trim()
      if (text) blocks.push({ type: 'paragraph', text })
    })
  })
  return blocks
}

function bodyWithoutDuplicateTitle(article) {
  const body = stripOriginComment(article && article.body || '')
  const title = String(article && article.title || '').trim()
  if (!title || !body) return body
  const lines = body.split('\n')
  const firstContent = lines.findIndex((line) => line.trim())
  if (firstContent < 0) return body
  const first = lines[firstContent].trim().replace(/^#{1,6}\s*/, '').trim()
  if (first !== title) return body
  return lines.slice(firstContent + 1).join('\n').trim()
}

function resolvePhotoKey(token, photos) {
  const index = Number(token)
  if (Number.isInteger(index) && String(index) === String(token)) {
    return index >= 1 && photos && index <= photos.length ? photos[index - 1] : null
  }
  return token
}

function stripOriginComment(body) {
  return String(body || '').replace(/<!--.*?-->/gs, '').trim()
}

function segments(body) {
  const stripped = stripOriginComment(body)
  const marker = /\[\[photo:([^\]]+)\]\]/g
  const out = []
  let cursor = 0
  let match
  while ((match = marker.exec(stripped))) {
    if (match.index > cursor) {
      const text = stripped.slice(cursor, match.index).trim()
      if (text) out.push({ type: 'text', value: text })
    }
    out.push({ type: 'photo', value: match[1] })
    cursor = marker.lastIndex
  }
  if (cursor < stripped.length) {
    const text = stripped.slice(cursor).trim()
    if (text) out.push({ type: 'text', value: text })
  }
  if (!out.length && stripped) out.push({ type: 'text', value: stripped })
  return out
}

function stripMarkers(body) {
  let stripped = stripOriginComment(body).replace(/\[\[photo:[^\]]+\]\]/g, '')
  while (stripped.includes('\n\n\n')) stripped = stripped.replaceAll('\n\n\n', '\n\n')
  return stripped.trim()
}

function styleLabel(body) {
  const matches = String(body || '').matchAll(/<!--\s*([A-Za-z][\w-]*)\s*:\s*(.*?)\s*-->/gs)
  let label = null
  for (const match of matches) {
    if (match[1] === 'style' && match[2].trim()) label = match[2].trim()
  }
  return label
}

function styleVersion(body) {
  const label = styleLabel(body)
  if (!label) return null
  const match = /\d+/.exec(label)
  return match ? Number(match[0]) : null
}

function styleLabelForVersion(version) {
  return `风格 v${version}`
}

function firstPhotoKey(body, photos) {
  for (const segment of segments(body)) {
    if (segment.type === 'photo') {
      const key = resolvePhotoKey(segment.value, photos || [])
      if (key) return key
    }
  }
  return null
}

function shareText(articles) {
  const multi = articles.length > 1
  return articles.map((item) => {
    const body = stripMarkers(item.body)
    return multi ? `【${item.title}】\n\n${body}` : `${item.title}\n\n${body}`
  }).join('\n\n---\n\n')
}

function shareTextWithLink(articleText, url) {
  const cleanText = String(articleText || '').trim()
  const cleanUrl = String(url || '').trim()
  if (!cleanUrl) return articleText
  if (!cleanText) return cleanUrl
  return `${cleanText}\n\n${cleanUrl}`
}

function shareTextForTarget(articleText, url) {
  return shareTextWithLink(articleText, url)
}

function legacyBodyBlocks(body) {
  const blocks = []
  String(body || '').split(/\n{2,}/).forEach((part) => {
    const text = part.trim()
    if (!text) return
    const photo = /^\[\[photo:(.+?)\]\]$/.exec(text)
    if (photo) {
      blocks.push({ type: 'photo', key: photo[1] })
    } else {
      blocks.push({ type: 'paragraph', text })
    }
  })
  return blocks
}

function wechatMessage(errcode, errmsg) {
  if (errcode === 45004) return '摘要太短，正文写长一点再发'
  if (errcode === 40007) return '草稿已失效，已重建一份'
  if (errcode === 45009 || errcode === 45011 || errcode === 45110) return '今天发布次数到上限了，明天再试'
  if (errcode === 40164 || errcode === 40125 || errcode === 40013) return '公众号配置有误，检查 AppID/Secret 或 IP 白名单'
  if (!errcode && !errmsg) return null
  return errmsg ? `发布失败：${errmsg}` : '发布失败'
}

function firstArticle(doc) {
  return doc && doc.articles && doc.articles.length ? doc.articles[0] : null
}

module.exports = {
  parseDoc,
  bodyBlocks,
  bodyWithoutDuplicateTitle,
  legacyBodyBlocks,
  resolvePhotoKey,
  segments,
  stripMarkers,
  stripOriginComment,
  styleLabel,
  styleVersion,
  styleLabelForVersion,
  firstPhotoKey,
  shareText,
  shareTextWithLink,
  shareTextForTarget,
  wechatMessage,
  firstArticle
}
