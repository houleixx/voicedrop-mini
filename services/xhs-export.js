const api = require('./api')
const auth = require('./auth')
const http = require('./request')

const MAX_IMAGES = 9

function strings(values) {
  return Array.isArray(values) ? values.map((value) => String(value || '').trim()).filter(Boolean) : []
}

function normalizePack(value) {
  const data = value && typeof value === 'object' ? value : {}
  return {
    title: String(data.title || '').trim(),
    body: String(data.body || '').trim(),
    tags: strings(data.tags),
    photoKeys: strings(data.photoKeys)
  }
}

function clipboardText(pack) {
  const clean = normalizePack(pack)
  const sections = [clean.title, clean.body].filter(Boolean)
  if (clean.tags.length) sections.push(clean.tags.map((tag) => `#${tag}`).join(' '))
  return sections.join('\n\n')
}

async function prepare(stem, dependencies) {
  const value = String(stem || '').trim()
  if (!value) return { ok: false, error: 'bad-request' }
  const deps = dependencies || {}
  const request = deps.http || http
  const apiService = deps.api || api
  const token = deps.token == null ? auth.bearer() : deps.token
  let res
  try {
    res = await request.postJson(`${apiService.agentBase()}/xhs-pack`, token, { stem: value })
  } catch (_) {
    return { ok: false, error: 'network' }
  }
  if (!res || res.statusCode < 200 || res.statusCode >= 300 || !res.data || res.data.ok !== true) {
    return { ok: false, error: res && res.data && res.data.error || 'prepare_failed' }
  }
  const pack = normalizePack(res.data)
  return { ok: true, pack, clipboardText: clipboardText(pack) }
}

function generatedCardSlots(originalImageCount) {
  const originals = Math.max(0, Math.min(MAX_IMAGES, Number(originalImageCount) || 0))
  return MAX_IMAGES - originals
}

module.exports = {
  MAX_IMAGES,
  normalizePack,
  clipboardText,
  prepare,
  generatedCardSlots
}
