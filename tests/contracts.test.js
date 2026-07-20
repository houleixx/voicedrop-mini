const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../services/api')
const audio = require('../services/audio')
const library = require('../services/library')
const request = require('../services/request')
const settings = require('../services/settings')
const shareCollect = require('../services/share-collect')
const article = require('../utils/article')
const prefs = require('../utils/prefs')
const recording = require('../utils/recording')
const recordingQuality = require('../utils/recording-quality')
const theme = require('../utils/theme')
const usageFormat = require('../utils/usage-format')

test('encodes API paths by segment like Android', () => {
  assert.equal(api.path('articles/VoiceDrop-hello world.json'), 'articles/VoiceDrop-hello%20world.json')
  assert.equal(api.sharePage('abc123'), 'https://jianshuo.dev/voicedrop/abc123')
  assert.equal(api.downloadUrl('VoiceDrop-a.m4a'), 'https://jianshuo.dev/files/api/download/VoiceDrop-a.m4a')
  assert.equal(api.photoUrl('photos/a b.jpg'), 'https://jianshuo.dev/files/api/photo/photos/a%20b.jpg')
})

test('sends Mini Program platform header with authenticated requests', () => {
  assert.deepEqual(request.authHeader('token-1'), {
    Authorization: 'Bearer token-1',
    'X-VD-Platform': 'miniapp'
  })
  assert.deepEqual(request.authHeader('', { 'content-type': 'application/json' }), {
    'X-VD-Platform': 'miniapp',
    'content-type': 'application/json'
  })
})

test('formats usage ledger deductions with minus sign and red class', () => {
  assert.deepEqual(usageFormat.formatEntry({
    reason: '语音修改',
    suanli: 1.8,
    ts: '2026-07-08T05:53:00Z'
  }, 0), {
    reason: '语音修改',
    suanli: 1.8,
    ts: '2026-07-08T05:53:00Z',
    id: '2026-07-08T05:53:00Z',
    title: '语音修改',
    timeText: '2026年7月8日 13:53',
    amountText: '-1.8',
    amountClass: 'amount-negative'
  })

  assert.equal(usageFormat.formatEntry({ reason: '充值', suanli: 200 }, 1).amountText, '+200')
  assert.equal(usageFormat.formatEntry({ reason: '充值', suanli: 200 }, 1).amountClass, 'amount-positive')
})

test('formats zero-value non-credit usage as red without a negative zero sign', () => {
  const result = usageFormat.formatEntry({ reason: '语音转写', kind: 'spend', suanli: 0 }, 2)
  assert.equal(result.amountText, '0')
  assert.equal(result.amountClass, 'amount-negative')
})

test('formats usage summary signs, decimals, and count copy', () => {
  assert.deepEqual(usageFormat.formatSummaryRow({ reason: '活动赠送', suanli: 12.5, count: 2 }, 'grant', 0), {
    id: '活动赠送-grant-0',
    title: '活动赠送',
    countText: '2 笔',
    amountText: '+12.5',
    amountClass: 'amount-positive'
  })
  assert.equal(usageFormat.formatSummaryRow({ reason: '挖文章', suanli: 18, count: 1 }, 'spent', 0).amountText, '−18')
})

