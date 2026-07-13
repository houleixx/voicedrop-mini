const test = require('node:test')
const assert = require('node:assert/strict')
const interviewerModule = require('../services/realtime-interviewer')

function harness(extraHandlers) {
  const timers = []
  const session = {
    connectCount: 0,
    disconnectCount: 0,
    clearCount: 0,
    sent: [],
    connect() { this.connectCount += 1 },
    disconnect() { this.disconnectCount += 1 },
    clearInputBuffer() { this.clearCount += 1 },
    appendAudio(data) { this.sent.push(data) }
  }
  const player = {
    queued: [],
    idle: true,
    enqueue(data) { this.queued.push(data); this.idle = false; return true },
    prepareCount: 0,
    prepare() { this.prepareCount += 1; return true },
    stopCount: 0,
    stop() { this.stopCount += 1; this.idle = true },
    isIdle() { return this.idle }
  }
  let callbacks
  const deps = {
    createSession(next) { callbacks = next; return session },
    createPlayer(next) {
      player.onDrain = next.onDrain
      player.onError = next.onError
      player.onScheduled = next.onScheduled
      return player
    },
    pcm16ToPcmu8k: () => new Uint8Array([9]),
    setTimeout(fn, delay) {
      const timer = { fn, delay, canceled: false }
      timers.push(timer)
      return timer
    },
    clearTimeout(timer) { if (timer) timer.canceled = true }
  }
  const states = []
  const interviewer = interviewerModule.createInterviewer(Object.assign({ onChange: (state) => states.push(state) }, extraHandlers || {}), deps)
  return { interviewer, session, player, callbacks: () => callbacks, timers, states }
}

test('toggle only controls the interview side-path', () => {
  const h = harness()
  h.interviewer.toggle()
  assert.equal(h.interviewer.active(), true)
  assert.equal(h.session.connectCount, 1)
  assert.equal(h.player.prepareCount, 1)
  h.interviewer.toggle()
  assert.equal(h.interviewer.active(), false)
  assert.equal(h.session.disconnectCount, 1)
})

test('forwards the AI audio playback timeline for final recording mixdown', () => {
  const scheduled = []
  const h = harness({ onAiAudio: (data, delayMs) => scheduled.push({ data, delayMs }) })
  const audio = new Uint8Array([1, 2, 3, 4])

  h.player.onScheduled(audio, 125)

  assert.deepEqual(scheduled, [{ data: audio, delayMs: 125 }])
})

test('playback failure does not report the live relay as disconnected', () => {
  const h = harness()
  h.interviewer.start()
  h.callbacks().onState('live')

  h.player.onError('audio unavailable')

  assert.equal(h.interviewer.state().state, 'live')
  assert.doesNotMatch(h.interviewer.stateText(), /AI 已断开/)
  assert.match(h.interviewer.stateText(), /语音播放异常/)
})

test('keeps the first reconnect delay unchanged', () => {
  const h = harness()
  h.interviewer.start()

  h.callbacks().onState('degraded')

  assert.equal(h.timers.at(-1).delay, 1000)
})

test('mutes uplink while AI speaks and resumes after done, drain, and 500ms', () => {
  const h = harness()
  h.interviewer.start()
  h.interviewer.onPcm16(new ArrayBuffer(2), 16000)
  assert.equal(h.session.sent.length, 1)

  h.callbacks().onAudioDelta(new Uint8Array([1, 0]))
  h.interviewer.onPcm16(new ArrayBuffer(2), 16000)
  assert.equal(h.session.sent.length, 1)

  h.callbacks().onResponseDone()
  assert.equal(h.timers.some((timer) => timer.delay === 500), false)
  h.player.idle = true
  h.player.onDrain()
  const tail = h.timers.find((timer) => timer.delay === 500)
  assert.ok(tail)
  tail.fn()

  assert.equal(h.session.clearCount, 1)
  h.interviewer.onPcm16(new ArrayBuffer(2), 16000)
  assert.equal(h.session.sent.length, 2)
})

test('15 second watchdog releases a stuck AI speaking mute', () => {
  const h = harness()
  h.interviewer.start()
  h.callbacks().onResponseCreated()
  assert.equal(h.interviewer.state().muted, true)

  const watchdog = h.timers.find((timer) => timer.delay === 15000)
  assert.ok(watchdog)
  watchdog.fn()

  assert.equal(h.interviewer.state().muted, false)
  assert.equal(h.session.clearCount, 1)
  h.interviewer.onPcm16(new ArrayBuffer(2), 16000)
  assert.equal(h.session.sent.length, 1)
})

test('reconnects with six Android-compatible exponential delays', () => {
  const h = harness()
  h.interviewer.start()
  for (const expected of [1000, 2000, 4000, 8000, 16000, 32000]) {
    h.callbacks().onState('degraded')
    const timer = h.timers.at(-1)
    assert.equal(timer.delay, expected)
    timer.fn()
  }
  h.callbacks().onState('degraded')
  assert.equal(h.timers.filter((timer) => [1000, 2000, 4000, 8000, 16000, 32000].includes(timer.delay)).length, 6)
  assert.equal(h.session.connectCount, 7)
  assert.equal(h.session.disconnectCount, 6)
})

test('a live connection resets reconnect backoff', () => {
  const h = harness()
  h.interviewer.start()
  h.callbacks().onState('degraded')
  h.timers.at(-1).fn()
  h.callbacks().onState('degraded')
  h.timers.at(-1).fn()

  h.callbacks().onState('live')
  h.callbacks().onState('degraded')

  assert.equal(h.timers.at(-1).delay, 1000)
})

test('reconnect clears a mute left behind by the failed AI turn', () => {
  const h = harness()
  h.interviewer.start()
  h.callbacks().onResponseCreated()
  assert.equal(h.interviewer.state().muted, true)

  h.callbacks().onState('degraded')
  h.timers.find((timer) => timer.delay === 1000).fn()

  assert.equal(h.interviewer.state().muted, false)
  assert.equal(h.session.disconnectCount, 1)
  assert.equal(h.session.connectCount, 2)
})

test('stop clears reconnect, resume-tail, and watchdog timers', () => {
  const h = harness()
  h.interviewer.start()
  h.callbacks().onState('degraded')
  const reconnect = h.timers.at(-1)
  h.callbacks().onResponseCreated()
  const watchdog = h.timers.at(-1)
  h.callbacks().onResponseDone()
  h.player.idle = true
  h.player.onDrain()
  const tail = h.timers.at(-1)

  h.interviewer.stop()

  assert.equal(reconnect.canceled, true)
  assert.equal(watchdog.canceled, true)
  assert.equal(tail.canceled, true)
  assert.equal(h.player.stopCount, 1)
  assert.equal(h.session.disconnectCount, 1)
  assert.deepEqual(h.interviewer.state(), { active: false, state: 'idle', muted: false, stateText: '' })
})
