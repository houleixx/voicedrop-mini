const test = require('node:test')
const assert = require('node:assert/strict')
const books = require('../services/books')

function requests(handler) {
  const calls = []
  global.wx = {
    getStorageSync(key) { return key === 'voicedrop.auth.anon' ? 'anon_book_test' : '' },
    setStorageSync() {},
    request(options) {
      calls.push({ method: options.method || 'GET', url: options.url, data: options.data })
      const response = handler ? handler(options) : { statusCode: 200, data: { name: '旧名字' } }
      if (response instanceof Error) options.fail({ errMsg: response.message })
      else options.success(response)
    }
  }
  return calls
}

test('author save decision preserves unknown names and handles trim/change/clear', () => {
  assert.equal(books.authorToSave('  同名 ', '同名'), null)
  assert.equal(books.authorToSave('  新名 ', '旧名'), '新名')
  assert.equal(books.authorToSave(' ', '旧名'), '')
  assert.equal(books.authorToSave('', null), null)
  assert.equal(books.authorToSave('新名', null), '新名')
})

test('writing author treats missing name on success as known empty, and HTTP/network failures as unknown', async () => {
  requests(() => ({ statusCode: 200, data: {} }))
  assert.equal(await books.writingAuthor(), '')
  requests(() => ({ statusCode: 401, data: {} }))
  assert.equal(await books.writingAuthor(), null)
  requests(() => new Error('offline'))
  assert.equal(await books.writingAuthor(), null)
})

test('changed author is saved before paid book request; author/hidden are sent and trimmed', async () => {
  const calls = requests((r) => ({ statusCode: r.method === 'POST' ? 202 : 200, data: {} }))
  await books.start('  中心思想 ', { author: ' 新名 ', loadedName: '旧名', hidden: true })
  assert.deepEqual(calls.map((r) => r.method), ['PUT', 'POST'])
  assert.match(calls[0].url, /\/files\/api\/style$/)
  assert.deepEqual(calls[0].data, { name: '新名' })
  assert.deepEqual(calls[1].data, { seed: '中心思想', author: '新名', hidden: true })
})

test('unchanged author does not write profile; creation keeps false hidden default', async () => {
  const calls = requests(() => ({ statusCode: 202, data: {} }))
  await books.start('seed', { author: ' 同名 ', loadedName: '同名' })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].data, { seed: 'seed', hidden: false, author: '同名' })
})

test('clear known author saves empty profile before omitting book author', async () => {
  const calls = requests(() => ({ statusCode: 200, data: {} }))
  await books.start('seed', { author: '', loadedName: '旧名' })
  assert.deepEqual(calls[0].data, { name: '' })
  assert.deepEqual(calls[1].data, { seed: 'seed', hidden: false })
})

test('blank unknown author re-reads profile before clearing; known empty needs no write', async () => {
  const calls = requests(() => ({ statusCode: 200, data: { name: '旧名字' } }))
  await books.start('seed', { author: '', loadedName: null, authorEdited: true })
  assert.deepEqual(calls.map((r) => r.method), ['GET', 'PUT', 'POST'])
  assert.deepEqual(calls[1].data, { name: '' })
  const empty = requests(() => ({ statusCode: 200, data: {} }))
  await books.start('seed', { author: '', loadedName: null, authorEdited: true })
  assert.deepEqual(empty.map((r) => r.method), ['GET', 'POST'])
})

test('unknown empty author cannot start a paid job when retry read fails', async () => {
  for (const response of [{ statusCode: 503, data: {} }, new Error('offline')]) {
    const calls = requests(() => response)
    await assert.rejects(books.start('seed', { loadedName: null }), { code: 'AUTHOR_LOAD_FAILED' })
    assert.deepEqual(calls.map((r) => r.method), ['GET'])
  }
})

test('profile save HTTP/network failure cannot start a paid job', async () => {
  for (const response of [{ statusCode: 500, data: {} }, new Error('offline')]) {
    const calls = requests(() => response)
    await assert.rejects(books.start('seed', { author: '新名', loadedName: '旧名' }), { code: 'AUTHOR_SAVE_FAILED' })
    assert.deepEqual(calls.map((r) => r.method), ['PUT'])
  }
})

test('explicit author works without loaded profile and preserves book 402/queued responses', async () => {
  for (const response of [{ statusCode: 402, data: { need_suanli: 320, suanli: 1 } }, { statusCode: 202, data: { queued: true, queue_position: 2 } }]) {
    const calls = requests((r) => r.method === 'POST' ? response : { statusCode: 200, data: {} })
    assert.deepEqual(await books.start('seed', { author: '名字', loadedName: null }), response)
    assert.deepEqual(calls.map((r) => r.method), ['PUT', 'POST'])
  }
})


test('untouched unknown author adopts retried profile without clearing it', async () => {
  const calls = requests(() => ({ statusCode: 200, data: { name: '保留原名' } }))
  await books.start('seed', { author: '', loadedName: null, authorEdited: false })
  assert.deepEqual(calls.map((r) => r.method), ['GET', 'POST'])
  assert.deepEqual(calls[1].data, { seed: 'seed', hidden: false, author: '保留原名' })
})

test('unchanged long profile is not truncated or rewritten', async () => {
  const name = '长名字'.repeat(10)
  assert.equal(books.authorToSave('  ' + name + ' ', name), null)
  const calls = requests(() => ({ statusCode: 202, data: {} }))
  await books.start('seed', { author: name, loadedName: name })
  assert.deepEqual(calls.map((r) => r.method), ['POST'])
  assert.equal(calls[0].data.author, name)
})

test('malformed successful profile response remains unknown', async () => {
  for (const data of [null, 'bad response', [], { name: null }, { name: 1 }]) {
    requests(() => ({ statusCode: 200, data }))
    assert.equal(await books.writingAuthor(), null)
  }
})

test('account switch during name save never submits a book to the new account', async () => {
  const calls = requests(() => {
    global.wx.getStorageSync = (key) => key === 'voicedrop.auth.anon' ? 'anon_other_user' : ''
    return { statusCode: 200, data: {} }
  })
  await assert.rejects(books.start('seed', { author: '新名字', loadedName: '旧名字' }), { code: 'AUTHOR_IDENTITY_CHANGED' })
  assert.deepEqual(calls.map((r) => r.method), ['PUT'])
})


test('empty seed fails before reading or saving a profile', async () => {
  const calls = requests(() => ({ statusCode: 200, data: {} }))
  assert.deepEqual(await books.start('  ', { author: '新名字', loadedName: '旧名字' }), { statusCode: 400, data: { error: 'empty seed' } })
  assert.deepEqual(calls, [])
})
