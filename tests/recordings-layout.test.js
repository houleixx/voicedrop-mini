const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')
const holdToTalk = require('../utils/hold-to-talk')

const root = path.join(__dirname, '..')

function freshRecordingsPage(wxOverrides) {
  let page
  const app = { globalData: {} }
  global.getApp = () => app
  global.Page = (definition) => { page = definition }
  global.wx = Object.assign({
    showLoading() {},
    hideLoading() {},
    showToast() {},
    stopPullDownRefresh() {}
  }, wxOverrides || {})
  const pagePath = require.resolve('../pages/recordings/index')
  delete require.cache[pagePath]
  const helpers = require(pagePath)
  return { page, app, helpers }
}

function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  return match ? match[1] : ''
}

test('home loading states show a spinner above the loading text', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/recordings/index.wxss'), 'utf8')
  const loadingNotice = ruleBody(css, '.loading-notice')
  const spinner = ruleBody(css, '.loading-spinner')

  assert.match(wxml, /<view wx:elif="\{\{loading\}\}" class="notice loading-notice">\s*<view class="loading-spinner" aria-hidden="true"><\/view>\s*<text>加载中\.\.\.<\/text>\s*<\/view>/)
  assert.match(wxml, /<view wx:elif="\{\{communityLoading \|\| !communityLoaded\}\}" class="notice loading-notice">\s*<view class="loading-spinner" aria-hidden="true"><\/view>\s*<text>正在加载\.\.\.<\/text>\s*<\/view>/)
  assert.match(loadingNotice, /display:\s*flex;/)
  assert.match(loadingNotice, /flex-direction:\s*column;/)
  assert.match(spinner, /border-top-color:\s*#c7432f;/)
  assert.match(spinner, /animation:\s*loading-spin\s+0\.8s\s+linear\s+infinite;/)
  assert.match(css, /@keyframes loading-spin\s*\{[\s\S]*transform:\s*rotate\(360deg\);[\s\S]*\}/)
})

test('community starts in loading state instead of showing its empty state before the first response', () => {
  const { page } = freshRecordingsPage()
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')

  assert.equal(page.data.communityLoaded, false)
  assert.equal(page.data.communityPosts.length, 0)
  assert.match(wxml, /wx:elif="\{\{communityLoading \|\| !communityLoaded\}\}"/)
  assert.match(wxml, /wx:elif="\{\{communityPosts\.length === 0\}\}"/)
})

test('recordings restores a cached snapshot before starting its silent refresh', () => {
  const library = require('../services/library')
  const originalCachedRecordings = library.cachedRecordings
  const source = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  library.cachedRecordings = () => [{
    stem,
    audioName: `${stem}.m4a`,
    uploaded: '2026-06-18T06:31:00Z',
    hasArticles: true,
    tags: ['工作'],
    articleTitle: '缓存文章',
    rowTitle: '缓存文章'
  }]

  try {
    const { page } = freshRecordingsPage()
    const coverLoads = []
    const ctx = Object.assign({}, page, {
      data: Object.assign({}, page.data),
      topLevelUiRendered: false,
      setData(update) { Object.assign(this.data, update) },
      loadRecordingCovers(records) { coverLoads.push(records) },
      commandSession: { setRefs() {} }
    })

    assert.equal(page.restoreCachedRecordings.call(ctx), true)
    assert.equal(ctx.topLevelUiRendered, true)
    assert.equal(ctx.data.loading, false)
    assert.equal(ctx.data.records[0].rowTitle, '缓存文章')
    assert.deepEqual(ctx.data.homeTags, ['工作'])
    assert.equal(coverLoads.length, 1)
    assert.match(source, /const restored = this\.restoreCachedRecordings\(\)\s+this\.load\(restored \? \{ silent: true, keepDataOnError: true \} : undefined\)/)
  } finally {
    library.cachedRecordings = originalCachedRecordings
  }
})

test('recordings first onShow does not duplicate the refresh already started by onLoad', () => {
  const { page } = freshRecordingsPage()
  let loads = 0
  const ctx = Object.assign({}, page, {
    data: Object.assign({}, page.data),
    _awaitingInitialShow: true,
    drainPendingRecordingUploads() {},
    resetAccountSessionsIfNeeded() {},
    applyPendingHomeTab() {},
    currentCommandRefs: () => [],
    statusSession: { connect() {} },
    commandSession: { connect() {}, setRefs() {} },
    load() { loads += 1 }
  })

  page.onShow.call(ctx)

  assert.equal(loads, 0)
  assert.equal(ctx._awaitingInitialShow, false)
})

test('community resume refreshes only after a dirty detail result', () => {
  const { page, app } = freshRecordingsPage()
  let communityLoads = 0
  const ctx = Object.assign({}, page, {
    data: Object.assign({}, page.data, { activeTab: 'community', communityLoaded: true }),
    initialLoadStarted: true,
    topLevelUiRendered: true,
    showPendingRecordingUploads() {},
    drainPendingRecordingUploads() {},
    resetAccountSessionsIfNeeded() {},
    applyPendingHomeTab() {},
    statusSession: null,
    commandSession: null,
    currentCommandRefs: () => [],
    consumeCommunityModeration() {},
    loadCommunity() { communityLoads += 1 },
    load() {}
  })

  page.onShow.call(ctx)
  assert.equal(communityLoads, 0)

  app.globalData.communityFeedDirty = true
  page.onShow.call(ctx)
  assert.equal(communityLoads, 1)
  assert.equal(app.globalData.communityFeedDirty, undefined)
})

test('community resume waits for a pending like before refreshing', async () => {
  const { page, app } = freshRecordingsPage()
  let releaseLike
  const pendingLike = new Promise((resolve) => { releaseLike = resolve })
  let communityLoads = 0
  const ctx = Object.assign({}, page, {
    data: Object.assign({}, page.data, { activeTab: 'community', communityLoaded: true }),
    initialLoadStarted: true,
    topLevelUiRendered: true,
    showPendingRecordingUploads() {},
    drainPendingRecordingUploads() {},
    resetAccountSessionsIfNeeded() {},
    applyPendingHomeTab() {},
    statusSession: null,
    commandSession: null,
    currentCommandRefs: () => [],
    consumeCommunityModeration() {},
    loadCommunity() { communityLoads += 1 },
    load() {}
  })

  app.globalData.communityFeedDirty = true
  app.globalData.communityLikePending = pendingLike
  page.onShow.call(ctx)
  assert.equal(communityLoads, 0)

  releaseLike()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(communityLoads, 1)
  assert.equal(app.globalData.communityLikePending, undefined)
})

