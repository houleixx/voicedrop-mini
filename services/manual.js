const http = require('./request')

const MANUAL_URL = 'https://voicedrop.cn/help/manual/'
const CACHE_KEY = 'voicedrop.manual.v1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FORMAT_VERSION = 1

function cached() {
  try {
    const value = wx.getStorageSync(CACHE_KEY)
    if (!value || !Array.isArray(value.sections)) return { checkedAt: 0, fetchedAt: 0, sections: [] }
    const needsFormatting = Number(value.formatVersion) !== FORMAT_VERSION
    return {
      checkedAt: Number(value.checkedAt) || 0,
      fetchedAt: Number(value.fetchedAt) || 0,
      formatVersion: FORMAT_VERSION,
      sections: needsFormatting
        ? value.sections.map((section) => Object.assign({}, section, {
          html: formatChapter(section && section.html)
        }))
        : value.sections
    }
  } catch (_) {
    return { checkedAt: 0, fetchedAt: 0, sections: [] }
  }
}

function store(value) {
  try { wx.setStorageSync(CACHE_KEY, value) } catch (_) {}
  return value
}

function sanitizeChapter(html) {
  return String(html || '')
    .replace(/<(script|style|iframe|object|embed|form)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(["']).*?\1/gi, '')
    .replace(/\b(href|src)\s*=\s*(["'])javascript:[\s\S]*?\2/gi, '')
    .replace(/\bhref\s*=\s*(["'])\/(?!\/)(.*?)\1/gi, 'href=$1https://voicedrop.cn/$2$1')
    .replace(/\bsrc\s*=\s*(["'])\/(?!\/)(.*?)\1/gi, 'src=$1https://voicedrop.cn/$2$1')
    .trim()
}

function appendStyle(attributes, style) {
  const source = String(attributes || '')
  const match = /\sstyle\s*=\s*(["'])(.*?)\1/i.exec(source)
  if (!match) return `${source} style="${style}"`
  const current = match[2].trim().replace(/;?$/, ';')
  return source.replace(match[0], ` style="${current}${style}"`)
}

function styleTags(html, tag, style) {
  const expression = new RegExp(`<${tag}\\b([^>]*)>`, 'gi')
  return html.replace(expression, (_, attributes) => `<${tag}${appendStyle(attributes, style)}>`)
}

function formatChapter(html) {
  let result = sanitizeChapter(html)
  const styles = [
    ['h2', 'margin:0 0 0.6em;font-size:1.35em;line-height:1.4;color:#2e2925;'],
    ['h3', 'margin:1.25em 0 0.35em;font-size:1.12em;line-height:1.5;color:#342f2b;'],
    ['p', 'margin:0.55em 0;line-height:1.75;'],
    ['ul', 'margin:0.55em 0;padding-left:1.45em;'],
    ['ol', 'margin:0.55em 0;padding-left:1.45em;'],
    ['li', 'margin:0.3em 0;line-height:1.7;'],
    ['table', 'width:100%;max-width:100%;margin:0.8em 0;border-collapse:collapse;table-layout:auto;font-size:0.94em;'],
    ['th', 'border:1px solid #e7ddd0;padding:6px 8px;background:#faf6ef;text-align:left;vertical-align:top;word-break:normal;'],
    ['td', 'border:1px solid #e7ddd0;padding:6px 8px;text-align:left;vertical-align:top;word-break:break-word;'],
    ['pre', 'max-width:100%;margin:0.8em 0;padding:10px 12px;overflow-x:auto;background:#f7f3ed;border:1px solid #e7ddd0;border-radius:8px;white-space:pre-wrap;word-break:break-all;'],
    ['code', 'font-size:0.88em;word-break:break-all;'],
    ['a', 'color:#c9563d;word-break:break-all;']
  ]
  styles.forEach(([tag, style]) => { result = styleTags(result, tag, style) })
  return result.replace(/(<tr\b[^>]*>\s*)<(th|td)\b([^>]*)>/gi, (_, row, tag, attributes) => (
    `${row}<${tag}${appendStyle(attributes, 'width:4em;white-space:nowrap;')}>`
  ))
}

function textContent(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim()
}

function parseManual(html) {
  const source = String(html || '')
  const sections = []
  for (let index = 1; index <= 8; index += 1) {
    const id = `ch${index}`
    const expression = new RegExp(`<section\\b[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/section>`, 'i')
    const match = expression.exec(source)
    if (!match) return []
    const chapter = formatChapter(match[1])
    const heading = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(chapter)
    if (!heading || !chapter) return []
    sections.push({ id, title: textContent(heading[1]), html: chapter })
  }
  return sections
}

function isFresh(value, now) {
  const checkedAt = Number(value && value.checkedAt) || 0
  return checkedAt > 0 && Math.max(0, Number(now) - checkedAt) < CACHE_TTL_MS
}

async function sync(nowValue) {
  const now = Number(nowValue) || Date.now()
  const previous = cached()
  if (isFresh(previous, now)) return Object.assign({ refreshed: false, error: '' }, previous)

  try {
    const response = await http.get(MANUAL_URL)
    if (!response || response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`manual ${response && response.statusCode || 0}`)
    }
    const sections = parseManual(response.data)
    if (sections.length !== 8) throw new Error('manual parse failed')
    return Object.assign({ refreshed: true, error: '' }, store({ checkedAt: now, fetchedAt: now, formatVersion: FORMAT_VERSION, sections }))
  } catch (_) {
    const fallback = store({ checkedAt: now, fetchedAt: previous.fetchedAt, formatVersion: FORMAT_VERSION, sections: previous.sections })
    return Object.assign({ refreshed: false, error: '使用手册暂时无法更新' }, fallback)
  }
}

module.exports = {
  MANUAL_URL,
  CACHE_KEY,
  CACHE_TTL_MS,
  FORMAT_VERSION,
  cached,
  isFresh,
  parseManual,
  sync
}
