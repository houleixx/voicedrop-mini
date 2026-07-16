const test = require('node:test')
const assert = require('node:assert/strict')

const statusSession = require('../services/status-session')
const libraryCommand = require('../services/library-command')

function socketHarness(storage) {
  storage = storage || {}
  const sockets = []
  const wx = {
    socketUrl: (audience) => `wss://jianshuo.dev/agent/${audience}?ticket=test`,
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    connectSocket(options) {
      const callbacks = {}
      const sent = []
      const socket = {
        options,
        callbacks,
        sent,
        onOpen(cb) { callbacks.open = cb },
        onMessage(cb) { callbacks.message = cb },
        onError(cb) { callbacks.error = cb },
        onClose(cb) { callbacks.close = cb },
        send(message) { sent.push(message) },
        close() { if (callbacks.close) callbacks.close({ code: 1000 }) }
      }
      sockets.push(socket)
      return socket
    }
  }
  return { wx, sockets, storage }
}

function directAuthRuntime(wx, extra) {
  return Object.assign({
    wx,
    api: { agentWs: () => 'wss://jianshuo.dev/agent' },
    auth: { bearer: () => 'test-token' },
    http: {
      authHeader(token) {
        return { Authorization: `Bearer ${token}`, 'X-VD-Platform': 'miniapp' }
      }
    },
    // The canceled implementation used this hook. Keeping it here makes the
    // RED assertion prove production no longer consults a ticket URL provider.
    socketUrl: async (audience) => `wss://jianshuo.dev/agent/${audience}?ticket=obsolete`
  }, extra || {})
}

test('status and command sockets use direct bearer authentication', async () => {
  const status = socketHarness()
  const command = socketHarness()
  await statusSession.createSession({}, directAuthRuntime(status.wx)).connect()
  await libraryCommand.createSession({}, directAuthRuntime(command.wx)).connect()

  assert.deepEqual(status.sockets[0].options, {
    url: 'wss://jianshuo.dev/agent/status',
    header: { Authorization: 'Bearer test-token', 'X-VD-Platform': 'miniapp' }
  })
  assert.deepEqual(command.sockets[0].options, {
    url: 'wss://jianshuo.dev/agent/command',
    header: { Authorization: 'Bearer test-token', 'X-VD-Platform': 'miniapp' }
  })
})

function timerHarness() {
  const timers = []
  return {
    timers,
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true
    }
  }
}

test('status socket retries silently after the iOS-compatible delay', () => {
  const socket = socketHarness()
  const timer = timerHarness()
  const errors = []
  const session = statusSession.createSession({ onError: (message) => errors.push(message) }, {
    wx: socket.wx,
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  })

  session.connect()
  socket.sockets[0].callbacks.error({ errMsg: 'Connection refused' })

  assert.deepEqual(errors, [])
  assert.equal(timer.timers.length, 1)
  assert.equal(timer.timers[0].delay, 3000)
  timer.timers[0].callback()
  assert.equal(socket.sockets.length, 2)
})

test('status socket close cancels a pending retry', () => {
  const socket = socketHarness()
  const timer = timerHarness()
  const session = statusSession.createSession({}, {
    wx: socket.wx,
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  })

  session.connect()
  socket.sockets[0].callbacks.error({ errMsg: 'Connection refused' })
  session.close()
  timer.timers[0].callback()

  assert.equal(timer.timers[0].cleared, true)
  assert.equal(socket.sockets.length, 1)
})

test('status socket ignores messages from a stale connection', () => {
  const socket = socketHarness()
  const timer = timerHarness()
  const phases = []
  const session = statusSession.createSession({ onPhase: (phase) => phases.push(phase) }, {
    wx: socket.wx,
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  })

  session.connect()
  socket.sockets[0].callbacks.error({ errMsg: 'Connection refused' })
  timer.timers[0].callback()
  socket.sockets[0].callbacks.message({ data: JSON.stringify({ type: 'status_update', stem: 'a', status: 'mining' }) })

  assert.deepEqual(phases, [])
})

test('library command socket reconnects and resends its persisted queue', () => {
  const socket = socketHarness()
  const timer = timerHarness()
  const errors = []
  const session = libraryCommand.createSession({ onError: (message) => errors.push(message) }, {
    wx: socket.wx,
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  })

  session.connect()
  session.enqueue('分享第 1 篇', [{ n: 1, stem: 'a', title: 'A' }])
  socket.sockets[0].callbacks.open()
  assert.equal(socket.sockets[0].sent.length, 1)
  socket.sockets[0].callbacks.message({ data: JSON.stringify({ type: 'snapshot', queue: [] }) })

  socket.sockets[0].callbacks.error({ errMsg: 'Connection refused' })
  assert.deepEqual(errors, [])
  const reconnect = timer.timers.find((item) => item.delay === 1500 && !item.cleared)
  assert.ok(reconnect)

  reconnect.callback()
  socket.sockets[1].callbacks.open()
  assert.equal(socket.sockets[1].sent.length, 1)
  socket.sockets[1].callbacks.message({ data: JSON.stringify({ type: 'snapshot', queue: [] }) })
  assert.equal(JSON.parse(socket.sockets[1].sent[0].data).text, '分享第 1 篇')
})

