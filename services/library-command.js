const api = require('./api')
const auth = require('./auth')
const http = require('./request')

const QUEUE_KEY = 'voicedrop.commandqueue.default'
const CONTROL_KEY = 'voicedrop.commandcontrols.default'
const CONFIRM_KEY = 'voicedrop.commandconfirms.default'

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

function normalizeRefs(refs) {
  return Array.isArray(refs)
    ? refs.filter((ref) => ref && ref.stem).map((ref) => ({
      n: Number(ref.n),
      stem: String(ref.stem),
      title: String(ref.title || '')
    }))
    : []
}

function loadQueue(storageApi) {
  if (!storageApi) return []
  try {
    const raw = storageApi.getStorageSync(QUEUE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && item.id && item.text).map((item) => ({
        id: String(item.id),
        text: String(item.text),
        refs: normalizeRefs(item.refs)
      }))
      : []
  } catch (error) {
    return []
  }
}

function saveQueue(queue, storageApi) {
  if (!storageApi) return
  if (!queue.length) storageApi.removeStorageSync(QUEUE_KEY)
  else storageApi.setStorageSync(QUEUE_KEY, JSON.stringify(queue.map(({ id, text, refs }) => ({
    id,
    text,
    refs: normalizeRefs(refs)
  }))))
}

function loadControls(storageApi) {
  if (!storageApi) return []
  try {
    const raw = storageApi.getStorageSync(CONTROL_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && item.id && (item.type === 'confirm' || item.type === 'cancel'))
      : []
  } catch (_) {
    return []
  }
}

function saveControls(controls, storageApi) {
  if (!storageApi) return
  if (!controls.length) storageApi.removeStorageSync(CONTROL_KEY)
  else storageApi.setStorageSync(CONTROL_KEY, JSON.stringify(controls))
}

function loadConfirms(storageApi) {
  if (!storageApi) return []
  try {
    const raw = storageApi.getStorageSync(CONFIRM_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && item.id).map((item) => ({
        id: item.id,
        text: item.text || '确认执行这条指令？'
      }))
      : []
  } catch (_) {
    return []
  }
}

function saveConfirms(confirms, storageApi) {
  if (!storageApi) return
  if (!confirms.length) storageApi.removeStorageSync(CONFIRM_KEY)
  else storageApi.setStorageSync(CONFIRM_KEY, JSON.stringify(confirms))
}

