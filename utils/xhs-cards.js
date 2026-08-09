const MAX_BODY_PAGES = 11
const CARD_WIDTH = 1080
const CARD_HEIGHT = 1440
const BODY_LEFT = 110
const BODY_TOP = 150
const BODY_WIDTH = CARD_WIDTH - BODY_LEFT * 2
const BODY_HEIGHT = 1120
const BODY_FONT_SIZE = 42
const BODY_LINE_SPACING = 26
const BODY_LINE_ADVANCE = BODY_FONT_SIZE + BODY_LINE_SPACING
const BODY_PARAGRAPH_SPACING = 36
const TITLE_WIDTH = CARD_WIDTH - 220
const CANVAS_FONT_FAMILY = '"PingFang SC", "Microsoft YaHei", sans-serif'
const CLOSING_PUNCTUATION = /^[，。！？；：、）》】〕〉”’…,.!?;:%）]$/
const OPENING_PUNCTUATION = /[（《【〔〈“‘]$/

function canvasFont(size, weight) {
  const pixels = Math.max(1, Number(size) || 1)
  const fontWeight = Number(weight) || 400
  return `normal ${fontWeight} ${pixels}px ${CANVAS_FONT_FAMILY}`
}

function applyCanvasFont(ctx, size, weight) {
  const value = canvasFont(size, weight)
  // setFontSize keeps older WeChat runtimes usable; `font` adds an explicit
  // family and weight where the CanvasContext implementation supports it.
  if (ctx && typeof ctx.setFontSize === 'function') ctx.setFontSize(Number(size) || 1)
  if (ctx) {
    try {
      ctx.font = value
    } catch (_) {
      // Older base libraries can expose a read-only font property.
    }
  }
  return value
}

function estimatedWidth(value, fontSize) {
  return Array.from(String(value || '')).reduce((width, character) => {
    return width + (/^[\x00-\xff]$/.test(character) ? fontSize * 0.56 : fontSize)
  }, 0)
}

function textTokens(value) {
  return String(value || '').match(/[A-Za-z0-9]+(?:[.:/-][A-Za-z0-9]+)*|[ \t]+|./gu) || []
}

function wrapParagraph(value, maxWidth, measureText) {
  const text = String(value || '').trim()
  if (!text || !maxWidth || typeof measureText !== 'function') return []
  const lines = []
  let line = ''

  const pushLine = () => {
    const clean = line.trim()
    if (clean) lines.push(clean)
    line = ''
  }

  const appendToken = (token) => {
    const cleanToken = /^\s+$/.test(token) ? (line ? ' ' : '') : token
    if (!cleanToken) return
    const candidate = line + cleanToken
    if (!line || measureText(candidate) <= maxWidth) {
      line = candidate
      return
    }
    if (CLOSING_PUNCTUATION.test(cleanToken)) {
      line = candidate
      return
    }
    let carry = cleanToken.trimStart()
    if (OPENING_PUNCTUATION.test(line)) {
      carry = line.slice(-1) + carry
      line = line.slice(0, -1)
    }
    pushLine()
    if (measureText(carry) <= maxWidth) {
      line = carry
      return
    }
    Array.from(carry).forEach((character) => appendToken(character))
  }

  textTokens(text).forEach(appendToken)
  pushLine()
  return lines
}

function paginateBody(body, measureText) {
  const paragraphs = String(body || '').split(/\n+/).map((part) => part.trim()).filter(Boolean)
  const pages = []
  let page = []
  let y = BODY_TOP

  const finishPage = () => {
    if (page.length) pages.push(page)
    page = []
    y = BODY_TOP
  }

  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (paragraphIndex > 0 && page.length) y += BODY_PARAGRAPH_SPACING
    const lines = wrapParagraph(paragraph, BODY_WIDTH, measureText)
    lines.forEach((text) => {
      if (y + BODY_FONT_SIZE > BODY_TOP + BODY_HEIGHT) finishPage()
      if (pages.length >= MAX_BODY_PAGES) return
      page.push({ text, y })
      y += BODY_LINE_ADVANCE
    })
  })
  if (pages.length < MAX_BODY_PAGES) finishPage()
  return pages.slice(0, MAX_BODY_PAGES)
}

function bodyLines(body, measureText) {
  const measure = typeof measureText === 'function'
    ? measureText
    : (value) => estimatedWidth(value, BODY_FONT_SIZE)
  return paginateBody(body, measure).flat().map((line) => line.text)
}

function titleLines(title, measureText) {
  const measure = typeof measureText === 'function'
    ? measureText
    : (value) => estimatedWidth(value, 78)
  return wrapParagraph(title, TITLE_WIDTH, measure)
}

function buildCards(title, body, date, maxCards, measureText) {
  const limit = Math.max(0, Number(maxCards) || 0)
  if (!limit) return []
  const measure = typeof measureText === 'function'
    ? measureText
    : (value) => estimatedWidth(value, BODY_FONT_SIZE)
  const pages = paginateBody(body, measure)
  const cards = [{ kind: 'title', title: String(title || '').trim() || '一篇文章', date: String(date || '').trim() }]
  pages.forEach((page) => cards.push({ kind: 'body', lines: page }))
  return cards.slice(0, limit)
}

module.exports = {
  MAX_BODY_PAGES,
  CARD_WIDTH,
  CARD_HEIGHT,
  BODY_LEFT,
  BODY_TOP,
  BODY_WIDTH,
  BODY_HEIGHT,
  BODY_FONT_SIZE,
  BODY_LINE_SPACING,
  BODY_LINE_ADVANCE,
  BODY_PARAGRAPH_SPACING,
  CANVAS_FONT_FAMILY,
  canvasFont,
  applyCanvasFont,
  estimatedWidth,
  wrapParagraph,
  paginateBody,
  bodyLines,
  titleLines,
  buildCards
}
