const api = require('./api')
const auth = require('./auth')
const http = require('./request')
const agentMessage = require('../utils/agent-message')

function createSession(handlers) {
  let socket = null

  function connect() {
    if (typeof wx === 'undefined' || socket) return
    socket = wx.connectSocket({
      url: `${api.agentWs()}/status`,
      header: http.authHeader(auth.bearer())
    })
    socket.onMessage((message) => {
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
    socket.onError((error) => {
      socket = null
      if (handlers.onError) handlers.onError(error.errMsg || 'status socket error')
    })
    socket.onClose(() => {
      socket = null
    })
  }

  function close() {
    if (socket) socket.close({ code: 1000, reason: 'bye' })
    socket = null
  }

  return { connect, close }
}

module.exports = {
  createSession
}
