const api = require('./api')
const auth = require('./auth')
const http = require('./request')
const article = require('../utils/article')

const FEED_CACHE_PREFIX = 'voicedrop.community.feed.v1.'

// The standalone reco Worker intentionally has no SESSION_SECRET and therefore
// accepts the stable anon capability token, not a WeChat session JWT.
function recoBearer() {
  return auth.anonymousBearer()
}

async function list() {
  const res = await http.get(`${api.filesBase()}/community/list`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`community HTTP ${res.statusCode}`)
  return (res.data && res.data.posts ? res.data.posts : []).map(normalizePost)
}

async function rank(posts) {
  if (!posts || !posts.length) return { order: [], liked: [], likes: {} }
  const res = await http.postJson(`${api.recoBase()}/rank`, recoBearer(), rankPayload(posts))
  if (res.statusCode < 200 || res.statusCode >= 300) return { order: [], liked: [], likes: {} }
  return {
    order: res.data && res.data.order || [],
    liked: res.data && res.data.liked || [],
    likes: res.data && res.data.likes || {}
  }
}

async function loadFeed() {
  const identity = auth.anonId()
  try {
    const res = await http.get(`${api.recoBase()}/feed`, recoBearer())
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const unified = normalizeUnifiedFeed(res.data)
      if (unified.latest.length) {
        storeFeedSnapshot(res.data, identity)
        return unified
      }
    }
  } catch (_) {
  }

  const posts = await list()
  let ranking
  try {
    ranking = await rank(posts)
  } catch (_) {
    ranking = { order: posts.map((post) => post.shareId), liked: [], likes: {} }
  }
  return legacyFeed(posts, ranking)
}

function cachedFeed() {
  try {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null
    const raw = wx.getStorageSync(`${FEED_CACHE_PREFIX}${auth.anonId()}`)
    if (!raw) return null
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw
    const feed = normalizeUnifiedFeed(data)
    return feed.latest.length ? feed : null
  } catch (_) {
    return null
  }
}

function storeFeedSnapshot(data, identity) {
  try {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return
    const key = `${FEED_CACHE_PREFIX}${identity || auth.anonId()}`
    wx.setStorageSync(key, JSON.stringify(data || {}))
  } catch (_) {
  }
}

function normalizeUnifiedFeed(data) {
  const body = data || {}
  const latest = Array.isArray(body.posts) ? body.posts.map(normalizePost) : []
  const likes = {}
  const replies = {}
  const liked = []
  latest.forEach((post) => {
    likes[post.shareId] = Number(post.likes) || 0
    if (Number(post.replies) > 0) replies[post.shareId] = Number(post.replies)
    if (post.liked) liked.push(post.shareId)
  })
  return {
    recommended: reorder(latest, body.order),
    latest,
    likes,
    replies,
    liked,
    unified: true
  }
}

function legacyFeed(posts, ranking) {
  const latest = (posts || []).map(normalizePost)
  const rankResult = ranking || {}
  const replies = {}
  latest.forEach((post) => {
    if (post.replyTo) replies[post.replyTo] = (replies[post.replyTo] || 0) + 1
  })
  return {
    recommended: reorder(latest, rankResult.order),
    latest,
    likes: Object.assign({}, rankResult.likes || {}),
    replies,
    liked: Array.isArray(rankResult.liked) ? rankResult.liked.slice() : [],
    unified: false
  }
}

function reorder(posts, order) {
  const latest = posts || []
  if (!Array.isArray(order) || order.length !== latest.length) return latest.slice()
  const byId = {}
  latest.forEach((post) => { byId[post.shareId] = post })
  const ordered = order.map((id) => byId[id]).filter(Boolean)
  return ordered.length === latest.length && new Set(ordered.map((post) => post.shareId)).size === latest.length
    ? ordered
    : latest.slice()
}

function postsForTab(feed, tab) {
  const value = feed || { recommended: [], latest: [] }
  if (tab === 'latest') return (value.latest || []).slice()
  if (tab === 'replies') return (value.recommended || []).filter((post) => Boolean(post.replyTo))
  if (tab === 'prompts') return (value.recommended || []).filter((post) => post.isPrompt)
  return (value.recommended || []).slice()
}

function filterFeed(feed, keep) {
  const value = feed || legacyFeed([], {})
  return Object.assign({}, value, {
    recommended: (value.recommended || []).filter(keep),
    latest: (value.latest || []).filter(keep)
  })
}