test('recordings serializes overlapping refresh triggers into one follow-up request', async () => {
  const library = require('../services/library')
  const originalList = library.list
  const pending = []
  let listCalls = 0
  library.list = () => {
    listCalls += 1
    return new Promise((resolve) => pending.push(resolve))
  }

  try {
    const { page } = freshRecordingsPage()
    const ctx = Object.assign({}, page, {
      data: Object.assign({}, page.data),
      setData(update) { Object.assign(this.data, update) },
      repairPhotoMarkers() {},
      loadRecordingCovers() {},
      enrichRecordingMeta() {},
      publishPendingReplies() {}
    })
    const options = { silent: true, keepDataOnError: true, skipPhotoRepair: true }
    const first = page.load.call(ctx, options)
    const second = page.load.call(ctx, options)
    const third = page.load.call(ctx, options)

    assert.equal(listCalls, 1)
    pending.shift()([])
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(listCalls, 2)
    pending.shift()([])
    await Promise.all([first, second, third])
    assert.equal(listCalls, 2)
  } finally {
    library.list = originalList
  }
})

test('recordings load starts photo marker repair in the background before enriching metadata', () => {
  const source = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
  const start = source.indexOf('  async load(options) {')
  const end = source.indexOf('  async enrichRecordingMeta(', start)
  const loadSource = source.slice(start, end)

  assert.ok(start >= 0 && end > start)
  assert.match(loadSource, /const records = this\.withPendingRecordingUploads\(await library\.list\(\)\)\s+if \(!options\?\.skipPhotoRepair\) this\.repairPhotoMarkers\(records\)/)
  assert.doesNotMatch(loadSource, /await (?:this\.)?repairPhotoMarkers/)
  assert.ok(
    loadSource.indexOf('this.repairPhotoMarkers(records)') <
      loadSource.indexOf('this.enrichRecordingMeta(records, recordMetaLoadId)')
  )
})

test('completed background photo repair silently reloads the repaired article once', async () => {
  const photoMarkerRepair = require('../services/photo-marker-repair')
  const originalRepairReady = photoMarkerRepair.repairReady
  const records = [{ stem: 'VoiceDrop-photo', hasArticles: true }]
  const reloads = []
  photoMarkerRepair.repairReady = async (value) => {
    assert.equal(value, records)
    return 1
  }

  try {
    const { page } = freshRecordingsPage()
    const ctx = Object.assign({}, page, {
      _pageUnloaded: false,
      load: async (options) => { reloads.push(options); return true }
    })

    await page.repairPhotoMarkers.call(ctx, records)

    assert.deepEqual(reloads, [{
      silent: true,
      keepDataOnError: true,
      skipPhotoRepair: true
    }])
    assert.equal(ctx._photoMarkerRepair, null)
  } finally {
    photoMarkerRepair.repairReady = originalRepairReady
  }
})

test('home recreates authenticated sockets after the account bearer changes', () => {
  const events = []
  const { page } = freshRecordingsPage({
    getStorageSync(key) {
      return key === 'voicedrop.auth.anon' ? 'anon_new_account' : ''
    },
    setStorageSync() {}
  })
  const ctx = Object.assign({}, page, {
    _socketBearer: 'anon_old_account',
    data: Object.assign({}, page.data),
    setData(update) { Object.assign(this.data, update) },
    statusSession: { close() { events.push('close-status') } },
    commandSession: { close() { events.push('close-command') } },
    createStatusSession() { events.push('create-status') },
    createCommandSession() { events.push('create-command') },
    _libraryCommandConfirms: [{ id: 'old' }],
    _activeLibraryCommandConfirm: { id: 'old' }
  })

  assert.equal(page.resetAccountSessionsIfNeeded.call(ctx), true)
  assert.deepEqual(events, [
    'close-status',
    'close-command',
    'create-status',
    'create-command'
  ])
  assert.deepEqual(ctx._libraryCommandConfirms, [])
  assert.equal(ctx._activeLibraryCommandConfirm, null)
  assert.equal(ctx._socketBearer, 'anon_new_account')
})

test('community layout offsets follow the measured home tabs bottom', () => {
  const { helpers } = freshRecordingsPage()

  assert.deepEqual(helpers.layoutOffsets(147, 375), {
    scrollContentTop: 147,
    communityScrollContentTop: 191
  })
  assert.deepEqual(helpers.layoutOffsets(-1, 750), {
    scrollContentTop: 0,
    communityScrollContentTop: 88
  })
})

test('successful recording deletion removes local data without reloading the list', async () => {
  const library = require('../services/library')
  const originalDelete = library.deleteRecording
  const originalList = library.list
  const first = { stem: 'first', audioName: 'first.m4a', tags: ['工作'], hasArticles: true }
  const second = { stem: 'second', audioName: 'second.m4a', tags: ['生活'], hasArticles: true }
  let listCalls = 0
  library.deleteRecording = async () => true
  library.list = async () => {
    listCalls += 1
    return [second]
  }

  try {
    const { page } = freshRecordingsPage()
    const ctx = Object.assign({}, page, {
      data: Object.assign({}, page.data, {
        allRecords: [first, second],
        records: [first, second],
        homeTags: ['工作', '生活'],
        selectedTag: '',
        activeTab: 'recordings'
      }),
      setData(update) { Object.assign(this.data, update) },
      commandSession: { setRefs() {} }
    })

    await page.deleteRecording.call(ctx, first)

    assert.equal(listCalls, 0)
    assert.deepEqual(ctx.data.allRecords.map((rec) => rec.stem), ['second'])
    assert.deepEqual(ctx.data.records.map((rec) => rec.stem), ['second'])
    assert.deepEqual(ctx.data.homeTags, ['生活'])
  } finally {
    library.deleteRecording = originalDelete
    library.list = originalList
  }
})

test('recording deleted during metadata enrichment is not restored by the stale result', async () => {
  const library = require('../services/library')
  const originalEnrich = library.enrichArticleMeta
  const first = { stem: 'first', audioName: 'first.m4a', hasArticles: true, statusLabel: '旧状态' }
  const second = { stem: 'second', audioName: 'second.m4a', hasArticles: true, statusLabel: '旧状态' }
  let releaseEnrichment
  library.enrichArticleMeta = async (records) => {
    await new Promise((resolve) => { releaseEnrichment = resolve })
    records[0].articleTitle = '已删除录音的标题'
    records[0].rowTitle = '已删除录音的标题'
    records[1].articleTitle = '补全后的标题'
    records[1].rowTitle = '补全后的标题'
    records[1].tags = ['补全标签']
    records[1].coverPhotoKey = 'photos/second.jpg'
  }

  try {
    const { page } = freshRecordingsPage()
    const ctx = Object.assign({}, page, {
      data: Object.assign({}, page.data, {
        allRecords: [first, second],
        records: [first, second],
        selectedTag: '',
        activeTab: 'recordings'
      }),
      recordMetaLoadId: 7,
      setData(update) { Object.assign(this.data, update) },
      loadRecordingCovers() {},
      commandSession: { setRefs() {} }
    })

    const enriching = page.enrichRecordingMeta.call(ctx, [first, second], 7)
    ctx.data.allRecords = [{ ...second, statusLabel: '最新状态' }]
    ctx.data.records = ctx.data.allRecords.slice()
    releaseEnrichment()
    await enriching

    assert.deepEqual(ctx.data.allRecords.map((rec) => rec.stem), ['second'])
    assert.equal(ctx.data.allRecords[0].rowTitle, '补全后的标题')
    assert.deepEqual(ctx.data.allRecords[0].tags, ['补全标签'])
    assert.equal(ctx.data.allRecords[0].coverPhotoKey, 'photos/second.jpg')
    assert.equal(ctx.data.allRecords[0].statusLabel, '最新状态')
  } finally {
    library.enrichArticleMeta = originalEnrich
  }
})

