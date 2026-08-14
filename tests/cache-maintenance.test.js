const test = require('node:test')
const assert = require('node:assert/strict')

const cacheMaintenance = require('../services/cache-maintenance')

function harness() {
  const photoIndex = JSON.stringify([
    { key: 'users/anon-a/photos/a.jpg', path: '/cache/a.jpg' },
    { key: 'users/anon-a/photos/a.jpg#w512', path: '/cache/thumb-a.jpg' },
    { key: 'users/anon-a/photos/disguised.jpg', path: '/cache/audio-cover.jpg' },
    { key: 'users/anon-a/audio/not-a-photo.m4a', path: '/cache/not-a-photo.jpg' },
    { key: 'users/anon-a/photos/not-image.txt', path: '/cache/not-image.txt' },
    { key: 'users/anon-a/photos/traversal.jpg', path: '/cache/../private.jpg' }
  ])
  const storage = {
    'voicedrop.auth.anon': 'anon_secret',
    'voicedrop.recording.uploads.v1': '[pending]',
    'voicedrop.followup.enabled': true,
    'voicedrop.library.meta.v1.account': '{"titles":{"one":"文章"}}',
    'voicedrop.library.list.v1.account': '{"recordings":[{"name":"VoiceDrop-safe.m4a"}]}',
    'voicedrop.library.doc.v1.account.one': '{"articles":[{"title":"文章"}]}',
    'voicedrop.library.doc-index.v1.account': '["one"]',
    'voicedrop.library.photo-index.v1.account': photoIndex,
    'voicedrop.library.audio-index.v1.account': '[{"path":"/audio/keep.m4a"},{"path":"/cache/audio-cover.jpg"}]',
    'voicedrop.books.shelf.v1': '{"books":[{"slug":"cached-book"}]}',
    'voicedrop.community.detail.v1.account.share': '{"shareId":"share"}',
    'voicedrop.community.detail-index.v1.account': '["share"]',
    'voicedrop.community.feed.v1.account': '{"posts":[]}'
  }
  const sizes = { '/cache/a.jpg': 1536, '/cache/thumb-a.jpg': 512 }
  const unlinked = []
  const resets = []
  const fs = {
    statSync(path) {
      if (!Object.prototype.hasOwnProperty.call(sizes, path)) throw new Error('missing')
      return { size: sizes[path] }
    },
    unlinkSync(path) { unlinked.push(path) }
  }
  const wxApi = {
    env: { USER_DATA_PATH: '/cache' },
    getStorageInfoSync: () => ({ keys: Object.keys(storage) }),
    getStorageSync: (key) => storage[key],
    removeStorageSync: (key) => { delete storage[key] },
    getFileSystemManager: () => fs
  }
  const service = cacheMaintenance.create({
    wxApi,
    resetLibrary: () => resets.push('library'),
    resetCommunity: () => resets.push('community')
  })
  return { storage, photoIndex, unlinked, resets, service }
}

test('cache size includes only rebuildable shelf, article, image and community detail caches', async () => {
  const h = harness()
  const result = await h.service.snapshot()
  const clearableValues = Object.entries(h.storage)
    .filter(([key]) => cacheMaintenance.isClearableStorageKey(key))
    .map(([, value]) => value)
  const expectedStorage = clearableValues.reduce((sum, value) => sum + cacheMaintenance.utf8ByteLength(value), 0)

  assert.equal(result.storageBytes, expectedStorage)
  assert.equal(result.fileBytes, 2048)
  assert.equal(result.bytes, expectedStorage + 2048)
  assert.deepEqual(result.paths.sort(), ['/cache/a.jpg', '/cache/thumb-a.jpg'])
})

test('cache clear preserves identity, settings, uploads, audio and community feed data', async () => {
  const h = harness()

  await h.service.clear()

  assert.deepEqual(h.unlinked.sort(), ['/cache/a.jpg', '/cache/thumb-a.jpg'])
  assert.deepEqual(h.resets, ['library', 'community'])
  assert.equal(h.storage['voicedrop.auth.anon'], 'anon_secret')
  assert.equal(h.storage['voicedrop.recording.uploads.v1'], '[pending]')
  assert.equal(h.storage['voicedrop.followup.enabled'], true)
  assert.match(h.storage['voicedrop.library.audio-index.v1.account'], /keep\.m4a/)
  assert.match(h.storage['voicedrop.library.audio-index.v1.account'], /audio-cover\.jpg/)
  assert.match(h.storage['voicedrop.community.feed.v1.account'], /posts/)
  assert.equal(h.storage['voicedrop.books.shelf.v1'], undefined)
  assert.equal(Object.keys(h.storage).some(cacheMaintenance.isClearableStorageKey), false)
})

test('cache size formatting stays compact across units', () => {
  assert.equal(cacheMaintenance.formatBytes(0), '0 B')
  assert.equal(cacheMaintenance.formatBytes(512), '512 B')
  assert.equal(cacheMaintenance.formatBytes(1536), '1.5 KB')
  assert.equal(cacheMaintenance.formatBytes(2 * 1024 * 1024), '2 MB')
})
