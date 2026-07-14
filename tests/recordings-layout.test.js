const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

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
  require(pagePath)
  return { page, app }
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

  const loadingStates = wxml.match(/<view wx:(?:if|elif)="\{\{(?:loading|communityLoading)\}\}" class="notice loading-notice">\s*<view class="loading-spinner" aria-hidden="true"><\/view>\s*<text>正在加载\.\.\.<\/text>\s*<\/view>/g) || []

  assert.equal(loadingStates.length, 2)
  assert.match(loadingNotice, /display:\s*flex;/)
  assert.match(loadingNotice, /flex-direction:\s*column;/)
  assert.match(spinner, /border-top-color:\s*#c7432f;/)
  assert.match(spinner, /animation:\s*loading-spin\s+0\.8s\s+linear\s+infinite;/)
  assert.match(css, /@keyframes loading-spin\s*\{[\s\S]*transform:\s*rotate\(360deg\);[\s\S]*\}/)
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

test('recordings scroll view enables pull refresh for both home tabs', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/recordings/index.wxss'), 'utf8')

  assert.match(wxml, /<scroll-view[^>]*refresher-enabled="\{\{true\}\}"/)
  assert.match(wxml, /<scroll-view[^>]*refresher-triggered="\{\{refreshing\}\}"/)
  assert.match(wxml, /<scroll-view[^>]*refresher-default-style="none"/)
  assert.match(wxml, /<scroll-view[^>]*refresher-threshold="60"/)
  assert.match(wxml, /<scroll-view[^>]*bindrefresherrefresh="onRefresherRefresh"/)
  assert.match(wxml, /<view slot="refresher" class="pull-refresh-indicator">\s*<view class="loading-spinner pull-refresh-spinner" aria-hidden="true"><\/view>\s*<\/view>/)
  assert.match(css, /\.pull-refresh-indicator\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;[^}]*height:\s*60px;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s)
  assert.match(css, /\.pull-refresh-spinner\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*flex:\s*0 0 30px;[^}]*position:\s*relative;[^}]*top:\s*8px;/s)
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

  assert.match(wxml, /wx:if="\{\{commandStatusText\}\}"/)
  assert.match(wxml, /\{\{commandStatusText\}\}/)
  assert.doesNotMatch(wxml, /wx:if="\{\{commandTalking && commandReply\}\}"/)
  assert.doesNotMatch(wxml, /bindtap="onMicTap"/)
  assert.doesNotMatch(wxml, /bindlongpress="onMicLongPress"/)
  assert.match(wxml, /bindtouchcancel="onMicTouchCancel"/)
  assert.match(js, /commandStatusText:\s*''/)
  assert.match(js, /refreshCommandStatus\(/)
  assert.match(js, /this\.commandSession\.connect\(\)/)
  assert.match(js, /waitForBestText\(3000\)/)
  assert.match(js, /this\.commandSession\.confirm\(id\)/)
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
  assert.doesNotMatch(js, /title:\s*'确认图库指令'/)
  assert.doesNotMatch(js, /confirmText:\s*'执行'/)
  assert.doesNotMatch(js, /图库指令/)
})

test('recording tags are rendered in the top home tabs instead of a secondary tab row', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')

  assert.match(wxml, /<home-tabs current="\{\{currentHomeTab\}\}" tabs="\{\{homeTabs\}\}"/)
  assert.doesNotMatch(wxml, /class="tag-tabs"/)
  assert.doesNotMatch(wxml, /wx:for="\{\{homeTags\}\}"/)
  assert.match(js, /homeTabsFor\(homeTags\)/)
  assert.match(js, /key: `tag:\$\{tag\}`/)
  assert.match(js, /if \(key\.startsWith\('tag:'\)\)/)
  assert.match(js, /const currentHomeTab = this\.data\.activeTab === 'community'[\s\S]*\(selectedTag \? `tag:\$\{selectedTag\}` : 'recordings'\)/)
  assert.match(js, /return tags\.includes\(selected\) \? selected : ''/)
})

test('both home microphone paths require only audio consent', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
  const config = JSON.parse(fs.readFileSync(path.join(root, 'pages/recordings/index.json'), 'utf8'))

  assert.equal(config.usingComponents['audio-consent-dialog'], '/components/audio-consent-dialog/index')
  assert.match(js, /const audioConsentFlow = require\('\.\.\/\.\.\/utils\/audio-consent-flow'\)/)
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
  assert.match(js, /async startRecord\(\)\s*\{[\s\S]*if \(!await this\.requestAudioConsent\(\)\) return[\s\S]*wx\.navigateTo/)
  assert.match(js, /async _startLibraryCommandTalk\(\)\s*\{[\s\S]*if \(!await this\.requestAudioConsent\(\)\)[\s\S]*this\._beginAsrSession\(\)/)
  assert.doesNotMatch(js, /wx\.authorize/)
  assert.doesNotMatch(js, /需要录音权限/)
})

test('home voice command rechecks finger state after consent', () => {
  const js = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
  const method = js.match(/async _startLibraryCommandTalk\(\)\s*\{([\s\S]*?)\n  \},\n\n  _beginAsrSession/)

  assert.ok(method)
  const body = method[1]
  const consentIndex = body.indexOf('await this.requestAudioConsent()')
  const releaseIndex = body.indexOf('this._micTouchEndedBeforeCommandStart', consentIndex)
  const beginIndex = body.indexOf('this._beginAsrSession()', consentIndex)
  assert.ok(consentIndex >= 0)
  assert.ok(releaseIndex > consentIndex)
  assert.ok(beginIndex > releaseIndex)
})
