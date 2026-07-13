const test = require('node:test')
const assert = require('node:assert/strict')
const playerModule = require('../services/realtime-audio-player')

test('converts PCM16 to float audio and schedules deltas in order', () => {
  const starts = []
  const scheduled = []
  const buffers = []
  const ctx = {
    currentTime: 5,
    destination: {},
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length)
      const buffer = { channels, length, sampleRate, getChannelData: () => data, data }
      buffers.push(buffer)
      return buffer
    },
    createBufferSource() {
      return { connect() {}, start: (when) => starts.push(when), stop() {} }
    },
    close() {}
  }
  const player = playerModule.createPlayer({
    onScheduled: (data, delayMs) => scheduled.push({ data, delayMs })
  }, { wx: { createWebAudioContext: () => ctx } })
  const pcm = new ArrayBuffer(4)
  const view = new DataView(pcm)
  view.setInt16(0, 32767, true)
  view.setInt16(2, -32768, true)
  player.enqueue(pcm)
  player.enqueue(pcm)
  assert.deepEqual(starts, [5, 5 + 2 / 24000])
  assert.equal(scheduled.length, 2)
  assert.equal(scheduled[0].data, pcm)
  assert.equal(scheduled[0].delayMs, 0)
  assert.ok(scheduled[1].delayMs > 0)
  assert.equal(buffers[0].channels, 1)
  assert.equal(buffers[0].length, 2)
  assert.equal(buffers[0].sampleRate, 24000)
  assert.ok(buffers[0].data[0] > 0.99)
  assert.equal(buffers[0].data[1], -1)
})

test('reports drain only after every scheduled source ends', () => {
  const sources = []
  let drained = 0
  const ctx = {
    currentTime: 0,
    destination: {},
    createBuffer: (_c, length) => ({ length, getChannelData: () => new Float32Array(length) }),
    createBufferSource() {
      const source = { connect() {}, start() {}, stop() {} }
      sources.push(source)
      return source
    },
    close() {}
  }
  const player = playerModule.createPlayer({ onDrain: () => { drained += 1 } }, { wx: { createWebAudioContext: () => ctx } })
  player.enqueue(new ArrayBuffer(4))
  player.enqueue(new ArrayBuffer(4))
  sources[0].onended()
  assert.equal(drained, 0)
  sources[1].onended()
  assert.equal(drained, 1)
})

test('stop halts scheduled sources, closes the context, and makes the player idle', () => {
  const sources = []
  let closed = 0
  const ctx = {
    currentTime: 0,
    destination: {},
    createBuffer: (_c, length) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource() {
      const source = { connect() {}, start() {}, stopped: 0, stop() { this.stopped += 1 } }
      sources.push(source)
      return source
    },
    close() { closed += 1 }
  }
  const player = playerModule.createPlayer({}, { wx: { createWebAudioContext: () => ctx } })
  player.enqueue(new ArrayBuffer(4))
  player.enqueue(new ArrayBuffer(4))
  assert.equal(player.isIdle(), false)

  player.stop()

  assert.deepEqual(sources.map((source) => source.stopped), [1, 1])
  assert.equal(closed, 1)
  assert.equal(player.isIdle(), true)
})

test('reports an error and rejects enqueue when WebAudio is unavailable', () => {
  const errors = []
  const player = playerModule.createPlayer({ onError: (message) => errors.push(message) }, { wx: {} })

  assert.equal(player.enqueue(new ArrayBuffer(4)), false)
  assert.deepEqual(errors, ['当前微信版本不支持 AI 语音播放'])
  assert.equal(player.isIdle(), true)
})

test('prepare eagerly creates and resumes the WebAudio context during the user gesture', () => {
  let resumed = 0
  const ctx = {
    state: 'suspended',
    currentTime: 0,
    resume() { resumed += 1; this.state = 'running'; return Promise.resolve() },
    close() {}
  }
  const player = playerModule.createPlayer({}, { wx: { createWebAudioContext: () => ctx } })

  assert.equal(player.prepare(), true)
  assert.equal(resumed, 1)
})