test('library command enqueue opens a socket when the page session is not connected yet', () => {
  const socket = socketHarness()
  const session = libraryCommand.createSession({}, directAuthRuntime(socket.wx))

  session.enqueue('处理第一篇', [{ n: 1, stem: 'a', title: 'A' }])

  assert.equal(socket.sockets.length, 1)
  socket.sockets[0].callbacks.open()
  assert.equal(socket.sockets[0].sent.length, 1)
  assert.equal(JSON.parse(socket.sockets[0].sent[0].data).text, '处理第一篇')
})

test('library command traces transport stages without exposing command text', () => {
  const socket = socketHarness()
  const traces = []
  const session = libraryCommand.createSession({
    onTrace(stage, details) { traces.push([stage, details]) }
  }, directAuthRuntime(socket.wx))

  session.enqueue('这是不能出现在日志里的正文', [{ n: 1, stem: 'a', title: 'A' }])
  socket.sockets[0].callbacks.open()
  socket.sockets[0].callbacks.message({ data: JSON.stringify({ type: 'status', state: 'working', id: 'server-id' }) })

  assert.deepEqual(traces.map(([stage]) => stage), ['enqueue', 'connect', 'open', 'send', 'receive'])
  assert.equal(JSON.stringify(traces).includes('这是不能出现在日志里的正文'), false)
  assert.equal(traces[3][1].refCount, 1)
  assert.equal(traces[4][1].type, 'status')
})

test('library command restores each queued request with its original refs', () => {
  const storage = {}
  const first = socketHarness(storage)
  const firstSession = libraryCommand.createSession({}, directAuthRuntime(first.wx))
  firstSession.connect()
  firstSession.enqueue('删除第二篇', [{ n: 2, stem: 'original', title: '原文章' }])
  firstSession.close()

  const second = socketHarness(storage)
  const secondSession = libraryCommand.createSession({}, directAuthRuntime(second.wx))
  secondSession.setRefs([{ n: 2, stem: 'changed', title: '新文章' }])
  secondSession.connect()
  second.sockets[0].callbacks.open()
  second.sockets[0].callbacks.message({ data: JSON.stringify({ type: 'snapshot', queue: [] }) })

  assert.equal(second.sockets[0].sent.length, 2)
  second.sockets[0].sent.forEach((message) => {
    assert.deepEqual(JSON.parse(message.data).refs, [
      { n: 2, stem: 'original', title: '原文章' }
    ])
  })
})

test('library command enqueue uses refs previously supplied through setRefs', () => {
  const socket = socketHarness()
  const session = libraryCommand.createSession({}, directAuthRuntime(socket.wx))
  session.setRefs([{ n: 1, stem: 'set-ref', title: '预设文章' }])

  session.enqueue('处理第一篇')

  assert.deepEqual(session.queue()[0].refs, [
    { n: 1, stem: 'set-ref', title: '预设文章' }
  ])
})

test('library command reconnects when an async SocketTask send fails', () => {
  const socket = socketHarness()
  const timer = timerHarness()
  const session = libraryCommand.createSession({}, directAuthRuntime(socket.wx, {
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  }))
  session.connect()
  socket.sockets[0].callbacks.open()
  socket.sockets[0].callbacks.message({ data: JSON.stringify({ type: 'snapshot', queue: [] }) })
  session.enqueue('处理第一篇', [{ n: 1, stem: 'a', title: 'A' }])

  assert.equal(typeof socket.sockets[0].sent[0].fail, 'function')
  socket.sockets[0].sent[0].fail({ errMsg: 'send:fail socket closed' })

  assert.ok(timer.timers.some((item) => item.delay === 1500 && !item.cleared))
})

test('library command reconciles its queue against the server snapshot before resending', () => {
  const socket = socketHarness()
  const session = libraryCommand.createSession({}, directAuthRuntime(socket.wx))
  session.connect()
  session.enqueue('已完成', [{ n: 1, stem: 'done', title: '完成' }])
  session.enqueue('已失败', [{ n: 2, stem: 'error', title: '失败' }])
  session.enqueue('执行中', [{ n: 3, stem: 'running', title: '执行中' }])
  session.enqueue('未送达', [{ n: 4, stem: 'unknown', title: '未送达' }])
  const [done, failed, running, unknown] = session.queue()

  socket.sockets[0].callbacks.open()
  assert.equal(socket.sockets[0].sent.length, 4)

  socket.sockets[0].callbacks.message({
    data: JSON.stringify({
      type: 'snapshot',
      queue: [
        { id: done.id, status: 'done' },
        { id: failed.id, status: 'error' },
        { id: running.id, status: 'running' }
      ]
    })
  })

  assert.deepEqual(session.queue().map((item) => item.id), [running.id, unknown.id])
  assert.equal(socket.sockets[0].sent.length, 5)
  assert.deepEqual(JSON.parse(socket.sockets[0].sent[4].data).refs, unknown.refs)
})