test('recordings scroll view enables pull refresh for both home tabs', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/recordings/index.wxss'), 'utf8')

  assert.match(wxml, /<scroll-view[^>]*enhanced="\{\{true\}\}"/)
  assert.match(wxml, /<scroll-view[^>]*bounces="\{\{true\}\}"/)
  assert.match(wxml, /<scroll-view[^>]*refresher-enabled="\{\{true\}\}"/)
  assert.match(wxml, /<scroll-view[^>]*refresher-triggered="\{\{refreshing\}\}"/)
  assert.match(wxml, /<scroll-view[^>]*refresher-default-style="none"/)
  assert.match(wxml, /<scroll-view[^>]*refresher-threshold="72"/)
  assert.match(wxml, /<scroll-view[^>]*bindrefresherrefresh="onRefresherRefresh"/)
  assert.match(wxml, /<view slot="refresher" class="pull-refresh-indicator">\s*<view class="loading-spinner pull-refresh-spinner" aria-hidden="true"><\/view>\s*<\/view>/)
  assert.match(css, /\.pull-refresh-indicator\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;[^}]*height:\s*72px;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s)
  assert.match(css, /\.pull-refresh-spinner\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*flex:\s*0 0 30px;[^}]*position:\s*relative;[^}]*top:\s*8px;/s)
})

test('recording rows replace the waveform with an Android-style article cover', async () => {
  const library = require('../services/library')
  const originalOwnerScope = library.ownerScope
  const originalDownloadPhotoTemp = library.downloadPhotoTemp
  library.ownerScope = async () => 'users/anon-1/'
  library.downloadPhotoTemp = async (key, scope) => {
    assert.equal(key, 'photos/session/cover.jpg')
    assert.equal(scope, 'users/anon-1/')
    return 'wxfile://record-cover.jpg'
  }

  try {
    const { page } = freshRecordingsPage()
    const record = { stem: 'VoiceDrop-cover', coverPhotoKey: 'photos/session/cover.jpg' }
    const ctx = Object.assign({}, page, {
      recordCoverLoadId: 3,
      data: Object.assign({}, page.data, { allRecords: [record], records: [record] }),
      setData(update) { Object.assign(this.data, update) }
    })

    await page.loadRecordingCovers.call(ctx, [record], 3)

    assert.equal(ctx.data.allRecords[0].coverPhotoUrl, 'wxfile://record-cover.jpg')
    assert.equal(ctx.data.records[0].coverPhotoUrl, 'wxfile://record-cover.jpg')

    page.onRecordCoverError.call(ctx, { currentTarget: { dataset: { stem: record.stem } } })
    assert.equal(ctx.data.records[0].coverPhotoUrl, '')
  } finally {
    library.ownerScope = originalOwnerScope
    library.downloadPhotoTemp = originalDownloadPhotoTemp
  }

  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/recordings/index.wxss'), 'utf8')
  assert.match(wxml, /<image wx:if="\{\{item\.coverPhotoUrl\}\}" class="record-cover \{\{item\.coverPhotoIsBook \? 'book-cover-image' : ''\}\}"[^>]*mode="aspectFill"[^>]*binderror="onRecordCoverError"/s)
  assert.match(wxml, /<view wx:else class="record-icon"/)
  assert.match(css, /\.record-cover\s*\{[^}]*width:\s*88rpx;[^}]*height:\s*88rpx;[^}]*border-radius:\s*20rpx;/s)
})

test('recording rows prefer the dedicated cover and remember misses before using the first photo', async () => {
  const library = require('../services/library')
  const originalOwnerScope = library.ownerScope
  const originalDownloadPhotoTemp = library.downloadPhotoTemp
  const calls = []
  library.ownerScope = async () => 'users/anon-1/'
  library.downloadPhotoTemp = async (key) => {
    calls.push(key)
    if (key.endsWith('/cover.jpg')) throw new Error('missing')
    return 'wxfile://first-photo.jpg'
  }

  try {
    const { page } = freshRecordingsPage()
    const record = {
      stem: 'VoiceDrop-2026-08-13-091500-3m20s-Wed-Morning-Shanghai',
      hasArticles: true,
      coverPhotoKey: 'photos/2026-08-13-091500/3-abc.jpg'
    }
    const ctx = Object.assign({}, page, {
      recordCoverLoadId: 1,
      data: Object.assign({}, page.data, { allRecords: [record], records: [record] }),
      setData(update) { Object.assign(this.data, update) }
    })

    await page.loadRecordingCovers.call(ctx, [record], 1)
    assert.deepEqual(calls, [
      'photos/2026-08-13-091500/cover.jpg',
      'photos/2026-08-13-091500/3-abc.jpg'
    ])
    assert.equal(ctx.data.records[0].coverPhotoUrl, 'wxfile://first-photo.jpg')
    assert.equal(ctx.data.records[0].coverPhotoIsBook, false)

    calls.length = 0
    const refreshed = Object.assign({}, record)
    ctx.data = Object.assign({}, ctx.data, { allRecords: [refreshed], records: [refreshed] })
    ctx.recordCoverLoadId = 2
    await page.loadRecordingCovers.call(ctx, [refreshed], 2)
    assert.deepEqual(calls, ['photos/2026-08-13-091500/3-abc.jpg'])
  } finally {
    library.ownerScope = originalOwnerScope
    library.downloadPhotoTemp = originalDownloadPhotoTemp
  }
})

test('recording rows use the compact readable home-list treatment', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/recordings/index.wxss'), 'utf8')
  const list = ruleBody(css, '.list')
  const card = ruleBody(css, '.record-card')
  const title = ruleBody(css, '.record-name')
  const meta = ruleBody(css, '.record-meta')
  const chevron = ruleBody(css, '.chevron')

  assert.match(list, /margin-top:\s*22rpx;/)
  assert.match(card, /min-height:\s*140rpx;/)
  assert.match(card, /padding:\s*26rpx 28rpx 26rpx 32rpx;/)
  assert.match(title, /font-size:\s*32rpx;/)
  assert.match(title, /font-weight:\s*800;/)
  assert.match(meta, /margin-top:\s*14rpx;/)
  assert.match(meta, /color:\s*#756f66;/)
  assert.match(meta, /font-size:\s*24rpx;/)
  assert.match(wxml, /class="chevron ri-arrow-right-s-line" aria-hidden="true"><\/text>/)
  assert.match(chevron, /font-size:\s*36rpx;/)
})