function cardPosts(feed, tab) {
  return postsForTab(feed, tab).map((post) => {
    const author = post.author || post.authorName || '匿名'
    return Object.assign({}, post, {
      authorDisplay: author,
      authorInitial: Array.from(author)[0] || '匿',
      avatarColor: avatarColor(author),
      paletteClass: `community-palette-${paletteIndex(post.shareId)}`,
      coverPhotoUrl: post.coverPhotoKey ? api.photoUrl(post.coverPhotoKey) : '',
      isReply: Boolean(post.replyTo),
      isPrompt: Boolean(post.isPrompt),
      likeCount: Number(feed && feed.likes && feed.likes[post.shareId]) || 0,
      replyCount: Number(feed && feed.replies && feed.replies[post.shareId]) || 0
    })
  })
}

// Mirrors iOS CommunityFeedView: consume the feed in order and always place the
// next card in the currently shorter column. CSS multi-column layout cannot be
// used here because it changes the visual reading order.
function masonryColumns(posts, coverAspects) {
  const left = []
  const right = []
  let leftHeight = 0
  let rightHeight = 0
  ;(posts || []).forEach((post) => {
    const height = estimatedCardHeight(post, coverAspects)
    if (leftHeight <= rightHeight) {
      left.push(post)
      leftHeight += height + 18
    } else {
      right.push(post)
      rightHeight += height + 18
    }
  })
  return { left, right }
}

function estimatedCardHeight(post, coverAspects) {
  const width = 335
  const titleLength = Array.from(String(post && post.title || '')).length
  const isReply = Boolean(post && post.replyTo)
  if (post && post.coverPhotoKey) {
    const aspect = Number(coverAspects && coverAspects[post.coverPhotoKey]) || 1
    const titleLines = Math.min(2, Math.max(1, Math.ceil(titleLength * 29 / Math.max(width - 44, 1))))
    return width / aspect + titleLines * 42 + 40 + 60 + (isReply ? 56 : 0)
  }
  const previewLength = Array.from(String(post && post.preview || '')).length
  const titleLines = Math.min(3, Math.max(1, Math.ceil(titleLength * 32 / Math.max(width - 52, 1))))
  const previewLines = previewLength
    ? Math.min(2, Math.max(1, Math.ceil(previewLength * 25 / Math.max(width - 52, 1))))
    : 0
  return titleLines * 48 + previewLines * 40 + (isReply ? 60 : 0) + 40 + 54 + (previewLines ? 16 : 0)
}

function paletteIndex(shareId) {
  let hash = 0
  Array.from(String(shareId || '')).forEach((char) => { hash = (hash * 31 + char.charCodeAt(0)) & 0xffff })
  return hash % 3
}

function avatarColor(author) {
  const colors = ['#d8a25b', '#8a9a88', '#b5794c', '#7a6e9a', '#5e8a6a', '#c98a2e']
  let hash = 0
  Array.from(String(author || '')).forEach((char) => { hash = (hash * 31 + char.charCodeAt(0)) & 0xffff })
  return colors[hash % colors.length]
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
  post.coverPhotoKey = trim(post.coverPhotoKey)
  post.preview = trim(post.preview)
  post.kind = trim(post.kind)
  post.promptCode = trim(post.promptCode)
  post.appliesTo = Array.isArray(post.appliesTo) ? post.appliesTo.map(trim).filter(Boolean) : []
  // The unified /reco/feed only carries the lightweight `kind` field.
  // promptCode is loaded from /community/get/<shareId> when opening detail.
  post.isPrompt = post.kind === 'prompt'
  post.updatedAt = post.updatedAt != null ? post.updatedAt : post.firstSharedAt
  post.count = Number(post.count) || 0
  post.mine = Boolean(post.mine)
  post.hasPhoto = Boolean(post.hasPhoto)
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

async function feedStates(shareIds) {
  const ids = (shareIds || []).map(String).filter(Boolean)
  if (!ids.length) return {}
  const res = await http.postJson(`${api.agentBase()}/feed/state`, auth.bearer(), { share_ids: ids })
  if (res.statusCode < 200 || res.statusCode >= 300) return {}
  return res.data && res.data.states || {}
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
    await http.postJson(`${api.recoBase()}/engage/${api.path(shareId)}`, recoBearer(), on == null ? { action } : { action, on })
  } catch (error) {
  }
}

module.exports = {
  recoBearer,
  list,
  rank,
  loadFeed,
  cachedFeed,
  storeFeedSnapshot,
  normalizeUnifiedFeed,
  legacyFeed,
  postsForTab,
  filterFeed,
  cardPosts,
  masonryColumns,
  paletteIndex,
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
  feedStates,
  normalizeFeedResult,
  engage
}
