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
  const list = books.normalizeIndex({ books: [
    { slug: 'newer', title: '新书', author: '作者', createdAt: 123, cover: true, coverAt: 456 },
    { slug: 'older', title: '旧书' }
  ] })
  assert.deepEqual(list.map((book) => book.slug), ['newer', 'older'])
  assert.equal(list[0].author, '作者')
  assert.equal(list[0].createdAt, 123)
  assert.equal(list[0].coverAt, 456)
  assert.equal(list[0].coverUrl, 'https://voicedrop.cn/books/newer/cover.jpg?v=456')
  assert.equal(list[1].createdAt, 0)
  assert.equal(books.shareTitle(list[0]), '《新书》 — 作者')
  assert.equal(books.coverUrl(list[0]), 'https://voicedrop.cn/books/newer/cover.jpg?v=456')
  assert.equal(books.coverUrl(list[1]), 'https://voicedrop.cn/books/older/cover.jpg')
})

test('book editability temporarily follows the trimmed profile author name', () => {
  const list = books.markEditableByAuthor([
    { slug: 'mine', author: ' 王小明 ' },
    { slug: 'other', author: '李小明' },
    { slug: 'unsigned', author: '' }
  ], '王小明')

  assert.equal(list[0].editableByAuthor, true)
  assert.equal(list[1].editableByAuthor, false)
  assert.equal(list[2].editableByAuthor, false)
  assert.equal(books.markEditableByAuthor(list, '').some((book) => book.editableByAuthor), false)
})

test('book chapter share accepts only pages under the selected book root', () => {
  const book = { slug: 'safe-book' }
  assert.equal(books.readerPageUrl(book, 'https://voicedrop.cn/books/safe-book/chapter-2.html'),
    'https://voicedrop.cn/books/safe-book/chapter-2.html')
  assert.equal(books.readerPageUrl(book, 'https://example.com/books/safe-book/chapter-2.html'),
    'https://voicedrop.cn/books/safe-book/')
  assert.equal(books.readerPageUrl(book, 'https://voicedrop.cn/books/other/chapter-2.html'),
    'https://voicedrop.cn/books/safe-book/')
})
