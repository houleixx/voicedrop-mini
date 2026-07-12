const api = require('./api')
const auth = require('./auth')
const http = require('./request')
const uiConfig = require('../utils/ui-config')

async function load() {
  const res = await http.get(`${api.agentBase()}/ui-config/custom`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) return { ok: false, items: [], error: 'load_failed' }
  const raw = Array.isArray(res.data && res.data.items) ? res.data.items : []
  return { ok: true, items: raw.map(uiConfig.normalizeInstructionItem) }
}

async function save(id, instruction, label, hidden) {
  const data = {
    id: String(id || ''),
    instruction: String(instruction || ''),
    label: String(label || '').trim().slice(0, 20),
    hidden: Boolean(hidden)
  }
  const res = await http.putJson(`${api.agentBase()}/ui-config/custom`, auth.bearer(), data)
  if (res.statusCode < 200 || res.statusCode >= 300) return { ok: false, error: 'save_failed' }
  return { ok: true, data: res.data || {} }
}

async function setSharing(id, on) {
  const token = auth.bearer()
  let res
  try {
    res = on
      ? await http.postJson(`${api.agentBase()}/prompt-share`, token, { id: String(id || '') })
      : await http.del(`${api.agentBase()}/prompt-share/${encodeURIComponent(String(id || ''))}`, token)
  } catch (_) {
    return { ok: false, error: 'network_error' }
  }
  if (res.statusCode === 429) return { ok: false, error: 'daily_cap' }
  if (res.statusCode < 200 || res.statusCode >= 300) return { ok: false, error: 'share_failed' }
  const data = res.data || {}
  if (on && !/^\d{7}$/.test(String(data.code || ''))) return { ok: false, error: 'bad_share_code' }
  return {
    ok: true,
    code: /^\d{7}$/.test(String(data.code || '')) ? String(data.code) : null,
    ...(on ? { url: data.url || `https://voicedrop.cn/${data.code}` } : {}),
    sharing: on
  }
}

module.exports = { load, save, setSharing }