function createSession(handlers, runtime) {
  handlers = handlers || {}
  runtime = runtime || {}
  const socketApi = runtime.wx || (typeof wx === 'undefined' ? null : wx)
  const apiService = runtime.api || api
  const authService = runtime.auth || auth
  const httpService = runtime.http || http
  const delay = runtime.setTimeout || setTimeout
  const clearDelay = runtime.clearTimeout || clearTimeout
  let socket = null
  let connecting = false
  let generation = 0
  let closed = false
  let opened = false
  let snapshotReady = false
  let retryTimer = null
  let snapshotTimer = null
  let refs = []
  const queue = loadQueue(socketApi)
  const controls = loadControls(socketApi)
  const confirms = loadConfirms(socketApi)

  function trace(stage, details) {
    const safeDetails = details || {}
    if (handlers.onTrace) {
      handlers.onTrace(stage, safeDetails)
      return
    }
    if (typeof console !== 'undefined' && console.info) {
      console.info('[VoiceDrop library command]', stage, safeDetails)
    }
  }

  function clearRetry() {
    if (retryTimer) clearDelay(retryTimer)
    retryTimer = null
  }

  function clearSnapshotTimer() {
    if (snapshotTimer) clearDelay(snapshotTimer)
    snapshotTimer = null
  }

  function notifyQueue() {
    if (handlers.onQueueChanged) handlers.onQueueChanged(queue.slice())
  }

  function notifyState(state) {
    if (handlers.onState) handlers.onState(state)
  }

  function setRefs(nextRefs) {
    refs = normalizeRefs(nextRefs)
  }

  function connect() {
    if (!socketApi || socket || connecting) return Promise.resolve()
    closed = false
    clearRetry()
    trace('connect', { queueLength: queue.length })
    notifyQueue()
    notifyState(queue.length ? '正在恢复' : '已连接')
    notifyConfirms()
    return open()
  }

  function notifyConfirms() {
    if (!handlers.onConfirm) return
    confirms.forEach((item) => handlers.onConfirm(item.id, item.text))
  }

  function open() {
    if (closed || socket || connecting) return Promise.resolve()
    connecting = true
    const currentGeneration = ++generation
    try {
      openSocket({
        url: `${apiService.agentWs()}/command`,
        header: httpService.authHeader(authService.bearer())
      }, currentGeneration)
    } catch (_) {
      handleOpenError(currentGeneration)
    }
    return Promise.resolve()
  }

  function handleOpenError(currentGeneration) {
    connecting = false
    if (!closed && currentGeneration === generation) scheduleReconnect(null)
  }

  function openSocket(options, currentGeneration) {
    connecting = false
    if (closed || socket || currentGeneration !== generation) return
    const current = socketApi.connectSocket(options)
    socket = current
    current.onOpen(() => {
      if (closed || socket !== current) return
      opened = true
      snapshotReady = false
      trace('open', { queueLength: queue.length })
      notifyState('已连接')
      queue.slice().forEach(send)
      clearSnapshotTimer()
      snapshotTimer = delay(() => {
        snapshotTimer = null
        if (closed || socket !== current || snapshotReady) return
        snapshotReady = true
        reconcile(null)
        flushControls()
      }, 250)
    })
    current.onMessage((message) => {
      if (!closed && socket === current) handle(message.data)
    })
    current.onError((error) => {
      trace('socket-error', { message: error && (error.errMsg || error.message) || 'unknown' })
      scheduleReconnect(current)
    })
    current.onClose((event) => {
      trace('socket-close', {
        code: event && event.code,
        reason: event && event.reason || ''
      })
      scheduleReconnect(current)
    })
  }

  function scheduleReconnect(current) {
    if (socket && socket !== current) return
    if (socket === current) socket = null
    opened = false
    snapshotReady = false
    clearSnapshotTimer()
    if (closed || retryTimer) return
    notifyState(queue.length ? '正在恢复' : '连接断开')
    retryTimer = delay(() => {
      retryTimer = null
      if (!closed) open()
    }, 1500)
  }

  function enqueue(text, nextRefs) {
    if (!text || !text.trim()) return
    if (nextRefs !== undefined) setRefs(nextRefs)
    const requestRefs = nextRefs === undefined ? refs : nextRefs
    const request = { id: uuid(), text: text.trim(), refs: normalizeRefs(requestRefs) }
    queue.push(request)
    saveQueue(queue, socketApi)
    trace('enqueue', { id: request.id, textLength: request.text.length, refCount: request.refs.length })
    notifyQueue()
    if (opened) send(request)
    else connect()
    notifyState('正在执行')
  }

  function send(request) {
    if (!socket || !opened) return
    const current = socket
    try {
      trace('send', { id: request.id, refCount: request.refs.length })
      current.send({
        data: payloadFor(request.id, request.text, request.refs),
        success: () => trace('send-ok', { id: request.id }),
        fail: (error) => {
          trace('send-fail', {
            id: request.id,
            message: error && (error.errMsg || error.message) || 'unknown'
          })
          if (socket === current) scheduleReconnect(current)
        }
      })
    } catch (error) {
      scheduleReconnect(current)
    }
  }

  function confirm(id) {
    queueControl('confirm', id)
  }

  function cancel(id) {
    queueControl('cancel', id)
  }

  function queueControl(type, id) {
    if (!id) return
    clearConfirm(id)
    const existing = controls.findIndex((item) => item.id === id)
    const control = { type, id }
    if (existing >= 0) controls.splice(existing, 1, control)
    else controls.push(control)
    saveControls(controls, socketApi)
    flushControls()
  }

  function flushControls() {
    if (!socket || !opened || !snapshotReady || !controls.length) return
    const current = socket
    for (const control of controls) {
      try {
        current.send({
          data: control.type === 'confirm' ? confirmPayload(control.id) : cancelPayload(control.id),
          fail: () => {
            if (socket === current) scheduleReconnect(current)
          }
        })
      } catch (_) {
        scheduleReconnect(current)
        return
      }
    }
  }

  function clearControl(id) {
    if (!id) return
    const index = controls.findIndex((item) => item.id === id)
    if (index < 0) return
    controls.splice(index, 1)
    saveControls(controls, socketApi)
  }

  function rememberConfirm(id, text) {
    if (!id) return
    const confirmation = { id, text }
    const index = confirms.findIndex((item) => item.id === id)
    if (index >= 0) confirms.splice(index, 1, confirmation)
    else confirms.push(confirmation)
    saveConfirms(confirms, socketApi)
  }

  function clearConfirm(id) {
    if (!id) return
    const index = confirms.findIndex((item) => item.id === id)
    if (index < 0) return
    confirms.splice(index, 1)
    saveConfirms(confirms, socketApi)
  }

  function handle(raw) {
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
      const id = obj.id || ''
      trace('receive', { type: obj.type || '', id, state: obj.state || '' })
      if (obj.type === 'status') {
        notifyState(obj.state === 'working' ? '正在执行' : (obj.state || '已连接'))
      } else if (obj.type === 'reply') {
        if (handlers.onReply) handlers.onReply(obj.text || '', obj.ok !== false)
        if (id) {
          clearControl(id)
          clearConfirm(id)
          resolve(id)
        }
      } else if (obj.type === 'confirm') {
        if (controls.some((item) => item.id === id)) return
        const text = obj.summary || obj.text || obj.message || '确认执行这条指令？'
        rememberConfirm(id, text)
        if (handlers.onConfirm) handlers.onConfirm(id, text)
      } else if (obj.type === 'updated') {
        clearControl(id)
        clearConfirm(id)
        if (handlers.onUpdate) handlers.onUpdate(obj.stems || [])
        resolve(id)
      } else if (obj.type === 'error') {
        clearControl(id)
        clearConfirm(id)
        if (handlers.onError) handlers.onError(obj.message || '指令执行失败')
        resolve(id)
      } else if (obj.type === 'snapshot') {
        clearSnapshotTimer()
        snapshotReady = true
        reconcile(obj.queue)
        flushControls()
      }
    } catch (error) {
      trace('parse-error', { message: error && error.message || 'unknown', dataType: typeof raw })
    }
  }

  function resolve(id) {
    const index = id ? queue.findIndex((item) => item.id === id) : 0
    if (index >= 0) queue.splice(index, 1)
    saveQueue(queue, socketApi)
    notifyQueue()
    notifyState(queue.length ? '正在执行' : '指令已完成')
  }

  function reconcile(serverQueue) {
    if (!Array.isArray(serverQueue)) {
      queue.slice().forEach(send)
      return
    }
    const states = new Map(serverQueue
      .filter((item) => item && item.id)
      .map((item) => [item.id, item.status]))
    const terminalIds = serverQueue
      .filter((item) => item && item.id && (item.status === 'done' || item.status === 'error'))
      .map((item) => item.id)
    terminalIds.forEach((id) => {
      clearControl(id)
      clearConfirm(id)
    })
    const resolved = new Set()
    queue.slice().forEach((request) => {
      const state = states.get(request.id)
      if (state === 'done' || state === 'error') resolved.add(request.id)
      else if (state !== 'pending' && state !== 'running') send(request)
    })
    if (resolved.size) {
      for (let index = queue.length - 1; index >= 0; index--) {
        if (resolved.has(queue[index].id)) queue.splice(index, 1)
      }
      saveQueue(queue, socketApi)
      notifyQueue()
    }
    notifyState(queue.length ? '正在执行' : '指令已完成')
  }

  function close() {
    closed = true
    connecting = false
    generation++
    opened = false
    snapshotReady = false
    clearRetry()
    clearSnapshotTimer()
    const current = socket
    socket = null
    if (current) current.close({ code: 1000, reason: 'bye' })
  }

  return { setRefs, connect, enqueue, confirm, cancel, close, queue: () => queue.slice() }
}

module.exports = {
  payloadFor,
  confirmPayload,
  cancelPayload,
  createSession
}
