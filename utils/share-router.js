const WEB_URL = /^https?:\/\/\S+$/i
const DOC_MIMES = new Set([
  'application/pdf',
  'application/rtf',
  'text/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])

function classify(payload) {
  const mime = String(payload && payload.mimeType || '').toLowerCase()
  const text = payload && payload.text
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('image/')) return 'image'
  if (DOC_MIMES.has(mime)) return 'document'
  if (text && WEB_URL.test(String(text).trim())) return 'web'
  if (payload && payload.streamCount > 0 && !mime) return 'document'
  return 'text'
}

function cap(value, maxChars) {
  const text = value == null ? '' : String(value)
  return text.length <= maxChars ? text : text.slice(0, maxChars)
}

function firstLineTitle(text, fallback) {
  const value = text == null ? '' : String(text)
  const lines = value.split(/\r?\n|\r/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) return cap(trimmed, 40)
  }
  const fb = fallback && String(fallback).trim() ? String(fallback).trim() : '分享内容'
  return cap(fb, 40)
}

module.exports = {
  classify,
  cap,
  firstLineTitle
}
