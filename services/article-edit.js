const api = require('./api')
const auth = require('./auth')
const http = require('./request')
const article = require('../utils/article')
const agentMessage = require('../utils/agent-message')

function uuid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function logEdit(stage, details) {
  if (typeof console === 'undefined' || !console.log) return
  try {
    console.log('[VoiceDrop article edit]', stage, details || {})
  } catch (_) {
  }
}

function payloadFor(request) {
  const body = {
    type: 'instruct',
    id: request.id,
    text: request.text,
    articleIndex: Math.max(0, request.articleIndex || 0)
  }
  if (request.images && request.images.length) {
    body.images = request.images.map((image) => ({
      key: image.key,
      data: image.base64,
      mediaType: 'image/jpeg'
    }))
  }
  if (request.anchor && request.anchor.type === 'line') {
    body.anchor = {
      type: 'line',
      line: Math.max(0, Number(request.anchor.line) || 0),
      text: String(request.anchor.text || '').slice(0, 2000)
    }
  } else if (request.anchor && request.anchor.type === 'image' && request.anchor.key) {
    body.anchor = { type: 'image', key: String(request.anchor.key) }
  }
  return JSON.stringify(body)
}

function createSession(stem, handlers) {
  let socket = null
  let opened = false
  let closed = false
  let currentSocket = null
  const queueKey = `voicedrop.editqueue.${stem}`
  const queue = loadQueue(queueKey)

  function notifyQueue() {
    if (handlers && handlers.onQueueChanged) handlers.onQueueChanged(queue.slice())
  }

  function notifyState(state) {
    if (handlers && handlers.onState) handlers.onState(state)
  }

  function connect() {
    if (typeof wx === 'undefined') return
    closed = false
    if (socket && opened && socket === currentSocket) return
    opened = false
    if (socket) {
      try { socket.close() } catch (_) {}
    }
    const newSocket = wx.connectSocket({
      url: `${api.agentWs()}/edit?stem=${api.path(stem)}`,
      header: http.authHeader(auth.bearer())
    })
    logEdit('connect', { stem, queueLength: queue.length })
    socket = newSocket
    currentSocket = newSocket
    notifyQueue()
    notifyState(queue.length ? '正在恢复未完成修改...' : '连接文章编辑器...')
    newSocket.onOpen(() => {
      if (newSocket !== currentSocket) return
      opened = true
      logEdit('open', { stem, queueLength: queue.length })
      notifyState('已连接')
      queue.forEach(send)
    })
    newSocket.onMessage((message) => {
      logEdit('message', { stem, data: message && message.data })
      handle(message.data)
    })
    newSocket.onError((error) => {
      if (newSocket !== currentSocket) return
      logEdit('error', { stem, error })
      opened = false
      socket = null
      if (!closed) notifyState('连接断开')
    })
    newSocket.onClose((event) => {
      if (newSocket !== currentSocket) return
      logEdit('close', { stem, event })
      opened = false
      socket = null
      if (!closed) notifyState('连接断开')
    })
  }

  function enqueue(text, articleIndex, images, anchor) {
    if (!text || !text.trim()) return
    const request = {
      id: uuid(),
      text: text.trim(),
      articleIndex: Math.max(0, articleIndex || 0),
      images: images || [],
      anchor: anchor || null
    }
    queue.push(request)
    logEdit('enqueue', { stem, id: request.id, articleIndex: request.articleIndex, imageCount: request.images.length, text: request.text })
    persistQueue(queueKey, queue)
    notifyQueue()
    connect()
    send(request)
    notifyState('正在改')
  }

  function send(request) {
    if (!socket || !opened) {
      logEdit('send-deferred', { stem, id: request.id, hasSocket: !!socket, opened })
      return
    }
    const payload = payloadFor(request)
    logEdit('send', { stem, id: request.id, payload })
    socket.send({ data: payload })
  }

  function handle(raw) {
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (obj.type === 'status') {
        logEdit('status', { stem, state: obj.state })
        notifyState(obj.state === 'working' ? '正在改' : (obj.state || '已连接'))
      } else if (obj.type === 'reply') {
        logEdit('reply', { stem, id: obj.id, ok: obj.ok, text: obj.text })
        if (handlers && handlers.onReply) handlers.onReply(obj.text || '', obj.ok !== false)
        resolve(obj.id)
      } else if (obj.type === 'updated') {
        const doc = updatedDocFromMessage(obj)
        logEdit('updated', { stem, id: obj.id, hasDoc: !!doc })
        if (doc && handlers && handlers.onUpdated) handlers.onUpdated(doc)
        resolve(obj.id)
      } else if (obj.type === 'error') {
        logEdit('server-error', { stem, id: obj.id, message: obj.message })
        if (handlers && handlers.onError) handlers.onError(obj.message || '修改失败')
        resolve(obj.id)
      } else if (obj.type === 'snapshot') {
        logEdit('snapshot', {
          stem,
          hasArticle: !!obj.article,
          serverQueueLength: Array.isArray(obj.queue) ? obj.queue.length : null
        })
        if (obj.article && handlers && handlers.onUpdated) handlers.onUpdated(article.parseDoc(obj.article))
        reconcile(obj.queue)
      }
    } catch (error) {
      if (handlers && handlers.onError) handlers.onError(error.message)
    }
  }

  function reconcile(serverQueue) {
    if (!Array.isArray(serverQueue)) {
      queue.forEach(send)
      return
    }
    const known = {}
    const done = {}
    serverQueue.forEach((item) => {
      if (!item || !item.id) return
      known[item.id] = true
      if (item.status === 'done' || item.status === 'error') done[item.id] = true
    })
    let changed = false
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (done[queue[index].id]) {
        queue.splice(index, 1)
        changed = true
      }
    }
    queue.forEach((request) => {
      if (!known[request.id]) send(request)
    })
    if (changed) persistQueue(queueKey, queue)
    notifyQueue()
    notifyState(queue.length ? '正在改' : '已连接')
  }

  function resolve(id) {
    const index = id ? queue.findIndex((item) => item.id === id) : 0
    if (index >= 0) queue.splice(index, 1)
    persistQueue(queueKey, queue)
    notifyQueue()
    notifyState(queue.length ? '正在改' : '已完成')
  }

  function close() {
    closed = true
    opened = false
    currentSocket = null
    if (socket) socket.close({ code: 1000, reason: 'bye' })
    socket = null
  }

  return { connect, enqueue, close, queue: () => queue.slice() }
}

function updatedDocFromMessage(raw) {
  const update = agentMessage.update(raw)
  return update ? article.parseDoc(update.docJson) : null
}

function loadQueue(key) {
  if (typeof wx === 'undefined') return []
  try {
    const raw = wx.getStorageSync(key)
    return raw ? JSON.parse(raw) : []
  } catch (error) {
    return []
  }
}

function persistQueue(key, queue) {
  if (typeof wx === 'undefined') return
  if (!queue.length) wx.removeStorageSync(key)
  else wx.setStorageSync(key, JSON.stringify(queue))
}

module.exports = {
  payloadFor,
  updatedDocFromMessage,
  createSession
}
