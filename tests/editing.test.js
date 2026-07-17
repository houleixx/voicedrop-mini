const test = require('node:test')
const assert = require('node:assert/strict')

const edit = require('../services/article-edit')
const playback = require('../utils/audio-playback-state')
const photo = require('../utils/photo-insert')
const popupMenuPosition = require('../utils/popup-menu-position')
const styleRewrite = require('../utils/style-rewrite')
const uiConfig = require('../utils/ui-config')
const versionNav = require('../utils/version-navigation')

test('builds article edit websocket payload compatible with Android', () => {
  const payload = edit.payloadFor({
    id: 'req-1',
    text: '把这一段改短',
    articleIndex: 2,
    images: [{ key: 'photos/a.jpg', base64: 'abc' }],
    anchor: { type: 'line', line: 7, text: '完整段落' }
  })
  assert.deepEqual(JSON.parse(payload), {
    type: 'instruct',
    id: 'req-1',
    text: '把这一段改短',
    articleIndex: 2,
    images: [{ key: 'photos/a.jpg', data: 'abc', mediaType: 'image/jpeg' }],
    anchor: { type: 'line', line: 7, text: '完整段落' }
  })
})

test('persists and restores structured edit anchors for reconnect', () => {
  const storage = {}
  const previousWx = global.wx
  global.wx = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    connectSocket: () => ({ onOpen: () => {}, onMessage: () => {}, onError: () => {}, onClose: () => {}, send: () => {}, close: () => {} })
  }
  try {
    const session = edit.createSession('VoiceDrop-anchor', {})
    session.enqueue('改短一点', 0, [], { type: 'line', line: 3, text: '整行原文' })
    const stored = JSON.parse(storage['voicedrop.editqueue.VoiceDrop-anchor'])
    assert.deepEqual(stored[0].anchor, { type: 'line', line: 3, text: '整行原文' })
    assert.deepEqual(JSON.parse(edit.payloadFor(stored[0])).anchor, { type: 'line', line: 3, text: '整行原文' })
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
})

test('waits for article edit socket open before sending queued image edits', () => {
  const sent = []
  let openHandler = null
  const previousWx = global.wx
  global.wx = {
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    connectSocket: () => ({
      onOpen: (handler) => { openHandler = handler },
      onMessage: () => {},
      onError: () => {},
      onClose: () => {},
      send: (payload) => { sent.push(JSON.parse(payload.data)) },
      close: () => {}
    })
  }

  try {
    const session = edit.createSession('2026-06-24-131500', {})
    session.connect()
    session.enqueue('插入这张图片', 1, [{ key: 'photos/a.jpg', base64: 'abc' }])

    assert.equal(sent.length, 0)
    openHandler()
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0], {
      type: 'instruct',
      id: sent[0].id,
      text: '插入这张图片',
      articleIndex: 1,
      images: [{ key: 'photos/a.jpg', data: 'abc', mediaType: 'image/jpeg' }]
    })
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
})

test('persists queued image edits so photo insert can resume', () => {
  const storage = {}
  const previousWx = global.wx
  global.wx = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    connectSocket: () => ({
      onOpen: () => {},
      onMessage: () => {},
      onError: () => {},
      onClose: () => {},
      send: () => {},
      close: () => {}
    })
  }

  try {
    const session = edit.createSession('VoiceDrop-a', {})
    session.enqueue('插入这张图片', 0, [{ key: 'photos/a.jpg', base64: 'abc' }])
    const stored = JSON.parse(storage['voicedrop.editqueue.VoiceDrop-a'])

    assert.equal(stored.length, 1)
    assert.deepEqual(stored[0].images, [{ key: 'photos/a.jpg', base64: 'abc' }])
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
})

test('parses article edit updated messages through shared agent message contract', () => {
  const doc = edit.updatedDocFromMessage('{"type":"updated","doc":{"articles":[{"title":"A","body":"B"}]}}')
  assert.equal(doc.articles[0].title, 'A')
  assert.equal(doc.articles[0].body, 'B')
  assert.equal(edit.updatedDocFromMessage('{"type":"hello"}'), null)
})

