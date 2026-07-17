const test = require('node:test')
const assert = require('node:assert/strict')

const command = require('../services/library-command')
const community = require('../services/community')
const agentMessage = require('../utils/agent-message')
const blockStore = require('../utils/block-store')
const communityTerms = require('../utils/community-terms')
const communityReply = require('../utils/community-reply')
const holdToTalk = require('../utils/hold-to-talk')
const pendingReplies = require('../utils/pending-replies')
const resumeRefresh = require('../utils/resume-refresh')

test('builds library command payload and control messages', () => {
  const payload = JSON.parse(command.payloadFor('cmd-1', '把第 1 篇分享到社区', [
    { n: 1, stem: 'VoiceDrop-a', title: '标题 A' }
  ]))
  assert.deepEqual(payload, {
    type: 'instruct',
    id: 'cmd-1',
    text: '把第 1 篇分享到社区',
    refs: [{ n: 1, stem: 'VoiceDrop-a', title: '标题 A' }]
  })
  assert.equal(command.confirmPayload('cmd-1'), '{"type":"confirm","id":"cmd-1"}')
  assert.equal(command.cancelPayload('cmd-1'), '{"type":"cancel","id":"cmd-1"}')
})

test('library command waits for socket open before sending queued instruction', () => {
  const originalWx = global.wx
  const sent = []
  let open
  let message
  let opened = false
  try {
    global.wx = {
      getStorageSync: () => '',
      setStorageSync: () => {},
      removeStorageSync: () => {},
      connectSocket: () => ({
        onOpen: (cb) => {
          open = () => {
            opened = true
            cb()
          }
        },
        onMessage: (cb) => { message = cb },
        onError: () => {},
        onClose: () => {},
        send: (opts) => {
          if (!opened) throw new Error('SocketTask.send:fail SocketTask.readyState is not OPEN')
          sent.push(JSON.parse(opts.data))
        },
        close: () => {}
      })
    }

    const session = command.createSession({})
    session.connect()
    assert.doesNotThrow(() => session.enqueue('分享第 1 篇', [{ n: 1, stem: 'a', title: 'A' }]))
    assert.equal(sent.length, 0)
    open()
    assert.equal(sent.length, 1)
    message({ data: JSON.stringify({ type: 'snapshot', queue: [] }) })
    assert.equal(sent[0].text, '分享第 1 篇')
  } finally {
    global.wx = originalWx
  }
})

test('matches Android hold-to-talk gesture cancellation rules', () => {
  assert.equal(holdToTalk.shouldCancel(500, 461, 40), false)
  assert.equal(holdToTalk.shouldCancel(500, 460, 40), true)
  assert.equal(holdToTalk.shouldCancel(500, 540, 40), false)
  assert.equal(holdToTalk.shouldAbortOnEnd(true, false), false)
  assert.equal(holdToTalk.shouldAbortOnEnd(false, false), false)
  assert.equal(holdToTalk.shouldAbortOnEnd(true, true), true)
  assert.equal(holdToTalk.shouldAbortOnEnd(false, true), true)
})

test('matches Android hold-to-talk transcript behavior', () => {
  const transcript = holdToTalk.createTranscript()
  assert.equal(transcript.bubbleText(), '在听…')
  transcript.accept('改一下标题', false)
  assert.equal(transcript.bestText(), '改一下标题')
  assert.equal(transcript.bubbleText(), '改一下标题')
  transcript.accept('把标题改得更温柔', true)
  assert.equal(transcript.bestText(), '把标题改得更温柔')
  transcript.accept('第二句', true)
  assert.equal(transcript.bestText(), '把标题改得更温柔 第二句')
  transcript.clear()
  assert.equal(transcript.bestText(), '')
})

