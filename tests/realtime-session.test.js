const test = require('node:test')
const assert = require('node:assert/strict')
const realtime = require('../services/realtime-session')

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

function harness() {
  const sockets = []
  const wx = {
    arrayBufferToBase64: (data) => Buffer.from(data).toString('base64'),
    base64ToArrayBuffer: (text) => Uint8Array.from(Buffer.from(text, 'base64')).buffer,
    connectSocket(options) {
      const handlers = {}
      const sent = []
      const sendCalls = []
      const socket = {
        options, handlers, sent, sendCalls, closeCount: 0, closeCalls: [],
        onOpen: (fn) => { handlers.open = fn },
        onMessage: (fn) => { handlers.message = fn },
        onError: (fn) => { handlers.error = fn },
        onClose: (fn) => { handlers.close = fn },
        send(options) { sendCalls.push(options); sent.push(JSON.parse(options.data)) },
        close(options) { this.closeCount += 1; this.closeCalls.push(options || {}) }
      }
      sockets.push(socket)
      return socket
    }
  }
  const deps = {
    wx,
    api: { agentWs: () => 'wss://jianshuo.dev/agent' },
    auth: { bearer: () => 'token-1' }
  }
  return { sockets, deps }
}

test('connects to the PCMU relay with the exact native-client auth header', () => {
  const h = harness()
  const states = []
  const session = realtime.createSession({ onState: (state) => states.push(state) }, h.deps)
  session.connect()
  assert.equal(h.sockets[0].options.url, 'wss://jianshuo.dev/agent/realtime/relay?fmt=pcmu')
  assert.equal(h.sockets[0].options.header.Authorization, 'Bearer token-1')
  assert.deepEqual(h.sockets[0].options.header, { Authorization: 'Bearer token-1' })
  h.sockets[0].handlers.open()
  assert.deepEqual(states, ['connecting', 'live'])
})

test('degrades on connect, send, socket, and close failures', () => {
  const h = harness()
  const session = realtime.createSession({}, h.deps)

  session.connect()
  h.sockets[0].options.fail({ errMsg: 'connectSocket:fail handshake' })
  assert.equal(session.state(), 'degraded')

  session.connect()
  h.sockets[1].handlers.open({})
  session.appendAudio(new Uint8Array([1, 2]))
  h.sockets[1].sendCalls[0].fail({ errMsg: 'send:fail socket is not connected' })
  assert.equal(session.state(), 'degraded')
  assert.equal(h.sockets[1].closeCount, 1)

  session.connect()
  h.sockets[2].handlers.error({ errMsg: 'socket task failed' })
  assert.equal(session.state(), 'degraded')

  session.connect()
  h.sockets[3].handlers.open({})
  h.sockets[3].handlers.close({ code: 1006, reason: 'network changed' })
  assert.equal(session.state(), 'degraded')
})

test('degrades without throwing when connectSocket fails synchronously', () => {
  const h = harness()
  const states = []
  h.deps.wx.connectSocket = () => { throw new Error('socket unavailable') }
  const session = realtime.createSession({ onState: (state) => states.push(state) }, h.deps)

  assert.doesNotThrow(() => session.connect())
  assert.equal(session.state(), 'degraded')
  assert.deepEqual(states, ['connecting', 'degraded'])
})

test('does not close a socket task that wx already reported as failed', () => {
  const h = harness()
  const session = realtime.createSession({}, h.deps)
  session.connect()
  const failedSocket = h.sockets[0]
  failedSocket.handlers.open()

  failedSocket.handlers.error({ errMsg: '未完成的操作' })

  assert.equal(failedSocket.closeCount, 0)
  assert.equal(session.state(), 'degraded')
  session.connect()
  h.sockets[1].handlers.open()
  assert.equal(session.state(), 'live')
})

test('consumes asynchronous closeSocket rejection during active cleanup', async () => {
  const h = harness()
  const session = realtime.createSession({}, h.deps)
  session.connect()
  const socket = h.sockets[0]
  socket.handlers.open()
  socket.close = () => Promise.reject(new Error('closeSocket:fail wcwss taskID not exist'))
  session.appendAudio(new Uint8Array([1, 2]))

  assert.doesNotThrow(() => socket.sendCalls[0].fail({ errMsg: 'send:fail' }))
  await flush()

  assert.equal(session.state(), 'degraded')
})

test('sends audio only after open and dispatches AI events', () => {
  const h = harness()
  const events = []
  const session = realtime.createSession({
    onResponseCreated: () => events.push('created'),
    onAudioDelta: (data) => events.push(Array.from(new Uint8Array(data))),
    onResponseDone: () => events.push('done')
  }, h.deps)
  session.connect()
  session.appendAudio(new Uint8Array([1, 2]))
  assert.equal(h.sockets[0].sent.length, 0)
  h.sockets[0].handlers.open()
  const backing = new Uint8Array([9, 1, 2, 8])
  session.appendAudio(backing.subarray(1, 3))
  h.sockets[0].handlers.message({ data: JSON.stringify({ type: 'response.created' }) })
  h.sockets[0].handlers.message({ data: JSON.stringify({ type: 'response.output_audio.delta', delta: 'AwQ=' }) })
  h.sockets[0].handlers.message({ data: JSON.stringify({ type: 'response.done' }) })
  assert.deepEqual(h.sockets[0].sent[0], { type: 'input_audio_buffer.append', audio: 'AQI=' })
  assert.deepEqual(events, ['created', [3, 4], 'done'])
})