test('reconciles snapshot queue done status and applies snapshot article', () => {
  const storage = {}
  let messageHandler = null
  let updated = null
  const queues = []
  const states = []
  const previousWx = global.wx
  global.wx = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    connectSocket: () => ({
      onOpen: (handler) => { handler() },
      onMessage: (handler) => { messageHandler = handler },
      onError: () => {},
      onClose: () => {},
      send: () => {},
      close: () => {}
    })
  }

  try {
    const session = edit.createSession('VoiceDrop-a', {
      onUpdated: (doc) => { updated = doc },
      onQueueChanged: (queue) => { queues.push(queue) },
      onState: (state) => { states.push(state) }
    })
    session.enqueue('插入这张图片', 0, [{ key: 'photos/a.jpg', base64: 'abc' }])
    const id = session.queue()[0].id

    messageHandler({
      data: JSON.stringify({
        type: 'snapshot',
        article: { articles: [{ title: 'A', body: '正文\n\n[[photo:photos/a.jpg]]' }] },
        queue: [{ id, status: 'done' }]
      })
    })

    assert.equal(updated.articles[0].body, '正文\n\n[[photo:photos/a.jpg]]')
    assert.deepEqual(session.queue(), [])
    assert.equal(storage['voicedrop.editqueue.VoiceDrop-a'], undefined)
    assert.equal(queues.at(-1).length, 0)
    assert.equal(states.at(-1), '已连接')
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
})

