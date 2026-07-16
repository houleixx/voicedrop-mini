const api = require('./api')
const auth = require('./auth')
const http = require('./request')
const agentMessage = require('../utils/agent-message')

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
  let retryTimer = null
  let closed = true

  function clearRetry() {
    if (retryTimer) clearDelay(retryTimer)
    retryTimer = null
  }

  function connect() {
    if (!socketApi || socket || connecting) return Promise.resolve()
    closed = false
    clearRetry()
    return open()
  }

  function open() {
    if (closed || socket || connecting) return Promise.resolve()
    connecting = true
    const currentGeneration = ++generation
    try {
      openSocket({
        url: `${apiService.agentWs()}/status`,
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
    current.onMessage((message) => {
      if (closed || socket !== current) return null
      const raw = message.data
      const request = agentMessage.linkRequest(raw)
      if (request && handlers.onLinkRequest) return handlers.onLinkRequest(request)
      const release = agentMessage.linkRelease(raw)
      if (release && handlers.onLinkRelease) return handlers.onLinkRelease(release)
      const stat = agentMessage.status(raw)
      if (!stat) return null
      if (stat.status === 'ready' || stat.status === 'empty') {
        if (handlers.onDone) handlers.onDone(stat)
      } else if (handlers.onPhase) {
        handlers.onPhase(stat)
      }
      return null
    })
    current.onError(() => scheduleReconnect(current))
    current.onClose(() => scheduleReconnect(current))
  }

  function scheduleReconnect(current) {
    if (socket && socket !== current) return
    if (socket === current) socket = null
    if (closed || retryTimer) return
    retryTimer = delay(() => {
      retryTimer = null
      if (!closed) open()
    }, 3000)
  }

  function close() {
    closed = true
    connecting = false
    generation++
    clearRetry()
    const current = socket
    socket = null
    if (current) current.close({ code: 1000, reason: 'bye' })
  }

  return { connect, close }
}

module.exports = {
  createSession
}