test('matches Android library command status text priority', () => {
  assert.deepEqual(holdToTalk.commandStatus({
    commandTalking: true,
    commandCanceled: false,
    commandReply: '正在连接…',
    transcriptText: ''
  }), { text: '正在连接…', ok: true, kind: 'transcript' })
  assert.deepEqual(holdToTalk.commandStatus({
    commandTalking: true,
    commandCanceled: false,
    commandReply: '正在听写…',
    transcriptText: '分享到社区'
  }), { text: '分享到社区', ok: true, kind: 'transcript' })
  assert.deepEqual(holdToTalk.commandStatus({
    commandTalking: true,
    commandCanceled: true,
    commandReply: '分享到社区',
    transcriptText: '分享到社区'
  }), { text: '松手取消', ok: false, kind: 'error' })
  assert.deepEqual(holdToTalk.commandStatus({
    commandTalking: false,
    commandReply: '已完成',
    commandQueue: [{ text: '分享第 1 篇到社区' }]
  }), { text: '分享第 1 篇到社区', ok: true, kind: 'queue' })
  assert.deepEqual(holdToTalk.commandStatus({
    commandTalking: false,
    commandReply: '已完成',
    commandQueue: []
  }), { text: '', ok: true, kind: '' })
  assert.deepEqual(holdToTalk.commandStatus({
    commandTalking: false,
    commandReply: '已发布到社区',
    commandQueue: []
  }), { text: '已发布到社区', ok: true, kind: 'reply' })
  assert.deepEqual(holdToTalk.commandStatus({
    commandTalking: false,
    commandReply: '指令执行失败',
    commandReplyOk: false,
    commandQueue: []
  }), { text: '指令执行失败', ok: false, kind: 'error' })
})

test('hold-to-talk waits for ASR text that arrives after release', async () => {
  const transcript = holdToTalk.createTranscript()
  const waiting = transcript.waitForBestText(100)
  setTimeout(() => transcript.accept('分享第 1 篇到社区', true), 10)
  assert.equal(await waiting, '分享第 1 篇到社区')
})

test('hold-to-talk waits for a new final ASR result even when partial text already exists', async () => {
  const transcript = holdToTalk.createTranscript()
  const timers = []
  let resolved = false
  transcript.accept('删除第二', false)

  const waiting = transcript.waitForFinalText(1500, (callback, ms) => {
    timers.push({ callback, ms })
    return timers.length
  }, () => {})
  waiting.then(() => { resolved = true })
  await Promise.resolve()

  assert.equal(resolved, false)
  assert.equal(timers[0].ms, 1500)
  transcript.accept('删除第二篇文章', true)
  assert.equal(await waiting, '删除第二篇文章')
})

test('hold-to-talk waits for RecorderManager onStop before finishing ASR', async () => {
  const events = []
  const timers = []
  let stopHandler
  let resolved = false
  const recorder = {
    onStop(handler) { stopHandler = handler },
    offStop(handler) {
      assert.equal(handler, stopHandler)
      events.push('offStop')
    },
    stop() { events.push('stop') }
  }

  const waiting = holdToTalk.stopRecorderAndWait(recorder, 500, (callback, ms) => {
    timers.push({ callback, ms })
    return timers.length
  }, () => events.push('clearTimeout'))
  waiting.then(() => { resolved = true })
  await Promise.resolve()

  assert.deepEqual(events, ['stop'])
  assert.equal(resolved, false)
  assert.equal(timers[0].ms, 500)
  stopHandler({})
  await waiting
  assert.deepEqual(events, ['stop', 'offStop', 'clearTimeout'])
})

test('matches Android resume refresh redraw policy', () => {
  assert.equal(resumeRefresh.shouldRedrawOnResume(false, true), false)
  assert.equal(resumeRefresh.shouldRedrawOnResume(false, false), true)
  assert.equal(resumeRefresh.shouldRedrawOnResume(true, false), false)
  assert.equal(resumeRefresh.shouldRedrawOnResume(true, true), false)
})

test('parses status and device link messages', () => {
  assert.deepEqual(agentMessage.status('{"type":"status_update","stem":"VoiceDrop-a","status":"mining"}'), {
    stem: 'VoiceDrop-a',
    status: 'mining'
  })
  assert.deepEqual(agentMessage.linkRequest('{"type":"link_request","pairingId":"p1","code":"123456","pubkey":"pk"}'), {
    pairingId: 'p1',
    code: '123456',
    pubkey: 'pk'
  })
  assert.deepEqual(agentMessage.linkRelease('{"type":"link_release","pairingId":"p1"}'), { pairingId: 'p1' })
})