test('library command drops persisted controls for commands already terminal on the server', () => {
  const storage = {
    'voicedrop.commandqueue.default': JSON.stringify([
      { id: 'cmd-done', text: '删除文章2', refs: [{ n: 2, stem: 'done', title: '文章2' }] }
    ]),
    'voicedrop.commandcontrols.default': JSON.stringify([
      { type: 'confirm', id: 'cmd-done' }
    ]),
    'voicedrop.commandconfirms.default': JSON.stringify([
      { id: 'cmd-done', text: '确认删除文章2？' }
    ])
  }
  const socket = socketHarness(storage)
  const session = libraryCommand.createSession({}, directAuthRuntime(socket.wx))

  session.connect()
  socket.sockets[0].callbacks.open()
  socket.sockets[0].callbacks.message({
    data: JSON.stringify({ type: 'snapshot', queue: [{ id: 'cmd-done', status: 'done' }] })
  })

  assert.equal(socket.sockets[0].sent.length, 1)
  assert.equal(JSON.parse(socket.sockets[0].sent[0].data).type, 'instruct')
  assert.equal(storage['voicedrop.commandcontrols.default'], undefined)
  assert.equal(storage['voicedrop.commandconfirms.default'], undefined)
})

test('library command close cancels a pending retry', () => {
  const socket = socketHarness()
  const timer = timerHarness()
  const session = libraryCommand.createSession({}, {
    wx: socket.wx,
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  })

  session.connect()
  socket.sockets[0].callbacks.close({ code: 1006 })
  session.close()
  timer.timers[0].callback()

  assert.equal(timer.timers[0].cleared, true)
  assert.equal(socket.sockets.length, 1)
})

test('library command ignores malformed transport messages', () => {
  const socket = socketHarness()
  const errors = []
  const session = libraryCommand.createSession({ onError: (message) => errors.push(message) }, { wx: socket.wx })

  session.connect()
  socket.sockets[0].callbacks.message({ data: 'not-json' })

  assert.deepEqual(errors, [])
})

test('library command still surfaces explicit server business errors', () => {
  const socket = socketHarness()
  const errors = []
  const session = libraryCommand.createSession({ onError: (message) => errors.push(message) }, { wx: socket.wx })

  session.connect()
  socket.sockets[0].callbacks.message({ data: JSON.stringify({ type: 'error', message: '指令执行失败' }) })

  assert.deepEqual(errors, ['指令执行失败'])
})

test('library command resolves a canceled request from its server reply', () => {
  const socket = socketHarness()
  const replies = []
  const session = libraryCommand.createSession({ onReply: (text, ok) => replies.push([text, ok]) }, { wx: socket.wx })

  session.connect()
  session.enqueue('删除文章2', [{ n: 2, stem: 'a', title: '文章2' }])
  const id = session.queue()[0].id
  socket.sockets[0].callbacks.message({ data: JSON.stringify({ type: 'reply', id, text: '已取消', ok: true }) })

  assert.deepEqual(replies, [['已取消', true]])
  assert.deepEqual(session.queue(), [])
})

test('library command refreshes updated stems and resolves the matching request', () => {
  const socket = socketHarness()
  const updates = []
  const session = libraryCommand.createSession({ onUpdate: (stems) => updates.push(stems) }, { wx: socket.wx })

  session.connect()
  session.enqueue('给第一篇加标签', [{ n: 1, stem: 'a', title: '文章1' }])
  const id = session.queue()[0].id
  socket.sockets[0].callbacks.message({
    data: JSON.stringify({ type: 'updated', id, stems: ['a'] })
  })

  assert.deepEqual(updates, [['a']])
  assert.deepEqual(session.queue(), [])
})

test('library command uses the queue head for old-server terminal messages without ids', () => {
  const socket = socketHarness()
  const errors = []
  const session = libraryCommand.createSession({ onError: (message) => errors.push(message) }, { wx: socket.wx })

  session.connect()
  session.enqueue('旧服务端请求', [{ n: 1, stem: 'a', title: '文章1' }])
  socket.sockets[0].callbacks.message({
    data: JSON.stringify({ type: 'error', message: '旧服务端失败' })
  })

  assert.deepEqual(errors, ['旧服务端失败'])
  assert.deepEqual(session.queue(), [])
})

