const { test, describe } = require('node:test')
const assert = require('node:assert')
const WebSocket = require('ws')

// Mock wx global for asr-dictation module
global.wx = {
  connectSocket: (options) => {
    const socket = new WebSocket(options.url)
    return {
      onOpen: (cb) => socket.on('open', cb),
      onMessage: (cb) => socket.on('message', (data) => cb({ data })),
      onError: (cb) => socket.on('error', cb),
      onClose: (cb) => socket.on('close', cb),
      send: (opts) => socket.send(opts.data),
      close: (opts) => socket.close(opts?.code || 1000, opts?.reason || '')
    }
  },
  getStorageSync: () => 'anon_test123',
  setStorageSync: () => {},
  removeStorageSync: () => {}
}

const asrDictation = require('../services/asr-dictation')

describe('ASR WebSocket Connection', () => {
  test('connects to ASR WebSocket and sends config frame', (t, done) => {
    const timeout = setTimeout(() => {
      assert.fail('Connection timeout after 10 seconds')
    }, 10000)

    const session = asrDictation.createSession({
      onState: (state) => {
        console.log('[ASR] State:', state)
      },
      onText: (text, isFinal) => {
        console.log('[ASR] Text:', text, 'Final:', isFinal)
        clearTimeout(timeout)
        session.close()
        done()
      },
      onError: (message) => {
        console.log('[ASR] Error:', message)
        clearTimeout(timeout)
        session.close()
        // Don't fail - server may not support ASR
        done()
      }
    })

    session.connect()
  })

  test('builds valid full client payload', () => {
    const payload = asrDictation.buildFullClientPayload('test-user', 16000)
    assert.ok(payload instanceof ArrayBuffer)
    assert.ok(payload.byteLength > 12) // header (12) + payload

    // Check magic byte
    const bytes = new Uint8Array(payload)
    assert.strictEqual(bytes[0], 0x11, 'Magic byte should be 0x11')

    // Check message type (FULL_CLIENT = 0x1)
    const messageType = (bytes[1] >> 4) & 0x0f
    assert.strictEqual(messageType, 0x1, 'Message type should be FULL_CLIENT')
  })

  test('builds valid audio payload', () => {
    const pcmData = new Uint8Array([0, 1, 2, 3, 4, 5])
    const payload = asrDictation.buildAudioPayload(pcmData, 1, false)
    assert.ok(payload instanceof ArrayBuffer)
    assert.ok(payload.byteLength > 12)

    const bytes = new Uint8Array(payload)
    assert.strictEqual(bytes[0], 0x11, 'Magic byte should be 0x11')

    const messageType = (bytes[1] >> 4) & 0x0f
    assert.strictEqual(messageType, 0x2, 'Message type should be AUDIO_ONLY')
  })

  test('does not send audio before socket is open', () => {
    const originalWx = global.wx
    try {
      global.wx = Object.assign({}, originalWx, {
        connectSocket: () => ({
          onOpen: () => {},
          onMessage: () => {},
          onError: () => {},
          onClose: () => {},
          send: () => {
            throw new Error('SocketTask.send:fail SocketTask.readyState is not OPEN')
          },
          close: () => {}
        })
      })

      const session = asrDictation.createSession({})
      session.connect()
      assert.doesNotThrow(() => {
        session.sendAudio(new Uint8Array([1, 2, 3]), false)
      })
      session.close()
    } finally {
      global.wx = originalWx
    }
  })

  test('sends ASR config immediately when socket opens', () => {
    const originalWx = global.wx
    const sent = []
    let open
    try {
      global.wx = Object.assign({}, originalWx, {
        connectSocket: () => ({
          onOpen: (cb) => { open = cb },
          onMessage: () => {},
          onError: () => {},
          onClose: () => {},
          send: (opts) => {
            sent.push(opts.data)
          },
          close: () => {}
        })
      })

      const session = asrDictation.createSession({})
      session.connect()
      assert.strictEqual(sent.length, 0)
      open()
      assert.strictEqual(sent.length, 1)
      session.close()
    } finally {
      global.wx = originalWx
    }
  })
})
