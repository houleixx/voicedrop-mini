const test = require('node:test')
const assert = require('node:assert/strict')
const { parseFileList, contentBlocks } = require('../services/book-offline')

test('checking a large shelf scans the offline directory once and only reads existing copies', (t) => {
  const { downloadStates } = require('../services/book-offline')
  const originalWx = global.wx
  t.after(() => { global.wx = originalWx })
  let scans = 0
  const reads = []
  global.wx = {
    env: { USER_DATA_PATH: '/sandbox' },
    getFileSystemManager: () => ({
      readdirSync(path) {
        assert.equal(path, '/sandbox/offline-books')
        scans += 1
        return ['book-17', 'book-42.previous']
      },
      readFileSync(path) {
        reads.push(path)
        if (path.includes('book-42/')) throw new Error('Missing')
        return '{}'
      },
      accessSync() {}
    })
  }
  const states = downloadStates(Array.from({ length: 429 }, (_, index) => `book-${index}`))
  assert.equal(scans, 1)
  assert.deepEqual(reads, [
    '/sandbox/offline-books/book-17/manifest.json',
    '/sandbox/offline-books/book-42/manifest.json',
    '/sandbox/offline-books/book-42.previous/manifest.json'
  ])
  assert.deepEqual(states.flatMap((state, index) => state === 'downloaded' ? [index] : []), [17, 42])
})

test('the offline manifest requires an index and sandbox-safe unique paths', () => {
  const list = { slug: 'sample', files: [{ path: 'index.html', size: 123 }, { path: 'images/i.jpg', size: 15 }], audio: ['01'] }
  assert.equal(parseFileList(list, 'sample'), list)
  for (const path of ['../book.html', 'video/%2e%2e', 'video\\x', 'index.html', 'manifest.json', 'audio/override.mp3']) {
    assert.throws(() => parseFileList({ ...list, files: [...list.files, { path, size: 1 }] }, 'sample'))
  }
  assert.throws(() => parseFileList({ ...list, files: list.files.slice(1) }, 'sample'))
  assert.throws(() => parseFileList({ ...list, audio: ['../01'] }, 'sample'))
})

test('the native reader preserves chapter text and only displays downloaded book images', () => {
  const book = { root: 'wxfile://books/sample', files: ['images/图.jpg'] }
  const html = '<body><p>navigation</p><article><p>chapter</p><script>alert(1)</script>' +
    '<img src="images/%E5%9B%BE.jpg?v=1"><img src="https://other.invalid/remote.jpg">' +
    '<p><a href="javascript:alert(2)">words</a></p></article></body>'
  assert.deepEqual(contentBlocks(html, book, 'https://voicedrop.cn/books/sample/'), [
    { text: '<p>chapter</p>' }, { image: 'wxfile://books/sample/images/图.jpg' },
    { text: '<p><span>words</span></p>' }
  ])
})

test('publishes a complete offline copy and preserves it when a later download fails', async (t) => {
  const fs = require('node:fs')
  const path = require('node:path')
  const os = require('node:os')
  const offline = require('../services/book-offline')
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-offline-book-'))
  const originalWx = global.wx
  t.after(() => {
    global.wx = originalWx
    fs.rmSync(folder, { recursive: true, force: true })
  })

  const root = 'https://voicedrop.cn/books/sample/'
  const files = [
    { path: 'index.html', size: 5 },
    { path: '01.html', size: 5 },
    { path: 'images/cover.jpg', size: 4 }
  ]
  let failChapter = false
  global.wx = {
    env: { USER_DATA_PATH: folder },
    getFileSystemManager: () => ({
      ...fs,
      mkdirSync: (name, recursive) => fs.mkdirSync(name, { recursive }),
      rmdirSync: (name, recursive) => fs.rmSync(name, { recursive })
    }),
    request({ success }) { success({ statusCode: 200, data: { slug: 'sample', files, audio: ['01', '02'] } }) },
    downloadFile({ url, filePath, success }) {
      const relative = url.startsWith(root) ? url.slice(root.length) : url
      if (failChapter && relative === '01.html' || relative.endsWith('/audiobook/sample/02')) {
        success({ statusCode: 404 })
        return
      }
      const body = relative === '01.html' ? '<article><p>Chapter text</p></article>'
        : relative === 'images/cover.jpg' ? 'JPEG'
          : relative.endsWith('/audiobook/sample/01') ? Buffer.alloc(20_000) : '<h1>Contents</h1>'
      fs.writeFileSync(filePath, body)
      success({ statusCode: 200 })
    }
  }
  const progress = []
  const badges = require('../utils/book-download-badges')
  const shelf = { data: { items: [{ slug: 'sample' }] },
    setData(update) { Object.assign(this.data, update) }, refreshBookSearch() {} }
  const pending = offline.download('sample', root, (value) => progress.push(value))
  badges.observe(shelf, 'items')
  t.after(() => badges.disconnect(shelf))
  assert.equal(shelf.data.items[0].downloadState, 'downloading')
  const book = await pending
  assert.equal(shelf.data.items[0].downloadState, 'downloaded')
  assert.equal(progress.at(-1), 99)
  assert.deepEqual(book.audio, ['01'])
  assert.equal(book.missingAudio, 1)
  assert.deepEqual(offline.readPage(offline.get('sample'), '01.html', root), [{ text: '<p style="margin:0 0 1em;line-height:1.8">Chapter text</p>' }])

  failChapter = true
  await assert.rejects(offline.download('sample', root, () => {}), /Missing book page/)
  assert.deepEqual(offline.get('sample'), book)
  offline.remove('sample')
  assert.equal(offline.get('sample'), null)
  assert.equal(shelf.data.items[0].downloadState, '')
})

