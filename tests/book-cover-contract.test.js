const test = require('node:test')
const assert = require('node:assert/strict')
const recording = require('../utils/recording')
const books = require('../services/books')

global.wx = global.wx || { getStorageSync() {}, setStorageSync() {} }

test('uses the shared dedicated article cover key', () => {
  assert.equal(recording.coverKey('2026-08-13-091500'), 'photos/2026-08-13-091500/cover.jpg')
  assert.equal(recording.coverKeyForStem('VoiceDrop-2026-08-13-091500-3m20s-Wed-Morning-Shanghai'),
    'photos/2026-08-13-091500/cover.jpg')
  assert.equal(recording.coverKeyForStem('random-file'), '')
})

test('book index keeps optional author and server order metadata', () => {
  const list = books.normalizeIndex({ books: [{ slug: 'demo', title: '书', author: '作者', createdAt: 123 }] })
  assert.equal(list[0].author, '作者')
  assert.equal(list[0].createdAt, 123)
  assert.equal(books.shareTitle(list[0]), '《书》 — 作者')
})
