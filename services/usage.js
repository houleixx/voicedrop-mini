const api = require('./api')
const auth = require('./auth')
const http = require('./request')

const SUANLI_PER_ARTICLE = 9

async function balance() {
  const res = await http.get(`${api.agentBase()}/usage/balance`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`usage HTTP ${res.statusCode}`)
  return res.data || { suanli: 0, spent_suanli: 0 }
}

async function ledger() {
  const res = await http.get(`${api.agentBase()}/usage/ledger?limit=50`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`ledger HTTP ${res.statusCode}`)
  return res.data && res.data.entries ? res.data.entries : []
}

async function summary() {
  const res = await http.get(`${api.agentBase()}/usage/summary`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`summary HTTP ${res.statusCode}`)
  const data = res.data || {}
  return {
    granted: Array.isArray(data.granted) ? data.granted : [],
    spent: Array.isArray(data.spent) ? data.spent : []
  }
}

function articleCapacity(balanceValue) {
  return Math.max(0, Math.floor((Number(balanceValue) || 0) / SUANLI_PER_ARTICLE))
}

module.exports = {
  SUANLI_PER_ARTICLE,
  balance,
  ledger,
  summary,
  articleCapacity
}
