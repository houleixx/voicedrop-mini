const api = require('./api')
const auth = require('./auth')
const http = require('./request')
const article = require('../utils/article')

async function list() {
  const res = await http.get(`${api.filesBase()}/community/list`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`community HTTP ${res.statusCode}`)
  return (res.data && res.data.posts ? res.data.posts : []).map(normalizePost)
}

async function rank(posts) {
  if (!posts || !posts.length) return { order: [], liked: [] }
  const res = await http.postJson(`${api.recoBase()}/rank`, auth.bearer(), rankPayload(posts))
  if (res.statusCode < 200 || res.statusCode >= 300) return { order: [], liked: [] }
  return {
    order: res.data && res.data.order || [],
    liked: res.data && res.data.liked || []
  }
}

function rankPayload(posts) {
  const list = posts || []
  const replyCounts = {}
  list.forEach((post) => {
    if (post && post.replyTo) replyCounts[post.replyTo] = (replyCounts[post.replyTo] || 0) + 1
  })
  return {
    posts: list.map((post) => ({
      shareId: post.shareId,
      firstSharedAt: post.firstSharedAt,
      author: post.author || post.authorName || '',
      replyCount: replyCounts[post.shareId] || 0
    }))
  }
}

async function get(shareId) {
  const res = await http.get(`${api.filesBase()}/community/get/${api.path(shareId)}`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) return null
  return postFromDetail(res.data && (res.data.post || res.data))
}

function postFromDetail(raw) {
  const post = normalizePost(raw)
  if (!post.doc) post.doc = article.parseDoc(post)
  return post
}

function normalizePost(raw) {
  const post = Object.assign({}, raw || {})
  post.shareId = trim(post.shareId)
  post.author = trim(post.author || post.authorName)
  post.authorName = trim(post.authorName || post.author)
  post.articleKey = trim(post.articleKey)
  post.firstSharedAt = post.firstSharedAt != null ? post.firstSharedAt : post.sharedAt
  post.dateLabel = formatCommunityDate(post.firstSharedAt)
  post.title = trim(post.title)
  post.replyTo = trim(post.replyTo)
  return post
}

function formatCommunityDate(ms) {
  const value = Number(ms)
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`
  return date.getFullYear() === now.getFullYear() ? monthDay : `${date.getFullYear()}年${monthDay}`
}

function trim(value) {
  return value == null ? '' : String(value).trim()
}

async function sharedShareId(rec) {
  const res = await http.get(`${api.filesBase()}/community/shared/${api.path(`articles/${rec.stem}.json`)}`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) return ''
  return res.data && res.data.shareId || ''
}

async function replies(shareId) {
  const res = await http.get(`${api.filesBase()}/community/replies/${api.path(shareId)}`, auth.bearer())
  return res.statusCode >= 200 && res.statusCode < 300 && res.data ? (res.data.posts || []).map(normalizePost) : []
}

async function share(rec, replyTo) {
  const result = await shareResult(rec, replyTo)
  return result.ok ? result.shareId : ''
}

async function shareResult(rec, replyTo) {
  const data = replyTo ? { replyTo } : {}
  const res = await http.postJson(`${api.filesBase()}/community/share/${api.path(`articles/${rec.stem}.json`)}`, auth.communityBearer(), data)
  return normalizeShareResult(res.statusCode, res.data)
}

function normalizeShareResult(statusCode, data) {
  const code = Number(statusCode) || 0
  const body = data || {}
  const shareId = body.shareId || ''
  const error = body.error || ''
  const ok = code >= 200 && code < 300 && Boolean(shareId)
  const result = {
    ok,
    shareId: ok ? shareId : '',
    code,
    error,
    needsWechatSignin: code === 403 && (error === 'needs_wechat_signin' || error === 'needs_apple_signin')
  }
  if (code === 404 && error === 'article not found') result.articleNotFound = true
  return result
}

async function unshare(shareId) {
  const res = await http.postJson(`${api.filesBase()}/community/unshare/${api.path(shareId)}`, auth.communityBearer(), {})
  return res.statusCode >= 200 && res.statusCode < 300
}

async function report(shareId) {
  const res = await http.postJson(`${api.filesBase()}/community/report/${api.path(shareId)}`, auth.bearer(), {})
  return res.statusCode >= 200 && res.statusCode < 300
}

async function feed(shareId) {
  const res = await http.postJson(`${api.agentBase()}/feed`, auth.communityBearer(), { share_id: shareId })
  return normalizeFeedResult(res.statusCode, res.data)
}

function normalizeFeedResult(statusCode, data) {
  const code = Number(statusCode) || 0
  const body = data || {}
  const suanli = body.suanli || {}
  return {
    ok: body.ok != null ? Boolean(body.ok) : code >= 200 && code < 300,
    already: Boolean(body.already),
    error: body.error || '',
    authorSuanli: Number(suanli.author) || 0,
    feederSuanli: Number(suanli.feeder) || 0,
    needsWechatSignin: body.error === 'needs_wechat_signin' || body.error === 'needs_apple_signin'
  }
}

async function engage(shareId, action, on) {
  try {
    await http.postJson(`${api.recoBase()}/engage/${api.path(shareId)}`, auth.bearer(), on == null ? { action } : { action, on })
  } catch (error) {
  }
}

module.exports = {
  list,
  rank,
  rankPayload,
  get,
  postFromDetail,
  normalizePost,
  formatCommunityDate,
  sharedShareId,
  replies,
  share,
  shareResult,
  normalizeShareResult,
  unshare,
  report,
  feed,
  normalizeFeedResult,
  engage
}
