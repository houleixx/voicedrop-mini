const test = require('node:test')
const assert = require('node:assert/strict')

function loadQueue(options = {}) {
  const storage = options.storage || {}
  const calls = { copies: [], saves: [], photoPaths: [], unlinks: [], order: [], replies: [] }
  global.wx = {
    env: { USER_DATA_PATH: '/user' },
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = value },
    getFileSystemManager() {
      return {
        copyFile({ srcPath, destPath, success, fail }) {
          calls.copies.push({ srcPath, destPath })
          if (options.copyFails) fail(new Error('copy failed'))
          else success()
        },
        saveFile({ tempFilePath, filePath, success, fail }) {
          calls.saves.push({ tempFilePath, filePath })
          if (options.saveFails) fail(new Error('save failed'))
          else success({ savedFilePath: filePath })
        },
        unlink({ filePath, success }) {
          calls.unlinks.push(filePath)
          success()
        }
      }
    }
  }
  const audio = {
    uploadFile: async () => {
      calls.order.push('audio')
      if (options.audioFails) throw new Error('audio failed')
      return true
    },
    uploadTags: async () => true
  }
  const library = {
    uploadPhoto: async (filePath) => {
      calls.order.push('photo')
      calls.photoPaths.push(filePath)
      if (options.photoFails || (options.photoFailsOnOriginal && filePath === options.photoFailsOnOriginal)) {
        throw new Error('photo failed')
      }
      return true
    }
  }
  const pendingReplies = {
    put(name, replyTo) { calls.replies.push({ name, replyTo }) }
  }
  const ids = [
    '../services/recording-upload-queue',
    '../services/photo-marker-repair',
    '../services/audio',
    '../services/library',
    '../utils/pending-replies'
  ]
  ids.forEach((id) => { delete require.cache[require.resolve(id)] })
  require.cache[require.resolve('../services/audio')] = { exports: audio }
  require.cache[require.resolve('../services/library')] = { exports: library }
  require.cache[require.resolve('../utils/pending-replies')] = { exports: pendingReplies }
  const queue = require('../services/recording-upload-queue')
  return { queue, storage, calls }
}

const input = {
  name: 'VoiceDrop-2026-07-26-120000-0m5s-Sun-Noon.m4a',
  audioPath: '/user/take.wav',
  photos: [{ path: '/tmp/scene.jpg', key: 'photos/2026-07-26-120000/2-abc.jpg' }],
  tag: '工作',
  replyTo: 'share-1'
}

test('recording upload queue persists stable photos before network work', async () => {
  const h = loadQueue()
  const item = await h.queue.stage(input)

  assert.equal(h.calls.copies.length, 1)
  assert.match(item.photos[0].path, /^\/user\/voicedrop-pending-photo-/)
  assert.equal(h.queue.pending().length, 1)
})

test('recording upload queue persists WeChat http temp photos when copyFile rejects them', async () => {
  const originalPath = 'http://tmp/camera-photo.jpg'
  const h = loadQueue({ copyFails: true, photoFailsOnOriginal: originalPath })
  const item = await h.queue.stage({
    ...input,
    photos: [{
      path: originalPath,
      key: 'photos/2026-07-26-120000/2-abc.jpg'
    }]
  })

  assert.equal(h.calls.copies.length, 1)
  assert.equal(h.calls.saves.length, 1)
  assert.equal(h.calls.saves[0].tempFilePath, originalPath)
  assert.match(item.photos[0].path, /^\/user\/voicedrop-pending-photo-/)
  assert.equal(item.photos[0].cleanup, true)
  await h.queue.upload(input.name)
  assert.deepEqual(h.calls.order, ['photo', 'audio'])
  assert.notEqual(h.calls.photoPaths[0], originalPath)
  assert.equal(h.queue.pending().length, 0)
})

test('recording upload queue never lets audio overtake a failed photo', async () => {
  const h = loadQueue({ photoFails: true })
  await h.queue.stage(input)

  await assert.rejects(h.queue.upload(input.name), /photo failed/)

  assert.deepEqual(h.calls.order, ['photo'])
  assert.equal(h.queue.pending().length, 1)
  assert.deepEqual(h.calls.unlinks, [])
})

test('recording upload queue removes files only after photos and audio succeed', async () => {
  const h = loadQueue()
  await h.queue.stage(input)
  await h.queue.upload(input.name)

  assert.deepEqual(h.calls.order, ['photo', 'audio'])
  assert.equal(h.queue.pending().length, 0)
  assert.deepEqual(h.calls.replies, [{ name: input.name, replyTo: 'share-1' }])
  assert.ok(h.calls.unlinks.includes('/user/take.wav'))
  assert.ok(h.calls.unlinks.some((filePath) => /voicedrop-pending-photo-/.test(filePath)))
})

test('a successful recording with photos keeps a client-side marker repair plan', async () => {
  const h = loadQueue()
  await h.queue.stage(input)
  await h.queue.upload(input.name)

  assert.deepEqual(h.storage['vd.pendingPhotoMarkerRepairs.v1'], [{
    name: input.name,
    photoKeys: ['photos/2026-07-26-120000/2-abc.jpg']
  }])
})

test('recording upload queue retains the plan when audio upload fails', async () => {
  const h = loadQueue({ audioFails: true })
  await h.queue.stage(input)

  await assert.rejects(h.queue.upload(input.name), /audio failed/)

  assert.deepEqual(h.calls.order, ['photo', 'audio'])
  assert.equal(h.queue.pending().length, 1)
})

test('account deletion removes every queued recording and staged photo before clearing storage', async () => {
  const h = loadQueue()
  await h.queue.stage(input)

  await h.queue.clearAll()

  assert.equal(h.queue.pending().length, 0)
  assert.ok(h.calls.unlinks.includes('/user/take.wav'))
  assert.ok(h.calls.unlinks.some((filePath) => /voicedrop-pending-photo-/.test(filePath)))
})
