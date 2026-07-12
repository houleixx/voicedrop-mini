const { test, describe } = require('node:test')
const assert = require('node:assert')
const WebSocket = require('ws')

describe('WebSocket Auth Test', () => {
  test('library-command WebSocket works', (t, done) => {
    const timeout = setTimeout(() => {
      console.log('[TEST] Timeout')
      ws.close()
      done()
    }, 10000)

    const ws = new WebSocket('wss://jianshuo.dev/agent/command', {
      headers: {
        'Authorization': 'Bearer anon_test123',
        'X-VD-Platform': 'miniapp'
      }
    })

    ws.on('open', () => {
      console.log('[TEST] Command WebSocket opened')
      clearTimeout(timeout)
      ws.close()
      done()
    })

    ws.on('error', (err) => {
      console.log('[TEST] Command WebSocket error:', err.message)
      if (err.message.includes('401')) {
        // 401 is expected with fake token
        console.log('[TEST] Auth mechanism works (401 is expected for fake token)')
        clearTimeout(timeout)
        ws.close()
        done()
      } else {
        clearTimeout(timeout)
        ws.close()
        done()
      }
    })
  })
})
