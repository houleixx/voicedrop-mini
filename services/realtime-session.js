const defaultApi = require('./api')
const defaultAuth = require('./auth')
const RECONNECT_CLOSE_CODE = 4000

function createSession(handlers, injected) {
  const deps = injected || {}
  const wxApi = deps.wx || wx
  const api = deps.api || defaultApi
  const auth = deps.auth || defaultAuth
  const callbacks = handlers || {}
  let socket = null
  let generation = 0
  let currentState = 'idle'
  let open = false

  function setState(next) {
    if (currentState === next) return
    currentState = next
    if (callbacks.onState) callbacks.onState(next)
  }

  function current(localSocket, localGeneration) {
    return socket === localSocket && generation === localGeneration
  }

  function safeClose(localSocket, options) {
    try {
      const closing = localSocket.close(options)
      if (closing && typeof closing.catch === 'function') closing.catch(() => {})
    } catch (_) {}
  }

  function markCurrentSocketFailed(localSocket, localGeneration) {
    if (!current(localSocket, localGeneration)) return
    generation += 1
    socket = null
    open = false
    setState('degraded')
  }

  function failCurrentSocket(localSocket, localGeneration) {
    if (!current(localSocket, localGeneration)) return
    generation += 1
    socket = null
    open = false
    safeClose(localSocket, { code: RECONNECT_CLOSE_CODE, reason: 'retry' })
    setState('degraded')
  }

  function connect() {
    if (socket) return
    const token = auth.bearer()
    if (!token) { setState('degraded'); return }
    setState('connecting')
    const localGeneration = ++generation
    let localSocket
    try {
      localSocket = wxApi.connectSocket({
        url: `${api.agentWs()}/realtime/relay?fmt=pcmu`,
        // Match the working iOS URLSession and Android OkHttp handshakes exactly.
        // The relay only consumes Authorization; avoid miniapp-only headers here.
        header: { Authorization: `Bearer ${token}` },
        fail: () => {
          if (!current(localSocket, localGeneration)) return
          markCurrentSocketFailed(localSocket, localGeneration)
        }
      })
    } catch (_) {
      socket = null
      open = false
      setState('degraded')
      return
    }
    socket = localSocket
    localSocket.onOpen(() => {
      if (!current(localSocket, localGeneration)) return
      open = true
      setState('live')
    })
    localSocket.onMessage((message) => {
      if (!current(localSocket, localGeneration)) return
      handleMessage(message && message.data)
    })
    localSocket.onError(() => {
      // wx has already invalidated this task; closing it again rejects with taskID not exist.
      markCurrentSocketFailed(localSocket, localGeneration)
    })
    localSocket.onClose(() => {
      if (!current(localSocket, localGeneration)) return
      socket = null
      open = false
      setState('degraded')
    })
  }

  function handleMessage(raw) {
    let event
    try { event = JSON.parse(typeof raw === 'string' ? raw : '') } catch (_) { return }
    if (!event || typeof event !== 'object') return
    if (event.type === 'response.created') {
      if (callbacks.onResponseCreated) callbacks.onResponseCreated()
    } else if (event.type === 'response.output_audio.delta' && event.delta) {
      let audio
      try {
        audio = wxApi.base64ToArrayBuffer(event.delta)
      } catch (_) {
        return
      }
      if (callbacks.onAudioDelta) callbacks.onAudioDelta(audio)
    } else if (event.type === 'response.done') {
      if (callbacks.onResponseDone) callbacks.onResponseDone()
    }
  }

  function appendAudio(bytes) {
    if (!socket || !open || !bytes || !bytes.byteLength) return
    const localSocket = socket
    const localGeneration = generation
    try {
      const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      const data = JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: wxApi.arrayBufferToBase64(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength))
      })
      localSocket.send({
        data,
        fail: () => failCurrentSocket(localSocket, localGeneration)
      })
    } catch (_) {
      failCurrentSocket(localSocket, localGeneration)
    }
  }

  function clearInputBuffer() {
    if (!socket || !open) return
    const localSocket = socket
    const localGeneration = generation
    try {
      localSocket.send({
        data: JSON.stringify({ type: 'input_audio_buffer.clear' }),
        fail: () => failCurrentSocket(localSocket, localGeneration)
      })
    } catch (_) {
      failCurrentSocket(localSocket, localGeneration)
    }
  }

  function disconnect() {
    generation += 1
    const old = socket
    socket = null
    open = false
    if (old) safeClose(old, { code: 1000, reason: 'done' })
    setState('idle')
  }

  return { connect, appendAudio, clearInputBuffer, disconnect, state: () => currentState }
}

module.exports = { createSession }
