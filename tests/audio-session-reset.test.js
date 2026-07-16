const test = require('node:test')
const assert = require('node:assert/strict')

const audioSessionReset = require('../utils/audio-session-reset')

test('audio session reset builds a short valid silent PCM WAV', () => {
  const buffer = audioSessionReset.silentWav(50)
  const bytes = new Uint8Array(buffer)
  const text = (offset, length) => String.fromCharCode(...bytes.slice(offset, offset + length))

  assert.equal(text(0, 4), 'RIFF')
  assert.equal(text(8, 4), 'WAVE')
  assert.equal(text(36, 4), 'data')
  assert.ok(bytes.length > 44)
  assert.ok(bytes.slice(44).every((value) => value === 0))
})

test('audio session reset silently opens and disposes a local playback context', async () => {
  const events = []
  let ended
  const player = {
    onEnded(callback) { ended = callback },
    onError() {},
    play() { events.push('play'); ended() },
    destroy() { events.push('destroy') }
  }
  const wxApi = {
    env: { USER_DATA_PATH: '/user' },
    getFileSystemManager: () => ({
      writeFileSync(path, data) {
        events.push(['write', path, data.byteLength])
      }
    }),
    setInnerAudioOption(options) {
      events.push(['route', options.speakerOn, options.mixWithOther])
    },
    createInnerAudioContext() {
      events.push('create')
      return player
    }
  }
  const timers = []

  await audioSessionReset.resetAfterRecording(wxApi, {
    setTimeout(callback) { timers.push(callback); return timers.length },
    clearTimeout() { events.push('clear-timeout') }
  })

  assert.deepEqual(events, [
    ['write', '/user/voicedrop-audio-session-reset.wav', 844],
    ['route', false, true],
    'create',
    'play',
    'clear-timeout',
    'destroy'
  ])
  assert.equal(player.volume, 0)
  assert.equal(player.loop, false)
  assert.equal(player.src, '/user/voicedrop-audio-session-reset.wav')
})

test('audio session reset restores the speaker only for explicit playback', () => {
  const routes = []
  audioSessionReset.preparePlayback({
    setInnerAudioOption(options) {
      routes.push([options.speakerOn, options.mixWithOther])
    }
  })

  assert.deepEqual(routes, [[true, false]])
})