test('recordings content offset follows the rendered home header', () => {
  const source = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')

  assert.match(wxml, /<home-tabs id="home-tabs"/)
  assert.match(source, /\.select\('#home-tabs'\)[\s\S]*\.boundingClientRect/)
  assert.match(source, /layoutOffsets\(rect\.bottom, width\)/)
  assert.doesNotMatch(source, /topRpx\s*=\s*184/)
})

test('silent list refresh preserves unchanged recording covers without downloading them again', async () => {
  const library = require('../services/library')
  const originalOwnerScope = library.ownerScope
  let scopeCalls = 0
  library.ownerScope = async () => {
    scopeCalls += 1
    return 'users/anon-1/'
  }

  try {
    const { page } = freshRecordingsPage()
    const current = {
      stem: 'VoiceDrop-cover',
      coverPhotoKey: 'photos/session/cover.jpg',
      coverPhotoUrl: 'wxfile://cached-cover.jpg'
    }
    const ctx = Object.assign({}, page, {
      data: Object.assign({}, page.data, { allRecords: [current], records: [current] })
    })
    const refreshed = page.preserveRecordingCovers.call(ctx, [{
      stem: current.stem,
      coverPhotoKey: current.coverPhotoKey
    }])

    assert.equal(refreshed[0].coverPhotoUrl, 'wxfile://cached-cover.jpg')
    await page.loadRecordingCovers.call(ctx, refreshed, 1)
    assert.equal(scopeCalls, 0)
  } finally {
    library.ownerScope = originalOwnerScope
  }
})

test('community feed mirrors Android masonry tabs and keeps filters above pull refresh', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/recordings/index.wxss'), 'utf8')
  const js = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
  const detail = fs.readFileSync(path.join(root, 'pages/community-detail/index.wxml'), 'utf8')
  const appWxss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')

  const filters = wxml.indexOf('class="community-feed-tabs"')
  const scroller = wxml.indexOf('<scroll-view')
  assert.ok(filters >= 0 && filters < scroller)
  assert.match(wxml, /data-feed-tab="recommended"/)
  assert.match(wxml, /data-feed-tab="latest"/)
  assert.match(wxml, /data-feed-tab="replies"/)
  assert.doesNotMatch(wxml, /data-feed-tab="prompts"/)
  assert.doesNotMatch(wxml, /communityFeedTab === 'prompts'/)
  assert.match(css, /\.community-feed-tabs\s*\{[^}]*height:\s*88rpx;[^}]*padding:\s*0 32rpx;[^}]*align-items:\s*center;/s)
  assert.match(wxml, /class="community-feed-tabs" style="top: \{\{scrollContentTop\}\}px;"/)
  assert.match(wxml, /<text class="community-feed-tab-label">推荐<\/text>/)
  assert.match(css, /\.community-feed-tab\s*\{[^}]*display:\s*flex;[^}]*box-sizing:\s*border-box;[^}]*height:\s*88rpx;[^}]*align-items:\s*center;[^}]*font-size:\s*30rpx;/s)
  assert.doesNotMatch(css, /\.community-feed-tab\s*\{[^}]*padding-top:/s)
  assert.match(css, /\.community-feed-tab-label\s*\{[^}]*display:\s*block;[^}]*height:\s*30rpx;[^}]*line-height:\s*30rpx;[^}]*white-space:\s*nowrap;/s)
  assert.doesNotMatch(css, /\.community-feed-tab(?:-label)?\s*\{[^}]*height:\s*100%;/s)
  assert.doesNotMatch(ruleBody(css, '.community-feed-tab'), /transform:/)
  assert.doesNotMatch(ruleBody(css, '.community-feed-tab-label'), /transform:/)
  assert.doesNotMatch(wxml, /baseline-fix|harmony-baseline/)
  assert.doesNotMatch(css, /baseline-fix|harmony-baseline/)
  assert.match(wxml, /class="community-search-slot"[\s\S]*class="community-search-box"[\s\S]*class="community-search-cancel-slot"/)
  assert.match(wxml, /class="community-search-cancel-label"/)
  assert.doesNotMatch(wxml, /class="community-feed-tab-label community-search-cancel-label"/)
  assert.match(css, /\.community-search-slot\s*\{[^}]*display:\s*flex;[^}]*height:\s*88rpx;[^}]*align-items:\s*center;[^}]*flex:\s*1;/s)
  assert.match(css, /\.community-search-box\s*\{[^}]*position:\s*relative;[^}]*width:\s*100%;[^}]*height:\s*64rpx;[^}]*align-items:\s*center;/s)
  assert.doesNotMatch(ruleBody(css, '.community-search-box'), /(?:^|;)\s*top\s*:|transform:/)
  assert.match(css, /\.community-search-input\s*\{[^}]*height:\s*60rpx;[^}]*min-height:\s*0;[^}]*padding:\s*0;[^}]*line-height:\s*60rpx;/s)
  assert.match(css, /\.community-search-cancel-label\s*\{[^}]*display:\s*block;[^}]*height:\s*30rpx;[^}]*line-height:\s*30rpx;/s)
  assert.match(js, /\.select\('#home-tabs'\)[\s\S]*boundingClientRect/)
  assert.match(js, /communityScrollContentTop:\s*scrollContentTop \+ 88 \* pxPerRpx/)
  assert.match(wxml, /top: \{\{activeTab === 'community' \? communityScrollContentTop : scrollContentTop\}\}px/)
  assert.match(wxml, /class="community-card-image"/)
  assert.match(wxml, /class="community-like-icon ri-heart-fill"/)
  assert.match(wxml, /<text class="community-reply-icon ri-chat-2-line"><\/text>/)
  assert.match(detail, /class="reply-to-icon community-reply-icon-accent"/)
  assert.match(appWxss, /\.community-reply-icon-muted[\s\S]*data:image\/svg\+xml;base64,/)
  assert.match(appWxss, /\.community-reply-icon-accent[\s\S]*data:image\/svg\+xml;base64,/)
  assert.match(css, /\.community-reply-icon\s*\{[^}]*color:\s*#8a8175;[^}]*font-size:\s*24rpx;[^}]*line-height:\s*24rpx;/s)
  assert.doesNotMatch(css, /\.community-reply-icon-flat\s*\{/)
  assert.match(wxml, /class="community-post-column"[\s\S]*wx:for="\{\{communityLeftPosts\}\}"/)
  assert.match(wxml, /class="community-post-column"[\s\S]*wx:for="\{\{communityRightPosts\}\}"/)
  assert.doesNotMatch(css, /column-count:\s*2/)
  assert.match(css, /\.community-post-list\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*flex-start;/s)
  assert.match(css, /\.community-card\s*\{[^}]*overflow:\s*hidden;[^}]*border-radius:/s)
  assert.match(js, /community\.loadFeed\(\)/)
  assert.match(js, /selectCommunityFeed\(event\)/)
})

