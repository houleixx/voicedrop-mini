const api = require('./api')
const auth = require('./auth')
const http = require('./request')

const QUEUE_KEY = 'voicedrop.commandqueue.default'

function uuid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function payloadFor(id, text, refs) {
  return JSON.stringify({
    type: 'instruct',
    id,
    text,
    refs: (refs || []).map((ref) => ({ n: ref.n, stem: ref.stem || '', title: ref.title || '' }))
  })
}

function confirmPayload(id) {
  return JSON.stringify({ type: 'confirm', id })
}

function cancelPayload(id) {
  return JSON.stringify({ type: 'cancel', id })
}

function loadQueue() {
  if (typeof wx === 'undefined') return []
  try {
    const raw = wx.getStorageSync(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (error) {
    return []
  }
}

function saveQueue(queue) {
  if (typeof wx === 'undefined') return
  if (!queue.length) wx.removeStorageSync(QUEUE_KEY)
  else wx.setStorageSync(QUEUE_KEY, JSON.stringify(queue.map(({ id, text }) => ({ id, text }))))
}

function createSession(handlers) {
  let socket = null
  let closed = false
  let opened = false
  let refs = []
  const queue = loadQueue()

  function notifyQueue() {
    if (handlers.onQueueChanged) handlers.onQueueChanged(queue.slice())
  }

  function notifyState(state) {
    if (handlers.onState) handlers.onState(state)
  }

  function setRefs(nextRefs) {
    refs = nextRefs ? nextRefs.slice() : []
  }

  function connect() {
    if (typeof wx === 'undefined' || socket) return
    closed = false
    notifyQueue()
    notifyState(queue.length ? '正在恢复' : '已连接')
    socket = wx.connectSocket({
      url: `${api.agentWs()}/command`,
      header: http.authHeader(auth.bearer())
    })
    socket.onOpen(() => {
      opened = true
      notifyState('已连接')
      queue.forEach(send)
    })
    socket.onMessage((message) => handle(message.data))
    socket.onError(() => {
      socket = null
      opened = false
      if (!closed) notifyState('连接断开')
    })
    socket.onClose(() => {
      socket = null
      opened = false
    })
  }

  function enqueue(text, nextRefs) {
    if (!text || !text.trim()) return
    setRefs(nextRefs)
    const request = { id: uuid(), text: text.trim() }
    queue.push(request)
    saveQueue(queue)
    notifyQueue()
    send(request)
    notifyState('正在执行')
  }

  function send(request) {
    if (!socket || !opened) return
    try {
      socket.send({ data: payloadFor(request.id, request.text, refs) })
    } catch (error) {
      opened = false
    }
  }

  function confirm(id) {
    if (socket && opened && id) socket.send({ data: confirmPayload(id) })
  }

  function cancel(id) {
    if (socket && opened && id) socket.send({ data: cancelPayload(id) })
  }

  function handle(raw) {
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
      const id = obj.id || ''
      if (obj.type === 'status') {
        notifyState(obj.state === 'working' ? '正在执行' : (obj.state || '已连接'))
      } else if (obj.type === 'reply' && handlers.onReply) {
        handlers.onReply(obj.text || '', obj.ok !== false)
      } else if (obj.type === 'confirm' && handlers.onConfirm) {
        handlers.onConfirm(id, obj.text || obj.message || '确认执行这条指令？')
      } else if (obj.type === 'updated') {
        if (handlers.onUpdate) handlers.onUpdate(obj.stems || [])
        resolve(id)
      } else if (obj.type === 'error') {
        if (handlers.onError) handlers.onError(obj.message || '指令执行失败')
        resolve(id)
      }
    } catch (error) {
      if (handlers.onError) handlers.onError(error.message)
    }
  }

  function resolve(id) {
    const index = id ? queue.findIndex((item) => item.id === id) : 0
    if (index >= 0) queue.splice(index, 1)
    saveQueue(queue)
    notifyQueue()
    notifyState(queue.length ? '正在执行' : '指令已完成')
  }

  function close() {
    closed = true
    opened = false
    if (socket) socket.close({ code: 1000, reason: 'bye' })
    socket = null
  }

  return { setRefs, connect, enqueue, confirm, cancel, close, queue: () => queue.slice() }
}

module.exports = {
  payloadFor,
  confirmPayload,
  cancelPayload,
  createSession
}
