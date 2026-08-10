const test = require('node:test')
const assert = require('node:assert/strict')

function sampleManual() {
  const nav = []
  const chapters = []
  for (let index = 1; index <= 8; index += 1) {
    nav.push(`<a class="nav-item" href="#ch${index}"><span>${index}</span>第 ${index} 章</a>`)
    chapters.push(`<section id="ch${index}" class="chapter"><h2>第 ${index} 章 标题</h2><p>正文 ${index}</p></section>`)
  }
  return `<nav>${nav.join('')}</nav><main>${chapters.join('')}</main>`
}

function freshManualService(options) {
  const config = options || {}
  const storage = Object.assign({}, config.storage)
  let requests = 0
  const request = require('../services/request')
  const originalGet = request.get
  request.get = async () => {
    requests += 1
    if (config.fail) throw new Error('offline')
    return { statusCode: 200, data: config.html || sampleManual() }
  }
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value }
  }
  delete require.cache[require.resolve('../services/manual')]
  const manual = require('../services/manual')
  return {
    manual,
    storage,
    requests: () => requests,
    restore() { request.get = originalGet }
  }
}

test('manual parser accepts only a complete eight-chapter official manual', () => {
  const h = freshManualService()
  try {
    const chapters = h.manual.parseManual(sampleManual())
    assert.equal(chapters.length, 8)
    assert.equal(chapters[0].id, 'ch1')
    assert.equal(chapters[0].title, '第 1 章 标题')
    assert.match(chapters[0].html, /<p style="[^"]*line-height:1\.75;">正文 1<\/p>/)
    assert.deepEqual(h.manual.parseManual('<section id="ch1"><p>残缺</p></section>'), [])
  } finally {
    h.restore()
  }
})

test('manual parser embeds narrow-screen typography and table styles for rich-text', () => {
  const h = freshManualService()
  try {
    const html = Array.from({ length: 8 }, (_, offset) => {
      const index = offset + 1
      return `<section id="ch${index}" class="chapter"><h2>第 ${index} 章</h2><h3>小标题</h3><p>正文</p><table><tr><th>状态</th><th>意思</th></tr><tr><td>待处理</td><td>录音已经传上去，排队等着处理</td></tr></table></section>`
    }).join('')
    const chapter = h.manual.parseManual(html)[0].html

    assert.match(chapter, /<h2 style="[^"]*margin:0/)
    assert.match(chapter, /<table style="[^"]*width:100%/)
    assert.match(chapter, /<th style="[^"]*border:/)
    assert.match(chapter, /<td style="[^"]*white-space:nowrap/)
  } finally {
    h.restore()
  }
})

test('manual sync fetches at most once within twenty-four hours and writes local cache', async () => {
  const now = 1_800_000_000_000
  const h = freshManualService()
  try {
    const first = await h.manual.sync(now)
    const second = await h.manual.sync(now + 60 * 60 * 1000)

    assert.equal(first.sections.length, 8)
    assert.equal(second.sections.length, 8)
    assert.equal(h.requests(), 1)
    assert.equal(h.storage[h.manual.CACHE_KEY].checkedAt, now)
    assert.equal(h.storage[h.manual.CACHE_KEY].fetchedAt, now)
  } finally {
    h.restore()
  }
})

test('failed refresh keeps stale sections and suppresses repeat attempts for the day', async () => {
  const now = 1_800_000_000_000
  const stale = {
    checkedAt: now - 2 * 24 * 60 * 60 * 1000,
    fetchedAt: now - 2 * 24 * 60 * 60 * 1000,
    sections: [{ id: 'ch1', title: '旧内容', html: '<h2>旧内容</h2>' }]
  }
  const h = freshManualService({ fail: true, storage: { 'voicedrop.manual.v1': stale } })
  try {
    const first = await h.manual.sync(now)
    const second = await h.manual.sync(now + 1000)

    assert.equal(first.sections[0].title, '旧内容')
    assert.match(first.sections[0].html, /<h2 style="[^"]*margin:0/)
    assert.equal(second.sections[0].title, '旧内容')
    assert.equal(h.requests(), 1)
    assert.equal(h.storage[h.manual.CACHE_KEY].checkedAt, now)
    assert.equal(h.storage[h.manual.CACHE_KEY].formatVersion, h.manual.FORMAT_VERSION)
  } finally {
    h.restore()
  }
})
