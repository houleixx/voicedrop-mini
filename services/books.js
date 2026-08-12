const auth = require('./auth')
const http = require('./request')

const API = 'https://lab.jianshuo.dev/api/book'
const SHELF = 'https://voicedrop.cn/books/'
const BOOK_SUANLI = 320

async function start(seed) {
  return http.postJson(API, auth.bearer(), { seed: String(seed || '').trim().slice(0, 20000) }, { timeout: 30000 })
}

function formatSuanli(value, fallback) {
  const number = Number.isFinite(Number(value)) ? Number(value) : fallback
  return Number(number.toFixed(1)).toString()
}

function message(statusCode, data) {
  if (statusCode === 202) return '开始写了！现在可以关闭小程序，稍后去公开书架查看。'
  if (statusCode === 402) {
    const body = data && typeof data === 'object' ? data : {}
    const need = formatSuanli(body.need_suanli, BOOK_SUANLI)
    const have = formatSuanli(body.suanli, 0)
    return `算力不足：写一本书要 ${need} 算力，你现在有 ${have}。去「设置 → 算力」看看怎么攒。`
  }
  if (statusCode === 401) return '身份校验没过，请稍后重试。'
  return statusCode ? `服务器返回 ${statusCode}，请稍后重试。` : '没连上服务器，请检查网络后重试。'
}

function result(response) {
  const statusCode = response && Number(response.statusCode) || 0
  return {
    accepted: statusCode === 202,
    statusCode,
    message: message(statusCode, response && response.data)
  }
}

module.exports = { API, SHELF, BOOK_SUANLI, start, message, result }
