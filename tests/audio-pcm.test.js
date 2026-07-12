const test = require('node:test')
const assert = require('node:assert/strict')

function loadAudio() {
  const storage = { 'voicedrop.auth.anon': 'anon_audio_test' }
  const recorderStarts = []
  const requests = []
  const fileData = new Uint8Array([1, 2, 3]).buffer
  global.wx = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    getRecorderManager: () => ({ start: (options) => recorderStarts.push(options) }),
    getFileSystemManager: () => ({ readFile: (options) => options.success({ data: fileData }) }),
    request(options) {
      requests.push(options)
      options.success({ statusCode: 200, data: {} })
    }
  }

  for (const id of ['../services/audio', '../services/auth', '../services/api', '../services/request', '../utils/recording']) {
    delete require.cache[require.resolve(id)]
  }
  return { audio: require('../services/audio'), recorderStarts, requests, fileData }
}

test('startPcmFrames starts the shared recorder with the framed PCM contract', () => {
  const h = loadAudio()

  h.audio.startPcmFrames()

  assert.deepEqual(h.recorderStarts, [{
    duration: 600000,
    sampleRate: 16000,
    numberOfChannels: 1,
    format: 'PCM',
    frameSize: 4
  }])
})

test('uploadFile PUTs bytes with default and overridden MIME then triggers mine', async () => {
  const h = loadAudio()

  await h.audio.uploadFile('/tmp/default.m4a', 'default.m4a')
  await h.audio.uploadFile('/tmp/interview.wav', 'interview.m4a', 'audio/wav')

  const uploads = h.requests.filter((request) => request.method === 'PUT')
  const mines = h.requests.filter((request) => request.method === 'POST' && request.url.endsWith('/mine'))
  assert.equal(uploads.length, 2)
  assert.equal(uploads[0].data, h.fileData)
  assert.equal(uploads[0].header['content-type'], 'audio/mp4')
  assert.equal(uploads[0].header.Authorization, 'Bearer anon_audio_test')
  assert.equal(uploads[0].header['X-VD-Platform'], 'miniapp')
  assert.equal(uploads[1].data, h.fileData)
  assert.equal(uploads[1].header['content-type'], 'audio/wav')
  assert.equal(mines.length, 2)
})
