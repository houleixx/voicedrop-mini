const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const books = require('../services/books')

function loadRevisePage() {
  let definition
  global.wx = {
    nextTick(callback) { callback() }
  }
  global.Page = (value) => { definition = value }
  const modulePath = require.resolve('../pages/book-revise/index.js')
  delete require.cache[modulePath]
  require(modulePath)
  delete global.Page
  return {
    ...definition,
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch) }
  }
}

test('book revise service matches history and revise endpoint contracts', async () => {
  const requests = []
  global.wx = {
    getStorageSync(key) { return key === 'voicedrop.auth.anon' ? 'anon_test_token' : '' },
    setStorageSync() {},
    request(options) {
      requests.push(options)
      options.success({ statusCode: options.method === 'POST' ? 202 : 200, data: {} })
    }
  }
  await books.history('hello world')
  await books.revise('hello-world', '  删掉重复段落  ')

  assert.equal(requests[0].method, 'GET')
  assert.equal(requests[0].url, 'https://lab.jianshuo.dev/api/book/history?slug=hello%20world')
  assert.equal(requests[0].header.Authorization, 'Bearer anon_test_token')
  assert.equal(requests[0].timeout, 20000)
  assert.equal(requests[1].method, 'POST')
  assert.equal(requests[1].url, 'https://lab.jianshuo.dev/api/book/revise')
  assert.deepEqual(requests[1].data, { slug: 'hello-world', instruction: '删掉重复段落' })
  assert.equal(requests[1].timeout, 30000)
})

test('book revise normalizes the permanent thread and all specified status errors', () => {
  const result = books.normalizeThread({
    slug: 'sample',
    running: false,
    thread: [
      { ts: 1786500000000, kind: 'create', instruction: '种子', status: 'done', reply: '写好了' },
      { ts: 1786501000000, kind: 'revise', instruction: '重写', status: 'running' }
    ]
  })
  assert.equal(result.running, true)
  assert.equal(result.thread[0].kind, 'create')
  assert.equal(result.thread[0].reply, '写好了')
  assert.match(result.thread[0].stamp, /^\d+月\d+日 \d\d:\d\d$/)
  assert.equal(result.thread[1].status, 'running')

  assert.match(books.reviseMessage(401), /身份校验/)
  assert.match(books.reviseMessage(402, { need_suanli: 40, suanli: 12.5 }), /要 40 算力/)
  assert.match(books.reviseMessage(402, { need_suanli: 40, suanli: 12.5 }), /现在有 12\.5/)
  assert.match(books.reviseMessage(403), /主人/)
  assert.match(books.reviseMessage(404), /早期写的/)
  assert.match(books.reviseMessage(409), /还在进行/)
})

test('book revise page loads history, submits optimistically, and locks while running', async () => {
  const originalHistory = books.history
  const originalRevise = books.revise
  books.history = async () => ({
    statusCode: 200,
    data: { slug: 'sample', running: false, thread: [
      { ts: 1000, kind: 'create', instruction: '开书', status: 'done', reply: '写好了' }
    ] }
  })
  books.revise = async () => ({ statusCode: 202, data: { ts: 2000 } })
  try {
    const page = loadRevisePage()
    page._active = true
    page.setData({ slug: 'sample', title: '示例书' })
    await page.loadHistory()
    assert.equal(page.data.thread.length, 1)
    assert.equal(page.data.loading, false)

    page.onInput({ detail: { value: '  删掉重复内容  ' } })
    assert.equal(page.data.canSend, true)
    page.schedulePoll = () => {}
    await page.send()
    assert.equal(page.data.thread.length, 2)
    assert.equal(page.data.thread[1].instruction, '删掉重复内容')
    assert.equal(page.data.thread[1].status, 'running')
    assert.equal(page.data.running, true)
    assert.equal(page.data.canSend, false)
  } finally {
    books.history = originalHistory
    books.revise = originalRevise
  }
})

test('book revise page ignores a submit response after unload without polling or updating state', async () => {
  const originalRevise = books.revise
  let resolveRevise
  books.revise = () => new Promise((resolve) => { resolveRevise = resolve })
  try {
    const page = loadRevisePage()
    page._active = true
    page._unloaded = false
    page.setData({ slug: 'sample', input: '删掉重复内容', canSend: true })
    let polls = 0
    page.schedulePoll = () => { polls += 1 }
    const pending = page.send()
    assert.equal(page.data.sending, true)

    page.onUnload()
    resolveRevise({ statusCode: 202, data: { ts: 2000 } })
    await pending

    assert.equal(page.data.thread.length, 0)
    assert.equal(page.data.input, '删掉重复内容')
    assert.equal(page.data.running, false)
    assert.equal(page.data.sending, true)
    assert.equal(polls, 0)
  } finally {
    books.revise = originalRevise
  }
})

test('book revise page turns owner and legacy-book failures into blocking states', async () => {
  const originalHistory = books.history
  try {
    books.history = async () => ({ statusCode: 403, data: { error: 'not-owner' } })
    const denied = loadRevisePage()
    denied._active = true
    denied.setData({ slug: 'sample' })
    await denied.loadHistory()
    assert.match(denied.data.denied, /主人/)
    assert.equal(denied.data.canSend, false)

    books.history = async () => ({ statusCode: 404, data: { error: 'no-book' } })
    const legacy = loadRevisePage()
    legacy._active = true
    legacy.setData({ slug: 'old-book' })
    await legacy.loadHistory()
    assert.match(legacy.data.denied, /早期写的/)
  } finally {
    books.history = originalHistory
  }
})

test('book revise page is registered and exposes the 40-suanli conversation UI', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  const markup = fs.readFileSync(path.join(root, 'pages/book-revise/index.wxml'), 'utf8')
  const source = fs.readFileSync(path.join(root, 'pages/book-revise/index.js'), 'utf8')
  assert.ok(app.pages.includes('pages/book-revise/index'))
  assert.match(markup, /每次修改 40 算力/)
  assert.match(markup, /开书种子/)
  assert.match(markup, /修改说明/)
  assert.match(source, /const POLL_MS = 6000/)
})