test('resubmits local edit requests missing from snapshot queue', () => {
  const sent = []
  let messageHandler = null
  const previousWx = global.wx
  global.wx = {
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    connectSocket: () => ({
      onOpen: (handler) => { handler() },
      onMessage: (handler) => { messageHandler = handler },
      onError: () => {},
      onClose: () => {},
      send: (payload) => { sent.push(JSON.parse(payload.data)) },
      close: () => {}
    })
  }

  try {
    const session = edit.createSession('VoiceDrop-a', {})
    session.enqueue('插入这张图片', 0, [{ key: 'photos/a.jpg', base64: 'abc' }])
    sent.length = 0

    messageHandler({ data: JSON.stringify({ type: 'snapshot', queue: [] }) })

    assert.equal(sent.length, 1)
    assert.equal(sent[0].text, '插入这张图片')
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
})

test('creates photo insert instruction for all photo markers', () => {
  assert.equal(
    photo.instructionForKeys(['photos/a.jpg', 'photos/b.jpg']),
    '我刚拍了这2张照片，请把每一张都插入文章里最合适的位置。每张照片用它自己的标记（原样写进正文，放在和场景最相符的段落附近）：[[photo:photos/a.jpg]]、[[photo:photos/b.jpg]]。所有照片必须全部插入，不能遗漏。'
  )
})

test('computes Android-compatible photo offsets from recording session time', () => {
  assert.equal(photo.offsetSeconds('2026-06-24-131500', new Date(2026, 5, 24, 13, 15, 42)), 42)
  assert.equal(photo.offsetSeconds('2026-06-24-131500', new Date(2026, 5, 24, 13, 14, 59)), 0)
  assert.equal(photo.offsetSeconds('bad-session', new Date(2026, 5, 24, 13, 15, 42)), 0)
  assert.equal(photo.offsetSeconds('2026-06-24-131500', null), 0)
})

test('derives photo offset from Mini Program media metadata with fallback index', () => {
  const capture = new Date(2026, 5, 24, 13, 16, 2)
  assert.equal(photo.photoOffsetForFile('2026-06-24-131500', { time: new Date(2026, 5, 24, 13, 16, 0) }, 7), 60)
  assert.equal(photo.photoOffsetForFile('2026-06-24-131500', { createTime: Math.floor(capture.getTime() / 1000) }, 7), 62)
  assert.equal(photo.photoOffsetForFile('2026-06-24-131500', { lastModified: capture.getTime() }, 7), 62)
  assert.equal(photo.photoOffsetForFile('2026-06-24-131500', {}, 7), 7)
})

test('computes Android-compatible image sample size for large photos', () => {
  assert.equal(photo.sampleSizeForBounds(8064, 6048, 1200), 8)
  assert.equal(photo.sampleSizeForBounds(900, 600, 1200), 1)
  assert.equal(photo.sampleSizeForBounds(0, 6048, 1200), 1)
})

test('provides builtin longpress text and image menu instructions', () => {
  const doc = uiConfig.builtin()
  const textMenu = uiConfig.menu(doc, 'voice-editor', 'text')
  const imageMenu = uiConfig.menu(doc, 'voice-editor', 'image')
  assert.equal(textMenu.groups[0][0].label, '改写这段')
  assert.equal(textMenu.groups[1][0].children[0].label, '公众号题图')
  assert.equal(imageMenu.groups[0][0].children[0].label, '卡通')
  assert.equal(uiConfig.fill('第{{LINE}}行：{{QUOTE}}', 'LINE', 3, 'QUOTE', '开头'), '第3行：开头')
  assert.equal(uiConfig.quotePrefix('这是一段很长很长很长很长的文字再多一点'), '这是一段很长很长很长很长的文字')
})

test('matches Android popup menu positioning helpers', () => {
  assert.equal(popupMenuPosition.rightAlignedXOffset(48, 260), -212)
  assert.equal(popupMenuPosition.upwardYOffset(70), -70)
})

test('navigates article versions by version head ids', () => {
  const nav = versionNav.state({ head: 5, versions: [{ v: 2 }, { v: 5 }, { v: 9 }] }, false)
  assert.equal(nav.canUndo, true)
  assert.equal(nav.canRedo, true)
  assert.equal(nav.undoHead, 2)
  assert.equal(nav.redoHead, 9)
  assert.deepEqual(versionNav.state({ head: 5, versions: [{ v: 2 }, { v: 5 }, { v: 9 }] }, true), {
    head: 5,
    heads: [2, 5, 9],
    undoHead: null,
    redoHead: null,
    canUndo: false,
    canRedo: false
  })
})

test('tracks audio playback loading, progress, and completion', () => {
  let result = playback.requestPlay(playback.initial())
  assert.equal(result.accepted, true)
  assert.equal(result.state.mode, playback.MODE_LOADING)

  result = playback.requestPlay(result.state)
  assert.equal(result.accepted, false)

  const playing = playback.started()
  assert.equal(playing.mode, playback.MODE_PLAYING)
  assert.equal(playback.progress(500, 1000), 0.5)
  assert.equal(playback.progress(1500, 1000), 1)
  assert.deepEqual(playback.requestStop(playing).state, playback.initial())
  assert.deepEqual(playback.completed(), playback.initial())
})

test('maps generated article versions to style rewrite choices', () => {
  const generated = styleRewrite.generatedVersions({
    versions: [
      { v: 2, articles: [{ title: 'A', body: '<!-- style: 风格 v5 -->正文' }] },
      { v: 4, articles: [{ title: 'B', body: '正文' }] }
    ]
  })

  assert.equal(generated[5].v, 2)
  assert.equal(styleRewrite.buttonText(5, generated), '切换到 v5 风格')
  assert.equal(styleRewrite.buttonText(8, generated), '用 v8 重写本文')
  assert.match(styleRewrite.choiceLabel({ v: 5, style: '长长的风格说明文字长长的风格说明文字' }, generated), /^v5/)
})

test('maps generated article versions from any article style field like Android', () => {
  const generated = styleRewrite.generatedVersions({
    versions: [
      {
        v: 9,
        articles: [
          { title: 'A', body: '正文' },
          { title: 'B', body: '正文', style: 7 }
        ]
      }
    ]
  })

  assert.equal(generated[7].v, 9)
})