test('the offline renderer keeps downloaded illustrations and identifies missing book illustrations', () => {
  const root = 'https://voicedrop.cn/books/sample/'
  const html = '<article><img src="images/saved.jpg"><img src="images/missing.jpg"><p>结尾</p></article>'
  const book = { root: 'wxfile://book', files: ['images/saved.jpg'], missingFiles: ['images/missing.jpg'] }
  assert.deepEqual(contentBlocks(html, book, root), [
    { image: 'wxfile://book/images/saved.jpg' }, { missingImage: true }, { text: '<p>结尾</p>' }
  ])
})

test('static preview keeps heading, quote and table formatting while the directory uses native links', () => {
  const root = 'https://voicedrop.cn/books/sample/'
  const book = { files: ['index.html', '01.html'] }
  const chapter = contentBlocks('<article><h2>小节</h2><blockquote>引文</blockquote><table><tr><td>数据</td></tr></table></article>', book, root, '01.html')
  assert.match(chapter[0].text, /<h2 style=.*<blockquote style=.*<table style=.*<td style=/)
  const index = contentBlocks('<body><p>简介</p><div class="toc"><a href="01.html">章节</a></div></body>', book, root, 'index.html')
  assert.equal(index.length, 1)
  assert.match(index[0].text, /简介/)
  assert.doesNotMatch(index[0].text, /章节/)
})

test('book index preserves the Android page headline, reading metadata and chapter summaries', () => {
  const { pagePresentation } = require('../services/book-offline')
  const html = '<style>:root{--tint:#e4eef8;}</style><body><span class="badge">1/2 章已发布</span><h1>一本书</h1>' +
    '<p class="sub">副标题</p><p class="meta">面向读者</p>' +
    '<a class="introcard" href="intro.html"><b>导读</b><p>从这里进门</p></a>' +
    '<div class="toc"><a class="row done" href="01.html"><span class="no">01</span>' +
    '<span class="t"><b>第一章</b><p>章节简介</p></span><span class="st">读 →</span></a></div></body>'
  const page = pagePresentation(html, { files: ['index.html', 'intro.html', '01.html'] },
    'index.html', 'https://voicedrop.cn/books/sample/')
  assert.deepEqual(page.index, {
    title: '一本书', subtitle: '副标题', meta: '面向读者', badge: '1/2 章已发布', tint: '#e4eef8',
    intro: '从这里进门', rows: [{ path: '01.html', title: '第一章', brief: '章节简介' }]
  })
  assert.deepEqual(page.blocks, [])
})

test('opening the offline reader builds chapter navigation without reading every chapter', (t) => {
  const { chapters } = require('../services/book-offline')
  const originalWx = global.wx
  t.after(() => { global.wx = originalWx })
  const reads = []
  global.wx = {
    env: { USER_DATA_PATH: '/local' },
    getFileSystemManager: () => ({ readFileSync(path) {
      reads.push(path)
      return '<h1>章节</h1>'
    } })
  }
  const book = { root: '/local/book', files: ['index.html', '02.html', '01.html'] }
  assert.deepEqual(chapters(book).map(({ path }) => path), ['index.html', '01.html', '02.html'])
  assert.deepEqual(reads, [])
})
