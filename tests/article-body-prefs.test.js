const test = require('node:test')
const assert = require('node:assert/strict')

const article = require('../utils/article')
const prefs = require('../utils/prefs')
const styleSelection = require('../utils/style-selection')

test('resolves photo markers, strips comments, and builds share text', () => {
  const body = '<!-- style: 风格 v3 -->\n第一段\n\n[[photo:1]]\n\n第二段'
  assert.equal(article.styleLabel(body), '风格 v3')
  assert.equal(article.styleVersion(body), 3)
  assert.equal(article.resolvePhotoKey('1', ['photos/a.jpg']), 'photos/a.jpg')
  assert.equal(article.firstPhotoKey(body, ['photos/a.jpg']), 'photos/a.jpg')
  assert.equal(article.stripMarkers(body), '第一段\n\n第二段')
  assert.equal(article.shareText([{ title: '标题', body }]), '标题\n\n第一段\n\n第二段')
})

test('builds Android-compatible share payload text with public link', () => {
  const text = '标题\n\n正文'
  const url = 'https://jianshuo.dev/voicedrop/abc?s=1'
  assert.equal(article.shareTextWithLink(text, url), '标题\n\n正文\n\nhttps://jianshuo.dev/voicedrop/abc?s=1')
  assert.equal(article.shareTextWithLink('', url), url)
  assert.equal(article.shareTextWithLink(text, ''), text)
  assert.equal(article.shareTextForTarget(text, url, 'com.tencent.mm'), '标题\n\n正文\n\nhttps://jianshuo.dev/voicedrop/abc?s=1')
})

test('builds Android-compatible multi-article share text', () => {
  assert.equal(article.shareText([
    { title: '第一篇', body: '正文一\n[[photo:1]]' },
    { title: '第二篇', body: '<!-- style: 风格 v2 -->\n正文二' }
  ]), '【第一篇】\n\n正文一\n\n---\n\n【第二篇】\n\n正文二')
})

test('stores delete-local preference and liked community posts', () => {
  const storage = prefs.memoryStorage()
  assert.equal(prefs.deleteLocalAfterUpload(storage), true)
  prefs.setDeleteLocalAfterUpload(false, storage)
  assert.equal(prefs.deleteLocalAfterUpload(storage), false)
  prefs.setLikedCommunityPost('share-1', true, storage)
  assert.equal(prefs.likedCommunityPost('share-1', storage), true)
  prefs.setLikedCommunityPost('share-1', false, storage)
  assert.equal(prefs.likedCommunityPost('share-1', storage), false)
  prefs.setLikedCommunityPosts(new Set(['a', 'b']), storage)
  assert.equal(prefs.likedCommunityPost('b', storage), true)
})

test('limits multi-style selection to three versions', () => {
  assert.deepEqual(styleSelection.normalized([2, '2', 1, 3, 4]), [2, 1, 3])
  let next = styleSelection.toggle([1, 2], 3)
  assert.deepEqual(next, { selected: [1, 2, 3], ok: true, limit: false })
  next = styleSelection.toggle([1, 2, 3], 4)
  assert.deepEqual(next, { selected: [1, 2, 3], ok: false, limit: true })
  next = styleSelection.toggle([1, 2, 3], 2)
  assert.deepEqual(next.selected, [1, 3])
  assert.deepEqual(styleSelection.selectedRows([{ style: 'A' }, { v: 7, style: 'B' }], [0, 7]).map((row) => row.selected), [true, true])
})

test('summarizes selected writing styles for the settings header', () => {
  assert.equal(styleSelection.summary([4, 3]), '已选 v4、v3')
  assert.equal(styleSelection.summary([]), '未选择风格')
})

test('sorts writing style history newest version first', () => {
  assert.deepEqual(
    styleSelection.selectedRows([{ v: 1 }, { v: 4 }, { v: 2 }, { v: 3 }], [4, 3]).map((row) => row.v),
    [4, 3, 2, 1]
  )
})

test('uses one line writing style previews in selection rows', () => {
  const rows = styleSelection.selectedRows([{ v: 1, style: '第一行\n第二行' }], [1])
  assert.equal(rows[0].preview, '第一行')
})
