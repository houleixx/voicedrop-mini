const { test, describe } = require('node:test')
const assert = require('node:assert')
const WebSocket = require('ws')

// Mock wx global for asr-dictation module
global.wx = {
  connectSocket: (options) => {
    console.log('[TEST] Connecting to:', options.url)
    const socket = new WebSocket(options.url)

    return {
      onOpen: (cb) => socket.on('open', () => {
        console.log('[TEST] WebSocket opened')
        cb()
      }),
      onMessage: (cb) => socket.on('message', (data) => {
        console.log('[TEST] Received message:', data.length, 'bytes')
        cb({ data })
      }),
      onError: (cb) => socket.on('error', (err) => {
        console.log('[TEST] WebSocket error:', err.message)
        cb(err)
      }),
      onClose: (cb) => socket.on('close', (code, reason) => {
        console.log('[TEST] WebSocket closed:', code, reason.toString())
        cb({ code, reason })
      }),
      send: (opts) => {
        console.log('[TEST] Sending', opts.data.byteLength, 'bytes')
        socket.send(opts.data)
      },
      close: (opts) => socket.close(opts?.code || 1000, opts?.reason || '')
    }
  },
  getStorageSync: () => 'anon_test123',
  setStorageSync: () => {},
  removeStorageSync: () => {}
}

const asrDictation = require('../services/asr-dictation')

describe('ASR WebSocket Connection Debug', () => {
  test('detailed connection test', (t, done) => {
    const timeout = setTimeout(() => {
      console.log('[TEST] Timeout reached')
      session.close()
      done()
    }, 15000)

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
        // Don't clear timeout - let onClose provide more info
      }
    })

    session.connect()
  })
})