test('pull refresh keeps current content visible and forwards silent options to each tab', async () => {
  const toasts = []
  const { page } = freshRecordingsPage({ showToast(options) { toasts.push(options) } })
  let releaseRefresh
  const seen = []
  const existing = { stem: 'existing' }
  const ctx = Object.assign({}, page, {
    data: Object.assign({}, page.data, {
      activeTab: 'recordings',
      records: [existing],
      refreshing: false
    }),
    setData(update) { Object.assign(this.data, update) },
    refreshCurrent(options) {
      seen.push(options)
      return new Promise((resolve) => { releaseRefresh = resolve })
    }
  })

  const pending = page.onRefresherRefresh.call(ctx)
  assert.equal(ctx.data.refreshing, true)
  assert.deepEqual(ctx.data.records, [existing])
  releaseRefresh(true)
  await pending

  assert.equal(ctx.data.refreshing, false)
  assert.deepEqual(seen, [{ silent: true, keepDataOnError: true }])
  assert.deepEqual(toasts, [])

  const routed = []
  const routeCtx = {
    data: { activeTab: 'recordings' },
    load(options) { routed.push(['recordings', options]) },
    loadCommunity(options) { routed.push(['community', options]) }
  }
  const options = { silent: true, keepDataOnError: true }
  page.refreshCurrent.call(routeCtx, options)
  routeCtx.data.activeTab = 'community'
  page.refreshCurrent.call(routeCtx, options)
  assert.deepEqual(routed, [['recordings', options], ['community', options]])
})

test('books pull refresh bypasses caches and keeps repeated fast refreshes visible', async () => {
  const timers = []
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (callback, delay) => {
    timers.push({ callback, delay })
    return timers.length
  }
  try {
    const { page } = freshRecordingsPage()
    const seen = []
    const ctx = Object.assign({}, page, {
      data: Object.assign({}, page.data, { activeTab: 'books', refreshing: false }),
      setData(update) { Object.assign(this.data, update) },
      refreshCurrent(options) {
        seen.push(options)
        return Promise.resolve(true)
      }
    })

    const first = page.onRefresherRefresh.call(ctx)
    await new Promise((resolve) => queueMicrotask(resolve))
    assert.equal(ctx.data.refreshing, true)
    assert.ok(timers[0].delay >= 500)
    timers[0].callback()
    await first
    assert.equal(ctx.data.refreshing, false)

    const second = page.onRefresherRefresh.call(ctx)
    await new Promise((resolve) => queueMicrotask(resolve))
    assert.equal(ctx.data.refreshing, true)
    assert.ok(timers[1].delay >= 500)
    timers[1].callback()
    await second

    assert.equal(ctx.data.refreshing, false)
    assert.deepEqual(seen, [
      { silent: true, keepDataOnError: true, forceRefresh: true },
      { silent: true, keepDataOnError: true, forceRefresh: true }
    ])
  } finally {
    global.setTimeout = originalSetTimeout
  }
})

test('books load forwards force refresh and ignores an older response', async () => {
  const books = require('../services/books')
  const originalShelf = books.shelf
  let resolveOld
  let resolveFresh
  const calls = []
  books.shelf = (options) => {
    calls.push(options)
    return new Promise((resolve) => {
      if (calls.length === 1) resolveOld = resolve
      else resolveFresh = resolve
    })
  }
  try {
    const { page } = freshRecordingsPage()
    const ctx = Object.assign({}, page, {
      data: Object.assign({}, page.data, { bookItems: [] }),
      setData(update) { Object.assign(this.data, update) }
    })

    const oldLoad = page.loadBooks.call(ctx, { silent: true })
    const freshLoad = page.loadBooks.call(ctx, { silent: true, forceRefresh: true })
    resolveOld([{ slug: 'stale' }])
    await oldLoad
    assert.equal(ctx.data.bookItems.length, 0)

    resolveFresh([{ slug: 'fresh' }])
    await freshLoad
    assert.equal(ctx.data.bookItems[0].slug, 'fresh')
    assert.deepEqual(calls, [{ forceRefresh: false }, { forceRefresh: true }])
  } finally {
    books.shelf = originalShelf
  }
})

test('successful silent recording refresh clears a previous list error', async () => {
  const library = require('../services/library')
  const originalList = library.list
  const fresh = { stem: 'fresh', tags: [], hasArticles: true }
  library.list = async () => [fresh]

  try {
    const { page } = freshRecordingsPage()
    const ctx = Object.assign({}, page, {
      data: Object.assign({}, page.data, {
        activeTab: 'recordings',
        error: '旧错误',
        allRecords: [{ stem: 'old', tags: [] }],
        records: [{ stem: 'old', tags: [] }]
      }),
      setData(update) { Object.assign(this.data, update) },
      publishPendingReplies() {}
    })

    const ok = await page.load.call(ctx, { silent: true, keepDataOnError: true })

    assert.equal(ok, true)
    assert.equal(ctx.data.error, '')
    assert.deepEqual(ctx.data.records.map((rec) => rec.stem), ['fresh'])
  } finally {
    library.list = originalList
  }
})

test('switching back to an already loaded community refreshes the unified feed', () => {
  const { page } = freshRecordingsPage()
  const calls = []
  const ctx = Object.assign({}, page, {
    data: Object.assign({}, page.data, {
      activeTab: 'recordings',
      currentHomeTab: 'recordings',
      communityLoaded: true,
      allRecords: [],
      records: []
    }),
    setData(update) { Object.assign(this.data, update) },
    loadCommunity(options) { calls.push(options) }
  })

  page.switchHomeTab.call(ctx, { detail: { key: 'community' } })

  assert.deepEqual(calls, [{ silent: true, keepDataOnError: true }])
})

test('books uses the same in-page home tab switch as recordings and community', () => {
  const navigations = []
  const { page } = freshRecordingsPage({
    navigateTo({ url }) { navigations.push(url) },
    reLaunch({ url }) { navigations.push(url) }
  })
  const loads = []
  const ctx = Object.assign({}, page, {
    data: Object.assign({}, page.data, {
      activeTab: 'recordings',
      currentHomeTab: 'recordings',
      booksLoaded: false
    }),
    setData(update) { Object.assign(this.data, update) },
    restoreCachedBooks() { return false },
    loadBooks(options) { loads.push(options) },
    currentCommandRefs() { return [] }
  })

  page.switchHomeTab.call(ctx, { detail: { key: 'books' } })

  assert.equal(ctx.data.activeTab, 'books')
  assert.equal(ctx.data.currentHomeTab, 'books')
  assert.deepEqual(loads, [undefined])
  assert.deepEqual(navigations, [])
})

