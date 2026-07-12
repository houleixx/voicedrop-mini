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
        onMessage: () => {},
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
  }), { text: '正在连接…', ok: true })
  assert.deepEqual(holdToTalk.commandStatus({
    commandTalking: true,
    commandCanceled: false,
    commandReply: '正在听写…',
    transcriptText: '分享到社区'
  }), { text: '分享到社区', ok: true })
  assert.deepEqual(holdToTalk.commandStatus({
    commandTalking: true,
    commandCanceled: true,
    commandReply: '分享到社区',
    transcriptText: '分享到社区'
  }), { text: '松手取消', ok: false })
  assert.deepEqual(holdToTalk.commandStatus({
    commandTalking: false,
    commandReply: '已完成',
    commandQueue: [{ text: '分享第 1 篇到社区' }]
  }), { text: '分享第 1 篇到社区', ok: true })
  assert.deepEqual(holdToTalk.commandStatus({
    commandTalking: false,
    commandReply: '已完成',
    commandQueue: []
  }), { text: '', ok: true })
  assert.deepEqual(holdToTalk.commandStatus({
    commandTalking: false,
    commandReply: '已发布到社区',
    commandQueue: []
  }), { text: '已发布到社区', ok: true })
})

test('hold-to-talk waits for ASR text that arrives after release', async () => {
  const transcript = holdToTalk.createTranscript()
  const waiting = transcript.waitForBestText(100)
  setTimeout(() => transcript.accept('分享第 1 篇到社区', true), 10)
  assert.equal(await waiting, '分享第 1 篇到社区')
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