test('normalizes community share result errors', () => {
  assert.deepEqual(community.normalizeShareResult(200, { shareId: 'share-1' }), {
    ok: true,
    shareId: 'share-1',
    code: 200,
    error: '',
    needsWechatSignin: false
  })
  assert.deepEqual(community.normalizeShareResult(403, { error: 'needs_wechat_signin' }), {
    ok: false,
    shareId: '',
    code: 403,
    error: 'needs_wechat_signin',
    needsWechatSignin: true
  })
  assert.deepEqual(community.normalizeShareResult(403, { error: 'needs_apple_signin' }), {
    ok: false,
    shareId: '',
    code: 403,
    error: 'needs_apple_signin',
    needsWechatSignin: true
  })
  assert.equal(community.normalizeShareResult(404, { error: 'article not found' }).articleNotFound, true)
})

test('builds Android-compatible community ranking payload with reply counts', () => {
  assert.deepEqual(community.rankPayload([
    { shareId: 'root-1', firstSharedAt: 10, authorName: 'Alice' },
    { shareId: 'reply-1', firstSharedAt: 11, author: 'Bob', replyTo: 'root-1' },
    { shareId: 'reply-2', firstSharedAt: 12, author: '', replyTo: 'root-1' },
    { shareId: 'root-2', firstSharedAt: 13, author: 'Carol' }
  ]), {
    posts: [
      { shareId: 'root-1', firstSharedAt: 10, author: 'Alice', replyCount: 2 },
      { shareId: 'reply-1', firstSharedAt: 11, author: 'Bob', replyCount: 0 },
      { shareId: 'reply-2', firstSharedAt: 12, author: '', replyCount: 0 },
      { shareId: 'root-2', firstSharedAt: 13, author: 'Carol', replyCount: 0 }
    ]
  })
  assert.deepEqual(community.rankPayload(null), { posts: [] })
})

test('normalizes the unified community feed with Android-compatible tabs and counts', () => {
  const feed = community.normalizeUnifiedFeed({
    posts: [
      { shareId: 'latest', firstSharedAt: 30, likes: 2, replies: 1, coverPhotoKey: 'users/a/photos/1.jpg' },
      { shareId: 'reply', firstSharedAt: 20, replyTo: 'root', liked: true },
      { shareId: 'root', firstSharedAt: 10, likes: 4 }
    ],
    order: ['root', 'latest', 'reply']
  })

  assert.deepEqual(feed.recommended.map((post) => post.shareId), ['root', 'latest', 'reply'])
  assert.deepEqual(feed.latest.map((post) => post.shareId), ['latest', 'reply', 'root'])
  assert.deepEqual(feed.likes, { latest: 2, reply: 0, root: 4 })
  assert.deepEqual(feed.replies, { latest: 1 })
  assert.deepEqual(feed.liked, ['reply'])
  assert.equal(feed.unified, true)
})

test('community recommendation requests keep using the anonymous token after WeChat sign-in', () => {
  const originalWx = global.wx
  const values = {
    'voicedrop.auth.anon': 'anon_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'voicedrop.auth.session': 'headerpart.payloadpart.signaturepart'
  }
  global.wx = {
    getStorageSync(key) { return values[key] || '' },
    setStorageSync(key, value) { values[key] = value },
    removeStorageSync(key) { delete values[key] }
  }
  try {
    assert.equal(community.recoBearer(), values['voicedrop.auth.anon'])
  } finally {
    global.wx = originalWx
  }
})

test('splits community cards greedily without changing feed order', () => {
  const cards = [
    { shareId: 'a', title: 'A' },
    { shareId: 'b', title: 'B' },
    { shareId: 'c', title: 'C' },
    { shareId: 'd', title: 'D' }
  ]

  const columns = community.masonryColumns(cards)

  assert.deepEqual(columns.left.map((post) => post.shareId), ['a', 'c'])
  assert.deepEqual(columns.right.map((post) => post.shareId), ['b', 'd'])
})

test('legacy community feed keeps latest order and exposes reply posts', () => {
  const feed = community.legacyFeed([
    { shareId: 'latest', firstSharedAt: 30 },
    { shareId: 'reply', firstSharedAt: 20, replyTo: 'root' },
    { shareId: 'root', firstSharedAt: 10 }
  ], { order: ['root', 'latest', 'reply'], liked: [], likes: { root: 3 } })

  assert.deepEqual(community.postsForTab(feed, 'recommended').map((post) => post.shareId), ['root', 'latest', 'reply'])
  assert.deepEqual(community.postsForTab(feed, 'latest').map((post) => post.shareId), ['latest', 'reply', 'root'])
  assert.deepEqual(community.postsForTab(feed, 'replies').map((post) => post.shareId), ['reply'])
  assert.equal(feed.replies.root, 1)
  assert.equal(feed.likes.root, 3)
})