test('clears the OpenAI input buffer through the current live socket', () => {
  const h = harness()
  const session = realtime.createSession({}, h.deps)
  session.connect()

  session.clearInputBuffer()
  assert.equal(h.sockets[0].sent.length, 0)

  h.sockets[0].handlers.open()
  session.clearInputBuffer()

  assert.deepEqual(h.sockets[0].sent, [{ type: 'input_audio_buffer.clear' }])
})

test('ignores malformed, non-object, and unknown relay events', () => {
  const h = harness()
  const events = []
  const session = realtime.createSession({
    onResponseCreated: () => events.push('created'),
    onAudioDelta: () => events.push('audio'),
    onResponseDone: () => events.push('done')
  }, h.deps)
  session.connect()
  h.sockets[0].handlers.open()

  for (const data of ['{', 'null', '42', '"text"', JSON.stringify({ type: 'unknown' })]) {
    assert.doesNotThrow(() => h.sockets[0].handlers.message({ data }))
  }
  assert.deepEqual(events, [])
})

test('silently ignores an audio delta when base64 decoding throws', () => {
  const h = harness()
  const events = []
  h.deps.wx.base64ToArrayBuffer = () => { throw new Error('bad base64') }
  const session = realtime.createSession({ onAudioDelta: () => events.push('audio') }, h.deps)
  session.connect()
  h.sockets[0].handlers.open()

  assert.doesNotThrow(() => {
    h.sockets[0].handlers.message({ data: JSON.stringify({ type: 'response.output_audio.delta', delta: 'broken' }) })
  })
  assert.deepEqual(events, [])
  assert.equal(session.state(), 'live')
})

for (const scenario of [
  {
    name: 'base64 encoding',
    arrange(h) { h.deps.wx.arrayBufferToBase64 = () => { throw new Error('encode failed') } }
  },
  {
    name: 'JSON serialization',
    arrange(h) { h.deps.wx.arrayBufferToBase64 = () => 1n }
  },
  {
    name: 'SocketTask.send',
    arrange(_h, socket) { socket.send = () => { throw new Error('send failed') } }
  }
]) {
  test(`degrades and closes the current socket when ${scenario.name} throws`, () => {
    const h = harness()
    const states = []
    const session = realtime.createSession({ onState: (state) => states.push(state) }, h.deps)
    session.connect()
    const socket = h.sockets[0]
    socket.handlers.open()
    scenario.arrange(h, socket)

    assert.doesNotThrow(() => session.appendAudio(new Uint8Array([1, 2])))
    assert.equal(session.state(), 'degraded')
    assert.equal(socket.closeCount, 1)
    assert.equal(states.at(-1), 'degraded')
  })
}

test('provides a send fail callback that degrades only its current socket generation', () => {
  const h = harness()
  const session = realtime.createSession({}, h.deps)
  session.connect()
  const oldSocket = h.sockets[0]
  oldSocket.handlers.open()
  session.appendAudio(new Uint8Array([1, 2]))
  const staleFail = oldSocket.sendCalls[0].fail

  assert.equal(typeof staleFail, 'function')
  staleFail({ errMsg: 'send:fail' })
  assert.equal(session.state(), 'degraded')
  assert.equal(oldSocket.closeCount, 1)

  session.connect()
  const currentSocket = h.sockets[1]
  currentSocket.handlers.open()
  staleFail({ errMsg: 'late send:fail' })
  assert.equal(session.state(), 'live')
  assert.equal(currentSocket.closeCount, 0)
})

test('ignores stale callbacks after reconnect generation changes', () => {
  const h = harness()
  const states = []
  const session = realtime.createSession({ onState: (state) => states.push(state) }, h.deps)
  session.connect()
  const oldSocket = h.sockets[0]
  session.disconnect()
  session.connect()
  oldSocket.handlers.error({ errMsg: 'stale' })
  h.sockets[1].handlers.open()
  assert.equal(states.at(-1), 'live')
})

test('disconnect reaches idle when SocketTask.close throws synchronously', () => {
  const h = harness()
  const states = []
  const session = realtime.createSession({ onState: (state) => states.push(state) }, h.deps)
  session.connect()
  const socket = h.sockets[0]
  socket.handlers.open()
  socket.close = () => { throw new Error('close failed') }

  assert.doesNotThrow(() => session.disconnect())
  assert.equal(session.state(), 'idle')
  assert.equal(states.at(-1), 'idle')
})