test('parses VoiceDrop recording names and labels status', () => {
  const rec = recording.fromRemoteFile({
    name: 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon.m4a',
    uploaded: '2026-06-18T06:31:00Z'
  }, new Set(['articles/VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon.json']))

  assert.equal(rec.stem, 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon')
  assert.equal(rec.durationLabel, '0m33s')
  assert.equal(rec.rowTitle, '周四·下午')
  assert.equal(rec.statusLabel, '已成文')
  assert.equal(recording.statusLabel({ phase: 'mining' }), '挖文章')
  assert.equal(recording.statusLabel({ blockReason: 'no-credit' }), '余额不足')
})

test('creates compatible recording names', () => {
  const date = new Date('2026-06-18T06:30:52.000Z')
  const name = recording.makeName(date, 33, '浦东新区')
  assert.match(name, /^VoiceDrop-2026-06-18-\d{6}-0m33s-Thu-(Morning|Afternoon|Noon|Evening|Night|LateNight|EarlyMorning)-浦东新区\.m4a$/)
})

test('matches Android recording period boundaries', () => {
  const at = (hour) => new Date(2026, 5, 18, hour, 0, 0)
  assert.equal(recording.period(at(4)), 'LateNight')
  assert.equal(recording.period(at(5)), 'EarlyMorning')
  assert.equal(recording.period(at(9)), 'Morning')
  assert.equal(recording.period(at(12)), 'Noon')
  assert.equal(recording.period(at(14)), 'Afternoon')
  assert.equal(recording.period(at(18)), 'Evening')
  assert.equal(recording.period(at(20)), 'Night')
  assert.equal(recording.period(at(23)), 'LateNight')
})

test('plans Android-compatible recording tag sidecar upload', () => {
  assert.deepEqual(audio.tagsSidecarUpload('VoiceDrop-2026-07-05-120000-0m1s.m4a', ['创业', ' 产品 ', '']), {
    key: 'articles/VoiceDrop-2026-07-05-120000-0m1s.tags',
    tags: ['创业', '产品']
  })
})

test('matches Android recording quality silent detection', () => {
  assert.equal(recordingQuality.looksSilent(80, 12), true)
  assert.equal(recordingQuality.looksSilent(1200, 12), false)
  assert.equal(recordingQuality.looksSilent(0, 0.4), false)
})

test('creates Android-compatible style extraction task names', () => {
  const now = new Date(2026, 6, 4, 9, 30, 0)
  assert.match(shareCollect.styleExtractTaskName(true, now), /^VoiceDrop-2026-07-04-093000-0m0s-Sat-Morning-TaskStyleExtract\.m4a$/)
  assert.match(shareCollect.styleExtractTaskName(false, now), /^VoiceDrop-2026-07-04-093000-0m0s-Sat-Morning-TaskStyleExtractKeep\.m4a$/)
  assert.ok(shareCollect.silentAudioData().length > 100)
})

test('builds Android-compatible style collection request body', () => {
  assert.deepEqual(shareCollect.collectStyleBody('web', '标题', '正文', 'mp.weixin.qq.com'), {
    type: 'web',
    title: '标题',
    text: '正文',
    source: 'mp.weixin.qq.com'
  })
})

test('uses shared text first line as style collection fallback title', () => {
  assert.equal(shareCollect.titleForText('\n 第一行标题 \n正文', 'fallback'), '第一行标题')
  assert.equal(shareCollect.titleForText('\n\n', 'fallback'), 'fallback')
  assert.equal(shareCollect.titleForText('123456789012345678901234567890123456789012345', 'fallback').length, 40)
})

test('plans Android-compatible image article generation uploads', () => {
  const plan = shareCollect.imageArticlePlan(2, new Date(2026, 6, 4, 9, 30, 0))
  assert.match(plan.audioName, /^VoiceDrop-2026-07-04-093000-0m0s-Sat-Morning\.m4a$/)
  assert.equal(plan.sessionTs, '2026-07-04-093000')
  assert.equal(plan.photoKeys.length, 2)
  assert.match(plan.photoKeys[0], /^photos\/2026-07-04-093000\/0-[0-9a-z]{3}\.jpg$/)
  assert.match(plan.photoKeys[1], /^photos\/2026-07-04-093000\/1-[0-9a-z]{3}\.jpg$/)
})

test('plans Android-compatible audio file generation uploads', () => {
  const plan = shareCollect.audioArticlePlan(125, new Date(2026, 6, 4, 9, 30, 0))
  assert.match(plan.audioName, /^VoiceDrop-2026-07-04-093000-2m5s-Sat-Morning\.m4a$/)
})

test('builds dynamic recording tags and filters records by tag', () => {
  const records = [
    { stem: 'a', tags: ['idea', 'work'] },
    { stem: 'b', tags: ['idea'] },
    { stem: 'c', tags: [] },
    { stem: 'd', tags: ['family', 'work'] }
  ]

  assert.deepEqual(recording.tagsFromRecords(records), ['family', 'idea', 'work'])
  assert.deepEqual(recording.filterByTag(records, ''), records)
  assert.deepEqual(recording.filterByTag(records, 'work').map((rec) => rec.stem), ['a', 'd'])
})

test('parses legacy and multi-article documents', () => {
  const legacy = article.parseDoc(JSON.stringify({ title: '旧格式', body: '正文' }))
  assert.equal(legacy.articles[0].title, '旧格式')
  assert.equal(legacy.articles[0].body, '正文')

  const modern = article.parseDoc(JSON.stringify({
    id: 'share-id',
    transcript: '口述',
    tags: ['日记'],
    photos: ['photos/a.jpg'],
    articles: [{ title: '标题', body: '第一段\n\n第二段', style: 2 }]
  }))
  assert.equal(modern.id, 'share-id')
  assert.equal(modern.tags[0], '日记')
  assert.deepEqual(article.bodyBlocks(modern.articles[0].body), [
    { type: 'paragraph', text: '第一段' },
    { type: 'paragraph', text: '第二段' }
  ])
  assert.deepEqual(article.bodyBlocks('第一行\n第二行'), [
    { type: 'paragraph', text: '第一行' },
    { type: 'paragraph', text: '第二行' }
  ])
  assert.equal(article.bodyWithoutDuplicateTitle({
    title: '标题',
    body: '# 标题\n\n正文'
  }), '正文')
})

test('maps wechat publish errors to user-facing Chinese messages', () => {
  assert.equal(article.wechatMessage(45004), '摘要太短，正文写长一点再发')
  assert.equal(article.wechatMessage(40164), '公众号配置有误，检查 AppID/Secret 或 IP 白名单')
  assert.equal(article.wechatMessage(null, 'bad credential'), '发布失败：bad credential')
})

test('builds Android-compatible restyle request bodies', () => {
  assert.deepEqual(library.restyleRequestBody('VoiceDrop-2026-07-01-120000-0m1s', null), {
    stem: 'VoiceDrop-2026-07-01-120000-0m1s'
  })
  assert.deepEqual(library.restyleRequestBody('VoiceDrop-2026-07-01-120000-0m1s', 8), {
    stem: 'VoiceDrop-2026-07-01-120000-0m1s',
    styleV: 8
  })
})

test('formats restyle backend failures with HTTP status and body detail', () => {
  assert.equal(library.restyleErrorMessage({
    statusCode: 500,
    data: { error: 'internal-error' }
  }), 'HTTP 500: internal-error')
  assert.equal(library.restyleErrorMessage({
    statusCode: 422,
    data: { reason: 'no-style' }
  }), 'HTTP 422: no-style')
})

test('identifies wechat publish config failures like Android', () => {
  assert.equal(library.wechatPublishIsConfigError({ notConfigured: true }), true)
  assert.equal(library.wechatPublishIsConfigError({ errcode: 40013 }), true)
  assert.equal(library.wechatPublishIsConfigError({ errcode: 40125 }), true)
  assert.equal(library.wechatPublishIsConfigError({ errcode: 40164 }), true)
  assert.equal(library.wechatPublishIsConfigError({ errcode: 45009 }), false)
})

test('recording deletion succeeds when audio deletion succeeds', () => {
  assert.equal(library.recordingDeleteSucceeded(true, false, false, false), true)
  assert.equal(library.recordingDeleteSucceeded(false, true, true, true), false)
})

test('builds Android-compatible style selection request body', () => {
  assert.deepEqual(settings.styleSelectionBody([12, 9, 3]), { styles: [12, 9, 3] })
  assert.deepEqual(settings.styleSelectionBody([]), { styles: [] })
})

test('builds Android-compatible profile name request body', () => {
  assert.deepEqual(settings.nameBody('  王小明  '), { name: '王小明' })
  assert.deepEqual(settings.nameBody(null), { name: '' })
})

test('normalizes Android-compatible style response values', () => {
  assert.deepEqual(settings.styleFromResponse({
    style: '  温柔、克制  ',
    name: '王小明',
    styles: [12, '9', null, 'x', 3]
  }), {
    style: '  温柔、克制  ',
    name: '王小明',
    styles: [12, 9, 0, 0, 3]
  })
  assert.deepEqual(settings.styleFromResponse(null), { style: '', name: '', styles: [] })
})

test('exposes official WeChat credential help URL like Android', () => {
  assert.equal(
    settings.WECHAT_CREDENTIAL_HELP_URL,
    'https://developers.weixin.qq.com/console/'
  )
})

test('validates WeChat credential formats and relay errors like iOS', () => {
  assert.equal(settings.validateWechatCreds(
    'wx1234567890abcdef', '0123456789abcdef0123456789abcdef'), '')
  assert.match(settings.validateWechatCreds(
    'wx123', '0123456789abcdef0123456789abcdef'), /AppID/)
  assert.match(settings.validateWechatCreds(
    'wx1234567890abcdef', 'ABCDEF0123456789ABCDEF0123456789'), /AppSecret/)
  assert.equal(settings.wechatValidationMessage({ ok: true }), '')
  assert.match(settings.wechatValidationMessage({ ok: false, errcode: 40164 }), /IP 白名单/)
  assert.equal(settings.wechatValidationMessage({ ok: false, errcode: 40125 }), 'AppSecret 无效')
})

test('matches Android theme color tokens', () => {
  assert.equal(theme.ACCENT, '#d8593b')
  assert.equal(theme.RED, '#e5392e')
  assert.equal(theme.SECONDARY, '#8a8175')
  assert.equal(theme.FAINT, '#b8ae9e')
})
