const test = require('node:test')
const assert = require('node:assert/strict')

const publicShare = require('../services/public-share')

test('public share extracts the public id from an article short link', () => {
  assert.equal(publicShare.shareIdFromUrl('https://voicedrop.cn/Ab3xK9_p2Q?s=1'), 'Ab3xK9_p2Q')
  assert.equal(publicShare.shareIdFromUrl('not-a-share'), '')
})

test('public share id cache is scoped by account and article stem', () => {
  const values = new Map()
  const storage = {
    getStorageSync: (key) => values.get(key) || '',
    setStorageSync: (key, value) => values.set(key, value)
  }
  const firstAccount = { libraryCacheIdentity: () => 'users/first/' }
  const secondAccount = { libraryCacheIdentity: () => 'users/second/' }

  assert.equal(publicShare.storeId('VoiceDrop-one', 'Ab3xK9_p2Q', { auth: firstAccount, storage }), true)
  assert.equal(publicShare.cachedId('VoiceDrop-one', { auth: firstAccount, storage }), 'Ab3xK9_p2Q')
  assert.equal(publicShare.cachedId('VoiceDrop-two', { auth: firstAccount, storage }), '')
  assert.equal(publicShare.cachedId('VoiceDrop-one', { auth: secondAccount, storage }), '')
})

test('public share id cache ignores malformed ids', () => {
  const values = new Map()
  const storage = {
    getStorageSync: (key) => values.get(key) || '',
    setStorageSync: (key, value) => values.set(key, value)
  }
  const auth = { libraryCacheIdentity: () => 'users/demo/' }

  assert.equal(publicShare.storeId('VoiceDrop-one', 'too-short', { auth, storage }), false)
  assert.equal(publicShare.cachedId('VoiceDrop-one', { auth, storage }), '')
})

test('public share reads a public article without a recipient token', async () => {
  const calls = []
  const result = await publicShare.read('Ab3xK9_p2Q', {
    api: { filesBase: () => 'https://example.test/files/api', path: (value) => value },
    http: {
      async get(url, token) {
        calls.push({ url, token })
        return {
          statusCode: 200,
          data: {
            type: 'article',
            owner: 'users/demo/',
            photos: ['photos/one.jpg'],
            articles: [{ title: '公开文章', body: '正文' }]
          }
        }
      }
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.doc.owner, 'users/demo/')
  assert.equal(result.doc.articles[0].title, '公开文章')
  assert.deepEqual(calls, [{ url: 'https://example.test/files/api/link/Ab3xK9_p2Q', token: '' }])
})