test('ignores ended callbacks from sources invalidated by stop', () => {
  const sources = []
  let drained = 0
  const ctx = {
    currentTime: 0,
    destination: {},
    createBuffer: (_c, length) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource() {
      const source = { connect() {}, start() {}, stop() {} }
      sources.push(source)
      return source
    },
    close() {}
  }
  const player = playerModule.createPlayer({ onDrain: () => { drained += 1 } }, { wx: { createWebAudioContext: () => ctx } })
  player.enqueue(new ArrayBuffer(4))
  player.enqueue(new ArrayBuffer(4))
  const endedCallbacks = sources.map((source) => source.onended)

  player.stop()
  endedCallbacks.forEach((onended) => onended())

  assert.equal(drained, 0)
})

test('isolates WebAudio context creation failures', () => {
  const errors = []
  const player = playerModule.createPlayer({ onError: (error) => errors.push(error) }, {
    wx: { createWebAudioContext() { throw new Error('context failed') } }
  })

  let result
  assert.doesNotThrow(() => { result = player.enqueue(new ArrayBuffer(4)) })
  assert.equal(result, false)
  assert.equal(player.isIdle(), true)
  assert.equal(errors.length, 1)
})

for (const stage of ['createBuffer', 'getChannelData', 'createBufferSource', 'connect', 'start']) {
  test(`isolates ${stage} failures and resets playback state`, () => {
    const errors = []
    const sources = []
    let closed = 0
    const ctx = {
      currentTime: 3,
      destination: {},
      createBuffer(_channels, length) {
        if (stage === 'createBuffer') throw new Error(stage)
        return {
          getChannelData() {
            if (stage === 'getChannelData') throw new Error(stage)
            return new Float32Array(length)
          }
        }
      },
      createBufferSource() {
        if (stage === 'createBufferSource') throw new Error(stage)
        const source = {
          stopped: 0,
          connect() { if (stage === 'connect') throw new Error(stage) },
          start() { if (stage === 'start') throw new Error(stage) },
          stop() { this.stopped += 1 }
        }
        sources.push(source)
        return source
      },
      close() { closed += 1 }
    }
    const player = playerModule.createPlayer({ onError: (error) => errors.push(error) }, {
      wx: { createWebAudioContext: () => ctx }
    })

    let result
    assert.doesNotThrow(() => { result = player.enqueue(new ArrayBuffer(4)) })
    assert.equal(result, false)
    assert.equal(player.isIdle(), true)
    assert.equal(closed, 1)
    assert.equal(errors.length, 1)
    if (stage === 'connect' || stage === 'start') assert.equal(sources[0].stopped, 1)
  })
}

test('a start failure stops older and current sources and invalidates their ended callbacks', () => {
  const errors = []
  const sources = []
  let starts = 0
  let drained = 0
  let closed = 0
  const ctx = {
    currentTime: 0,
    destination: {},
    createBuffer: (_channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource() {
      const source = {
        stopped: 0,
        connect() {},
        start() { starts += 1; if (starts === 2) throw new Error('second start failed') },
        stop() { this.stopped += 1 }
      }
      sources.push(source)
      return source
    },
    close() { closed += 1 }
  }
  const player = playerModule.createPlayer({
    onDrain: () => { drained += 1 },
    onError: (error) => errors.push(error)
  }, { wx: { createWebAudioContext: () => ctx } })

  assert.equal(player.enqueue(new ArrayBuffer(4)), true)
  const staleEnded = sources[0].onended
  assert.equal(player.enqueue(new ArrayBuffer(4)), false)
  assert.deepEqual(sources.map((source) => source.stopped), [1, 1])
  assert.equal(closed, 1)
  assert.equal(errors.length, 1)
  assert.equal(player.isIdle(), true)

  staleEnded()
  assert.equal(drained, 0)
})
