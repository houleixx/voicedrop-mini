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

function shouldRebuild(current, updated) {
  if (current === updated) return false
  if (!current || !updated) return true
  try {
    return JSON.stringify(parseDoc(current)) !== JSON.stringify(parseDoc(updated))
  } catch (_) {
    return true
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
      if (text) blocks.push(classifyMarkdownLine(text))
    })
  })
  return blocks
}

function classifyMarkdownLine(value) {
  const source = String(value || '').trim()
  const heading = /^(#{1,6})[ \t]+(.*)$/.exec(source)
  if (heading) {
    return {
      type: 'paragraph', text: source, displayText: heading[2].trim(),
      markdownKind: `h${Math.min(3, heading[1].length)}`
    }
  }
  if (source.startsWith('#')) return { type: 'paragraph', text: source }

  const solid = source.replace(/ /g, '')
  if (solid.length >= 3 && /^(-+|\*+|_+)$/.test(solid)) {
    return { type: 'paragraph', text: source, displayText: '', markdownKind: 'divider' }
  }

  const bullet = /^[-*+][ \t]+(.*)$/.exec(source)
  if (bullet) {
    return {
      type: 'paragraph', text: source, displayText: bullet[1].trim(),
      markdownKind: 'bullet', marker: '•'
    }
  }

  const ordered = /^(\d{1,3})([.)、])([ \t]*)(.*)$/.exec(source)
  if (ordered && (ordered[3] || (ordered[2] === '、' && ordered[4]))) {
    return {
      type: 'paragraph', text: source, displayText: ordered[4].trim(),
      markdownKind: 'ordered', marker: `${ordered[1]}.`
    }
  }

  if (source.startsWith('>')) {
    let content = source
    while (content.startsWith('>')) content = content.slice(1).replace(/^ +/, '')
    return { type: 'paragraph', text: source, displayText: content.trim(), markdownKind: 'quote' }
  }
  return { type: 'paragraph', text: source }
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

function editableBodyRows(body) {
  const source = String(body || '')
  const rows = []
  const token = /<!--[\s\S]*?-->|\[\[photo:([^\]]+)\]\]/g
  let cursor = 0
  let match
  const appendText = (start, end) => {
    const chunk = source.slice(start, end)
    const lines = /[^\n]+/g
    let line
    while ((line = lines.exec(chunk))) {
      const raw = line[0]
      const leading = /^\s*/.exec(raw)[0].length
      const trailing = /\s*$/.exec(raw)[0].length
      const value = raw.trim()
      if (!value) continue
      rows.push({ type: 'paragraph', text: value, start: start + line.index + leading, end: start + line.index + raw.length - trailing })
    }
  }
  while ((match = token.exec(source))) {
    appendText(cursor, match.index)
    if (match[1] != null) rows.push({ type: 'photo', key: match[1], start: match.index, end: token.lastIndex })
    cursor = token.lastIndex
  }
  appendText(cursor, source.length)
  return rows
}

function replaceRenderedBodyLine(article, lineNo, replacement) {
  const source = String(article && article.body || '')
  const title = String(article && article.title || '').trim()
  const rows = editableBodyRows(source)
  if (title && rows.length && rows[0].type === 'paragraph') {
    const first = rows[0].text.replace(/^#{1,6}\s*/, '').trim()
    if (first === title) rows.shift()
  }
  const index = Number(lineNo) - 1
  const target = Number.isInteger(index) && index >= 0 ? rows[index] : null
  if (!target || target.type !== 'paragraph') return null
  return source.slice(0, target.start) + String(replacement == null ? '' : replacement) + source.slice(target.end)
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

// The book worker accepts one string seed.  Keep article expansion input in a
// single shared helper so every entry point removes presentation-only markers
// and obeys the worker's 20,000-character limit in the same way.
function bookSeed(article, supplemental, maxLength) {
  const limit = Number.isFinite(Number(maxLength)) ? Math.max(0, Number(maxLength)) : 20000
  const source = article && typeof article === 'object' ? article : {}
  const title = String(source.title || '无题').trim() || '无题'
  const body = stripMarkers(source.body)
  const request = String(supplemental || '').trim()
  const prefix = request ? `写书要求：${request}\n\n` : ''
  const seed = `${prefix}以下这篇文章是种子素材，把它扩展成一本完整的书：\n\n《${title}》\n\n${body}`
  return seed.slice(0, limit)
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
  if (i18n.currentLanguage() === i18n.ENGLISH) {
    if (errcode === 45004) return 'The summary is too short. Add more article body text and try again.'
    if (errcode === 40007) return 'The draft expired, so a new draft was created.'
    if (errcode === 45009 || errcode === 45011 || errcode === 45110) return 'Today’s publishing limit has been reached. Please try again tomorrow.'
    if (!errcode && !errmsg) return null
    return errmsg ? `Publishing failed: ${errmsg}` : 'Publishing failed'
  }
  if (errcode === 45004) return '摘要太短，正文写长一点再发'
  if (errcode === 40007) return '草稿已失效，已重建一份'
  if (errcode === 45009 || errcode === 45011 || errcode === 45110) return '今天发布次数到上限了，明天再试'
  if (!errcode && !errmsg) return null
  return errmsg ? `发布失败：${errmsg}` : '发布失败'
}

function firstArticle(doc) {
  return doc && doc.articles && doc.articles.length ? doc.articles[0] : null
}

module.exports = {
  parseDoc,
  shouldRebuild,
  bodyBlocks,
  classifyMarkdownLine,
  bodyWithoutDuplicateTitle,
  replaceRenderedBodyLine,
  legacyBodyBlocks,
  resolvePhotoKey,
  segments,
  stripMarkers,
  bookSeed,
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
const i18n = require('./i18n')
