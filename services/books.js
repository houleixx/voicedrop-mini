const auth = require('./auth')
const http = require('./request')

const API = 'https://lab.jianshuo.dev/api/book'
const SHELF = 'https://voicedrop.cn/books/'

async function start(seed) {
  return http.postJson(API, auth.bearer(), { seed: String(seed || '').trim().slice(0, 20000) }, { timeout: 30000 })
}

function message(statusCode) {
  if (statusCode === 202) return '开始写了！现在可以关闭小程序，稍后去公开书架查看。'
  if (statusCode === 409) return '服务器正在写另一本书，等它写完再来。'
  if (statusCode === 401) return '还不能写书：请先用 VoiceDrop 录音并生成至少一篇文章。'
  if (statusCode === 429) return '今天的写书额度用完了，明天再来。'
  return statusCode ? `服务器返回 ${statusCode}，请稍后重试。` : '没连上服务器，请检查网络后重试。'
}

module.exports = { API, SHELF, start, message }