test('library command forwards the server confirmation summary', () => {
  const socket = socketHarness()
  const confirmations = []
  const session = libraryCommand.createSession({
    onConfirm: (id, text) => confirmations.push([id, text])
  }, { wx: socket.wx })

  session.connect()
  socket.sockets[0].callbacks.message({
    data: JSON.stringify({ type: 'confirm', id: 'cmd-1', summary: '要删掉《文章2》吗？' })
  })

  assert.deepEqual(confirmations, [['cmd-1', '要删掉《文章2》吗？']])
})

test('library command falls back through confirmation text and message fields', () => {
  const socket = socketHarness()
  const confirmations = []
  const session = libraryCommand.createSession({
    onConfirm: (id, text) => confirmations.push([id, text])
  }, { wx: socket.wx })

  session.connect()
  socket.sockets[0].callbacks.message({
    data: JSON.stringify({ type: 'confirm', id: 'cmd-text', text: '确认文本' })
  })
  socket.sockets[0].callbacks.message({
    data: JSON.stringify({ type: 'confirm', id: 'cmd-message', message: '确认消息' })
  })

  assert.deepEqual(confirmations, [
    ['cmd-text', '确认文本'],
    ['cmd-message', '确认消息']
  ])
})

test('library command retries a destructive choice after reconnect', () => {
  const socket = socketHarness()
  const timer = timerHarness()
  const session = libraryCommand.createSession({}, {
    wx: socket.wx,
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  })

  session.connect()
  socket.sockets[0].callbacks.error({ errMsg: 'Connection refused' })
  session.confirm('cmd-1')
  assert.equal(socket.sockets[0].sent.length, 0)

  timer.timers.find((item) => item.delay === 1500 && !item.cleared).callback()
  socket.sockets[1].callbacks.open()
  socket.sockets[1].callbacks.message({ data: JSON.stringify({ type: 'snapshot', queue: [] }) })

  assert.deepEqual(JSON.parse(socket.sockets[1].sent[0].data), { type: 'confirm', id: 'cmd-1' })
})

test('library command restores a destructive choice after session recreation', () => {
  const storage = {}
  const first = socketHarness(storage)
  const firstSession = libraryCommand.createSession({}, { wx: first.wx })
  firstSession.connect()
  first.sockets[0].callbacks.open()
  firstSession.cancel('cmd-2')
  firstSession.close()

  const second = socketHarness(storage)
  const secondSession = libraryCommand.createSession({}, { wx: second.wx })
  secondSession.connect()
  second.sockets[0].callbacks.open()
  second.sockets[0].callbacks.message({ data: JSON.stringify({ type: 'snapshot', queue: [] }) })

  assert.deepEqual(JSON.parse(second.sockets[0].sent[0].data), { type: 'cancel', id: 'cmd-2' })
})

test('library command restores an unanswered confirmation after session recreation', () => {
  const storage = {}
  const first = socketHarness(storage)
  const firstSession = libraryCommand.createSession({}, { wx: first.wx })
  firstSession.connect()
  first.sockets[0].callbacks.message({
    data: JSON.stringify({ type: 'confirm', id: 'cmd-3', summary: '要删掉《文章3》吗？' })
  })
  firstSession.close()

  const confirmations = []
  const second = socketHarness(storage)
  const secondSession = libraryCommand.createSession({
    onConfirm: (id, text) => confirmations.push([id, text])
  }, { wx: second.wx })
  secondSession.connect()

  assert.deepEqual(confirmations, [['cmd-3', '要删掉《文章3》吗？']])
})

test('library command ignores a repeated confirmation after the user has chosen', () => {
  const socket = socketHarness()
  const confirmations = []
  const session = libraryCommand.createSession({
    onConfirm: (id, text) => confirmations.push([id, text])
  }, { wx: socket.wx })

  session.connect()
  const message = {
    data: JSON.stringify({ type: 'confirm', id: 'cmd-4', summary: '要删掉《文章4》吗？' })
  }
  socket.sockets[0].callbacks.message(message)
  session.confirm('cmd-4')
  socket.sockets[0].callbacks.message(message)

  assert.deepEqual(confirmations, [['cmd-4', '要删掉《文章4》吗？']])
})

test('library command ignores messages from a stale connection', () => {
  const socket = socketHarness()
  const timer = timerHarness()
  const errors = []
  const session = libraryCommand.createSession({ onError: (message) => errors.push(message) }, {
    wx: socket.wx,
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  })

  session.connect()
  socket.sockets[0].callbacks.error({ errMsg: 'Connection refused' })
  timer.timers[0].callback()
  socket.sockets[0].callbacks.message({ data: JSON.stringify({ type: 'error', message: '旧连接错误' }) })

  assert.deepEqual(errors, [])
})