test('books supports direct home-tab entry and renders inside the recordings page', () => {
  const { page, helpers } = freshRecordingsPage()
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/recordings/index.wxss'), 'utf8')

  assert.equal(page.initialTab({ tab: 'books' }), 'books')
  assert.ok(page.data.homeTabs.some((tab) => tab.key === 'books'))
  assert.match(wxml, /wx:elif="\{\{activeTab === 'books'\}\}"/)
  assert.match(wxml, /wx:for="\{\{bookRows\}\}"/)
  assert.match(wxml, /class="shelf-bar"/)
  assert.match(ruleBody(css, '.shelf-row'), /gap:\s*44rpx;/)
  assert.match(ruleBody(css, '.book-cover'), /aspect-ratio:\s*0\.7;/)
  assert.match(ruleBody(css, '.cover-main'), /font-size:\s*40rpx;/)
  assert.match(css, /@media \(min-width: 410px\)\s*\{\s*\.cover-main\s*\{\s*font-size:\s*44rpx;/)
  assert.match(ruleBody(css, '.write-cover'), /border:\s*3rpx dashed #cfc0a6;/)
  assert.match(ruleBody(css, '.shelf-bar'), /height:\s*12rpx;/)
  assert.deepEqual(helpers.bookRowsFor([
    { slug: 'one' }, { slug: 'two' }, { slug: 'three' }
  ]).map((row) => row.map((cell) => cell.kind === 'write' ? 'write' : cell.slug)), [
    ['write', 'one'],
    ['two', 'three']
  ])
})

test('books keep edit buttons visible while refreshing the same account profile', async () => {
  const settings = require('../services/settings')
  const auth = require('../services/auth')
  const originalLoadStyle = settings.loadStyle
  const originalBearer = auth.bearer
  let resolveProfile
  settings.loadStyle = () => new Promise((resolve) => { resolveProfile = resolve })
  auth.bearer = () => 'same-account'

  try {
    const { page, helpers } = freshRecordingsPage()
    const items = [{ slug: 'mine', author: 'Holly', editableByAuthor: true }]
    const ctx = Object.assign({}, page, {
      data: Object.assign({}, page.data, {
        bookProfileAuthor: 'Holly',
        bookItems: items,
        bookRows: helpers.bookRowsFor(items)
      }),
      _bookProfileAuthorLoaded: true,
      _bookProfileAuthorBearer: 'same-account',
      setData(update) { Object.assign(this.data, update) }
    })

    const refreshing = page.loadBookProfileAuthor.call(ctx, { force: true })
    assert.equal(ctx.data.bookProfileAuthor, 'Holly')
    assert.equal(ctx.data.bookItems[0].editableByAuthor, true)

    resolveProfile({ name: 'Holly' })
    await refreshing
    assert.equal(ctx.data.bookItems[0].editableByAuthor, true)
  } finally {
    settings.loadStyle = originalLoadStyle
    auth.bearer = originalBearer
  }
})

test('community restores a cached snapshot before starting its silent refresh', () => {
  const community = require('../services/community')
  const originalCachedFeed = community.cachedFeed
  community.cachedFeed = () => community.normalizeUnifiedFeed({
    posts: [{ shareId: 'cached', title: '缓存帖子', firstSharedAt: 1 }],
    order: ['cached']
  })
  try {
    const { page } = freshRecordingsPage({
      getStorageSync() { return '' },
      setStorageSync() {},
      removeStorageSync() {}
    })
    const ctx = Object.assign({}, page, {
      data: Object.assign({}, page.data, { communityLoading: true }),
      setData(update) { Object.assign(this.data, update) }
    })

    assert.equal(page.restoreCachedCommunityFeed.call(ctx), true)
    assert.equal(ctx.data.communityLoaded, true)
    assert.equal(ctx.data.communityLoading, false)
    assert.deepEqual(ctx.data.communityPosts.map((post) => post.shareId), ['cached'])
  } finally {
    community.cachedFeed = originalCachedFeed
  }
})

test('community combines overlapping refreshes into one network request', async () => {
  const community = require('../services/community')
  const originalLoadFeed = community.loadFeed
  let calls = 0
  let release
  community.loadFeed = () => {
    calls += 1
    return new Promise((resolve) => { release = resolve })
  }
  try {
    const { page } = freshRecordingsPage({
      getStorageSync() { return '' },
      setStorageSync() {},
      removeStorageSync() {}
    })
    const ctx = Object.assign({}, page, {
      data: Object.assign({}, page.data, { communityLoaded: true }),
      setData(update) { Object.assign(this.data, update) }
    })
    const options = { silent: true, keepDataOnError: true }
    const first = page.loadCommunity.call(ctx, options)
    const second = page.loadCommunity.call(ctx, options)

    assert.equal(calls, 1)
    release(community.normalizeUnifiedFeed({
      posts: [{ shareId: 'fresh', firstSharedAt: 2 }],
      order: ['fresh']
    }))
    await Promise.all([first, second])
    assert.equal(ctx._communityLoadPromise, null)
    assert.deepEqual(ctx.data.communityPosts.map((post) => post.shareId), ['fresh'])
  } finally {
    community.loadFeed = originalLoadFeed
  }
})

test('community warms at most four visible details with two concurrent requests', async () => {
  const community = require('../services/community')
  const originalGet = community.get
  const originalCachedPost = community.cachedPost
  const calls = []
  let active = 0
  let maxActive = 0
  community.cachedPost = () => null
  community.get = async (shareId) => {
    calls.push(shareId)
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setImmediate(resolve))
    active -= 1
    return { shareId }
  }
  try {
    const { page } = freshRecordingsPage()
    const ctx = Object.assign({}, page, {
      _pageUnloaded: false
    })
    const posts = Array.from({ length: 6 }, (_, index) => ({ shareId: `share-${index + 1}` }))

    await page.warmCommunityDetails.call(ctx, posts)

    assert.deepEqual(calls, ['share-1', 'share-2', 'share-3', 'share-4'])
    assert.equal(maxActive, 2)
  } finally {
    community.get = originalGet
    community.cachedPost = originalCachedPost
  }
})

test('community ignores a response after the page load generation is invalidated', async () => {
  const community = require('../services/community')
  const originalLoadFeed = community.loadFeed
  let release
  community.loadFeed = () => new Promise((resolve) => { release = resolve })
  try {
    const { page } = freshRecordingsPage({
      getStorageSync() { return '' },
      setStorageSync() {},
      removeStorageSync() {}
    })
    const ctx = Object.assign({}, page, {
      data: Object.assign({}, page.data),
      setData(update) { Object.assign(this.data, update) }
    })
    const pending = page.loadCommunity.call(ctx)
    ctx._communityLoadGeneration += 1
    release(community.normalizeUnifiedFeed({
      posts: [{ shareId: 'stale', firstSharedAt: 1 }],
      order: ['stale']
    }))

    assert.equal(await pending, false)
    assert.deepEqual(ctx.data.communityPosts, [])
  } finally {
    community.loadFeed = originalLoadFeed
  }
})

test('record button floats only on the recordings tab', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/recordings/index.wxss'), 'utf8')
  const dock = ruleBody(css, '.record-dock')
  const scroll = ruleBody(css, '.scroll-content')
  const inner = ruleBody(css, '.scroll-inner')
  const innerWithDock = ruleBody(css, '.scroll-inner.with-record-dock')

  assert.match(wxml, /<view\s+wx:if="\{\{activeTab === 'recordings'\}\}"\s+class="record-dock">/)
  assert.match(wxml, /class="scroll-inner \{\{activeTab === 'recordings' \? 'with-record-dock' : ''\}\}"/)
  assert.match(scroll, /bottom:\s*0;/)
  assert.match(inner, /padding:\s*0\s+32rpx\s+48rpx;/)
  assert.match(innerWithDock, /padding-bottom:\s*230rpx;/)
  assert.match(dock, /position:\s*fixed;/)
  assert.match(dock, /bottom:\s*42rpx;/)
  assert.match(dock, /pointer-events:\s*none;/)
})

test('record button status shows active command feedback above the button', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/recordings/index.wxss'), 'utf8')

  assert.match(wxml, /wx:if="\{\{commandStatusText\}\}"/)
  assert.match(wxml, /\{\{commandStatusText\}\}/)
  assert.match(wxml, /class="fab-status \{\{commandStatusKind\}\}"/)
  assert.doesNotMatch(wxml, /wx:if="\{\{commandTalking && commandReply\}\}"/)
  assert.doesNotMatch(wxml, /bindtap="onMicTap"/)
  assert.doesNotMatch(wxml, /bindlongpress="onMicLongPress"/)
  assert.match(wxml, /bindtouchcancel="onMicTouchCancel"/)
  assert.match(js, /commandStatusText:\s*''/)
  assert.match(js, /commandStatusKind:\s*''/)
  assert.match(js, /refreshCommandStatus\(/)
  assert.match(js, /this\.commandSession\.connect\(\)/)
  assert.match(js, /stopRecorderAndWait\(recorder,\s*500\)/)
  assert.match(js, /waitForFinalText\(1500\)/)
  assert.doesNotMatch(js, /waitForBestText\(3000\)/)
  assert.match(js, /this\.confirmLibraryCommand\(id, text\)/)
  assert.match(js, /LONG_PRESS_MS:\s*350/)
  assert.match(js, /this\._micLongPressTimer = setTimeout/)
  assert.match(js, /this\._micTouchEndedBeforeCommandStart/)
  assert.match(js, /this\._skipRecorderStopCount/)
  assert.match(js, /active\.type === 'asr'/)
  assert.match(js, /active\.type !== 'recordings'/)
  assert.match(js, /app\.globalData\.activeRecorderSession = \{ type: 'asr', id: sessionId \}/)
  assert.match(js, /this\._activeAsrSessionId !== sessionId/)
  assert.doesNotMatch(js, /onMicTap\(\)/)
  assert.doesNotMatch(js, /onMicLongPress\(\)/)
  assert.doesNotMatch(js, /this\.commandTranscript\.accept\(text, isFinal\)/)
  assert.match(js, /title:\s*'确认操作'/)
  assert.match(js, /confirmText:\s*'删除'/)
  assert.match(js, /cancelText:\s*'取消'/)
  assert.match(js, /onUpdate:\s*\(stems\)\s*=>\s*\{[\s\S]*library\.invalidateArticleCaches\(stems\)[\s\S]*this\.load\(\{\s*silent:\s*true,\s*keepDataOnError:\s*true\s*\}\)/)
  const transcriptStatus = ruleBody(css, '.fab-status.transcript')
  const transcriptArrow = ruleBody(css, '.fab-status.transcript::after')
  const queueStatus = ruleBody(css, '.fab-status.queue')
  const replyStatus = ruleBody(css, '.fab-status.reply')
  const errorStatus = ruleBody(css, '.fab-status.error')
  assert.match(transcriptStatus, /background:\s*#2e2823;/)
  assert.match(transcriptStatus, /color:\s*#fbf6ee;/)
  assert.match(transcriptArrow, /left:\s*50%;/)
  assert.match(transcriptArrow, /transform:\s*translateX\(-50%\);/)
  assert.match(queueStatus, /background:\s*#f6e4dc;/)
  assert.match(queueStatus, /border-color:\s*rgba\(216, 89, 59, 0\.5\);/)
  assert.match(replyStatus, /background:\s*#ffffff;/)
  assert.match(replyStatus, /color:\s*#2a2521;/)
  assert.match(errorStatus, /background:\s*#ffffff;/)
  assert.match(errorStatus, /border-color:\s*rgba\(192, 57, 43, 0\.7\);/)
})

test('library command confirmation waits for the destructive choice', () => {
  let modal
  const calls = []
  const { page } = freshRecordingsPage({ showModal(options) { modal = options } })
  const ctx = Object.assign({}, page, {
    commandSession: {
      confirm(id) { calls.push(['confirm', id]) },
      cancel(id) { calls.push(['cancel', id]) }
    }
  })

  page.confirmLibraryCommand.call(ctx, 'cmd-1', '要删掉《文章2》吗？')

  assert.deepEqual(calls, [])
  assert.equal(modal.title, '确认操作')
  assert.equal(modal.content, '要删掉《文章2》吗？')
  assert.equal(modal.confirmText, '删除')
  modal.success({ confirm: true, cancel: false })
  assert.deepEqual(calls, [['confirm', 'cmd-1']])
})

test('library command confirmation sends cancel when deletion is declined', () => {
  let modal
  const calls = []
  const { page } = freshRecordingsPage({ showModal(options) { modal = options } })
  const ctx = Object.assign({}, page, {
    commandSession: {
      confirm(id) { calls.push(['confirm', id]) },
      cancel(id) { calls.push(['cancel', id]) }
    }
  })

  page.confirmLibraryCommand.call(ctx, 'cmd-2', '要删掉《文章2》吗？')
  modal.success({ confirm: false, cancel: true })

  assert.deepEqual(calls, [['cancel', 'cmd-2']])
})

test('library command confirmation does not show the same request twice', () => {
  const modals = []
  const { page } = freshRecordingsPage({ showModal(options) { modals.push(options) } })
  const ctx = Object.assign({}, page, {
    commandSession: { confirm() {}, cancel() {} }
  })

  page.confirmLibraryCommand.call(ctx, 'cmd-3', '要删掉《文章3》吗？')
  page.confirmLibraryCommand.call(ctx, 'cmd-3', '要删掉《文章3》吗？')

  assert.equal(modals.length, 1)
})

test('recording tags are rendered in the top home tabs instead of a secondary tab row', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')

  assert.match(wxml, /<home-tabs id="home-tabs" current="\{\{currentHomeTab\}\}" tabs="\{\{homeTabs\}\}"/)
  assert.doesNotMatch(wxml, /class="tag-tabs"/)
  assert.doesNotMatch(wxml, /wx:for="\{\{homeTags\}\}"/)
  assert.match(js, /homeTabsFor\(homeTags\)/)
  assert.match(js, /key: `tag:\$\{tag\}`/)
  assert.match(js, /if \(key\.startsWith\('tag:'\)\)/)
  assert.match(js, /const currentHomeTab = this\.data\.activeTab === 'community'[\s\S]*\(selectedTag \? `tag:\$\{selectedTag\}` : 'recordings'\)/)
  assert.match(js, /return tags\.includes\(selected\) \? selected : ''/)
})

test('tag-filtered command badges use the same numbering as transmitted refs', () => {
  const { page } = freshRecordingsPage()
  const allRecords = page.assignCommandRefs([
    { stem: 'a', rowTitle: 'A', tags: ['其他'], hasArticles: true },
    { stem: 'b', rowTitle: 'B', tags: ['工作'], hasArticles: true },
    { stem: 'c', rowTitle: 'C', tags: ['工作'], hasArticles: true }
  ])
  const ctx = Object.assign({}, page, {
    data: Object.assign({}, page.data, {
      activeTab: 'recordings',
      currentHomeTab: 'recordings',
      allRecords,
      records: allRecords,
      homeTags: ['其他', '工作']
    }),
    commandSession: { setRefs() {} },
    setData(update) { Object.assign(this.data, update) }
  })

  page.switchHomeTab.call(ctx, { detail: { key: 'tag:工作', tab: { tag: '工作' } } })

  assert.deepEqual(ctx.data.records.map((record) => record._commandRef), [1, 2])
  assert.deepEqual(page.currentCommandRefs.call(ctx), [
    { n: 1, stem: 'b', title: 'B' },
    { n: 2, stem: 'c', title: 'C' }
  ])
})

test('both home microphone paths require audio consent and platform record permission', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
  const config = JSON.parse(fs.readFileSync(path.join(root, 'pages/recordings/index.json'), 'utf8'))

  assert.equal(config.usingComponents['audio-consent-dialog'], '/components/audio-consent-dialog/index')
  assert.match(js, /const audioConsentFlow = require\('\.\.\/\.\.\/utils\/audio-consent-flow'\)/)
  assert.match(js, /const recordPermission = require\('\.\.\/\.\.\/utils\/record-permission'\)/)
  assert.match(js, /audioConsentVisible:\s*false/)
  assert.match(js, /requestAudioConsent\(\)\s*\{\s*return audioConsentFlow\.request\(this\)/)
  assert.doesNotMatch(js, /audioConsentFlow\.markReady/)
  assert.match(js, /onAudioConsentAgree\(\)\s*\{\s*audioConsentFlow\.agree\(this\)/)
  assert.match(js, /onAudioConsentDecline\(\)\s*\{\s*audioConsentFlow\.decline\(this\)/)
  assert.match(js, /onAudioConsentViewAgreement\(\)[\s\S]*audioConsentFlow\.decline\(this\)[\s\S]*\/pages\/audio-consent\/index/)
  assert.match(js, /onUnload\(\)\s*\{\s*audioConsentFlow\.dispose\(this\)/)
  assert.doesNotMatch(js, /selectComponent\('#audio-consent-dialog'\)/)
  assert.match(wxml, /<audio-consent-dialog/)
  assert.match(wxml, /visible="\{\{audioConsentVisible\}\}"/)
  assert.doesNotMatch(wxml, /bind:ready=/)
  assert.match(wxml, /bind:agree="onAudioConsentAgree"/)
  assert.match(wxml, /bind:decline="onAudioConsentDecline"/)
  assert.match(wxml, /bind:viewagreement="onAudioConsentViewAgreement"/)
  assert.match(js, /async startRecord\(\)\s*\{[\s\S]*if \(!await this\.requestAudioConsent\(\)\) return[\s\S]*if \(!await recordPermission\.ensure\(wx\)\) return[\s\S]*wx\.navigateTo/)
  assert.match(js, /async _startLibraryCommandTalk\(\)\s*\{[\s\S]*if \(!await this\.requestAudioConsent\(\)\)[\s\S]*if \(!await recordPermission\.ensure\(wx\)\)[\s\S]*this\._beginAsrSession\(\)/)
})

test('home voice command rechecks finger state after consent', () => {
  const js = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
  const method = js.match(/async _startLibraryCommandTalk\(\)\s*\{([\s\S]*?)\n  \},\n\n  _beginAsrSession/)

  assert.ok(method)
  const body = method[1]
  const consentIndex = body.indexOf('await this.requestAudioConsent()')
  const permissionIndex = body.indexOf('await recordPermission.ensure(wx)', consentIndex)
  const releaseIndex = body.indexOf('this._micTouchEndedBeforeCommandStart', permissionIndex)
  const beginIndex = body.indexOf('this._beginAsrSession()', consentIndex)
  assert.ok(consentIndex >= 0)
  assert.ok(permissionIndex > consentIndex)
  assert.ok(releaseIndex > permissionIndex)
  assert.ok(beginIndex > releaseIndex)
})

test('home voice command closes the list command socket before opening ASR', () => {
  const js = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
  const method = js.match(/_beginAsrSession\(\)\s*\{([\s\S]*?)\n  \},\n\n  async _finishLibraryCommandTalk/)

  assert.ok(method)
  const body = method[1]
  const closeIndex = body.indexOf('this.commandSession.close()')
  const asrIndex = body.indexOf('asrDictation.createSession')
  assert.ok(closeIndex >= 0)
  assert.ok(asrIndex > closeIndex)
  assert.doesNotMatch(body, /this\.commandSession\.connect\(\)/)
})

test('home voice command waits for recorder stop and final ASR text before sending', async () => {
  const events = []
  let recorderStop
  const recorder = {
    onStop(handler) { recorderStop = handler },
    offStop() { events.push('offStop') },
    stop() { events.push('stop') }
  }
  const transcript = holdToTalk.createTranscript()
  transcript.accept('删除第二', false)
  const { page } = freshRecordingsPage()
  const enqueued = []
  const ctx = Object.assign({}, page, {
    data: Object.assign({}, page.data, { commandTalking: true, allRecords: [] }),
    setData(update) { Object.assign(this.data, update) },
    asrRecorder: recorder,
    asrSession: {
      finish() { events.push('finish') },
      close() { events.push('close') }
    },
    commandTranscript: transcript,
    commandSession: {
      enqueue(text) { enqueued.push(text) }
    }
  })

  const finishing = page._finishLibraryCommandTalk.call(ctx, false)
  await Promise.resolve()
  assert.deepEqual(events, ['stop'])

  recorderStop({})
  await Promise.resolve()
  assert.deepEqual(events.slice(0, 3), ['stop', 'offStop', 'finish'])
  transcript.accept('删除第二篇文章', true)
  await finishing

  assert.deepEqual(enqueued, ['删除第二篇文章'])
  assert.equal(events.at(-1), 'close')
})