test('community keeps prompt metadata and exposes a dedicated prompt tab', () => {
  const feed = community.legacyFeed([
    { shareId: 'article', firstSharedAt: 2 },
    { shareId: 'prompt', firstSharedAt: 1, kind: 'prompt' }
  ], { order: ['article', 'prompt'] })

  const prompt = community.postsForTab(feed, 'prompts')[0]
  assert.equal(prompt.shareId, 'prompt')
  assert.equal(prompt.isPrompt, true)
  assert.equal(prompt.promptCode, '')
  assert.deepEqual(prompt.appliesTo, [])
  assert.equal(community.cardPosts(feed, 'prompts')[0].isPrompt, true)
})

test('normalizes community detail posts with inline articles', () => {
  const post = community.postFromDetail({
    shareId: ' share-1 ',
    title: ' 社区标题 ',
    authorName: ' Alice ',
    articleKey: ' articles/a.json ',
    sharedAt: 12.5,
    replyTo: ' root-1 ',
    owner: 'users/anon-author/',
    articles: [{ title: '正文标题', body: '正文内容' }]
  })

  assert.equal(post.shareId, 'share-1')
  assert.equal(post.author, 'Alice')
  assert.equal(post.articleKey, 'articles/a.json')
  assert.equal(post.firstSharedAt, 12.5)
  assert.equal(post.title, '社区标题')
  assert.equal(post.replyTo, 'root-1')
  assert.equal(post.doc.owner, 'users/anon-author/')
  assert.equal(post.doc.articles.length, 1)
  assert.equal(post.doc.articles[0].title, '正文标题')
  assert.equal(post.doc.articles[0].body, '正文内容')
})

test('persists community terms agreement', () => {
  const storage = communityTerms.memoryStorage()
  assert.equal(communityTerms.agreed(storage), false)
  communityTerms.setAgreed(true, storage)
  assert.equal(communityTerms.agreed(storage), true)
  communityTerms.setAgreed(false, storage)
  assert.equal(communityTerms.agreed(storage), false)
})

test('builds community reply continuation previews', () => {
  const reply = {
    doc: {
      articles: [{
        body: '# 标题\n\n正文 [[photo:photos/a.jpg]] > 引用 `code` - 列表'
      }]
    }
  }
  const model = communityReply.viewModel(reply)
  assert.equal(model.replyLabel, '续文')
  assert.equal(model.preview, '标题 正文 引用 code 列表')
  assert.equal(model.hasMore, false)

  const long = communityReply.viewModel({ doc: { articles: [{ body: 'x'.repeat(220) }] } })
  assert.equal(long.hasMore, true)
})

test('manages local blocked authors', () => {
  const storage = blockStore.memoryStorage()
  blockStore.block('Alice', storage)
  blockStore.block('Bob', storage)
  assert.equal(blockStore.isBlocked('Alice', storage), true)
  assert.deepEqual(blockStore.blockedList(storage), ['Alice', 'Bob'])
  blockStore.unblock('Alice', storage)
  assert.equal(blockStore.isBlocked('Alice', storage), false)
})

test('publishes ready pending replies and clears successful mappings', async () => {
  const storage = pendingReplies.memoryStorage()
  pendingReplies.put('VoiceDrop-a.m4a', 'share-1', storage)
  pendingReplies.put('VoiceDrop-b.m4a', 'share-2', storage)
  const published = await pendingReplies.publishReadyReplies([
    { audioName: 'VoiceDrop-a.m4a', hasArticles: true },
    { audioName: 'VoiceDrop-b.m4a', hasArticles: false }
  ], async () => true, storage)

  assert.equal(published, 1)
  assert.equal(pendingReplies.replyTo('VoiceDrop-a.m4a', storage), null)
  assert.equal(pendingReplies.replyTo('VoiceDrop-b.m4a', storage), 'share-2')
})
