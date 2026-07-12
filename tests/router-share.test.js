const test = require('node:test')
const assert = require('node:assert/strict')

const appRouter = require('../utils/app-router')
const shareRouter = require('../utils/share-router')

function freshApp(wxOverrides, currentPages) {
  let definition
  const calls = []
  global.App = (value) => { definition = value }
  global.getCurrentPages = () => currentPages || []
  global.wx = Object.assign({
    showShareMenu() {},
    showToast() {},
    navigateTo(options) { calls.push({ type: 'navigateTo', url: options.url }) },
    redirectTo(options) { calls.push({ type: 'redirectTo', url: options.url }) },
    reLaunch(options) { calls.push({ type: 'reLaunch', url: options.url }) }
  }, wxOverrides || {})
  delete require.cache[require.resolve('../app')]
  require('../app')
  const app = Object.assign({}, definition, {
    globalData: Object.assign({}, definition.globalData)
  })
  return { app, calls }
}

function flushRoutes() {
  return new Promise((resolve) => setTimeout(resolve, 10))
}

test('parses Android voicedrop deep links into mini program routes', () => {
  assert.deepEqual(appRouter.parse('voicedrop://recordings'), { kind: 'recordings', stem: '', tag: '' })
  assert.deepEqual(appRouter.parse('voicedrop://community'), { kind: 'community', stem: '', tag: '' })
  assert.deepEqual(appRouter.parse('voicedrop://settings'), { kind: 'settings', stem: '', tag: '' })
  assert.deepEqual(appRouter.parse('voicedrop://record?tag=idea'), { kind: 'record', stem: '', tag: 'idea' })
  assert.deepEqual(appRouter.parse('voicedrop://article/VoiceDrop-a'), { kind: 'article', stem: 'VoiceDrop-a', tag: '' })
  assert.deepEqual(appRouter.routeFor({ kind: 'article', stem: 'VoiceDrop-a' }), {
    type: 'navigateTo',
    url: '/pages/detail/index?stem=VoiceDrop-a'
  })
  assert.deepEqual(appRouter.routeFor({ kind: 'recordings' }), {
    type: 'reLaunch',
    url: '/pages/recordings/index',
    tab: 'recordings'
  })
  assert.deepEqual(appRouter.routeFor({ kind: 'community' }), {
    type: 'reLaunch',
    url: '/pages/recordings/index?tab=community',
    tab: 'community'
  })
  assert.deepEqual(appRouter.routeFor({ kind: 'settings' }), {
    type: 'navigateTo',
    url: '/pages/settings/index'
  })
  assert.deepEqual(appRouter.parseQuery({ shareId: 'community-1' }), {
    kind: 'community-detail',
    stem: 'community-1',
    tag: ''
  })
})

test('app handles the same launch route only once across onLaunch and onShow', async () => {
  const { app, calls } = freshApp()
  const options = { query: { stem: 'VoiceDrop-a' } }

  app.onLaunch(options)
  app.onShow(options)
  await flushRoutes()

  assert.deepEqual(calls, [
    { type: 'navigateTo', url: '/pages/detail/index?stem=VoiceDrop-a' }
  ])
})

test('app does not reopen the detail route already visible after returning from album', async () => {
  const { app, calls } = freshApp({}, [{
    route: 'pages/detail/index',
    options: { stem: 'VoiceDrop-a' }
  }])

  app.onShow({ query: { stem: 'VoiceDrop-a' } })
  await flushRoutes()

  assert.deepEqual(calls, [])
})

test('app still opens an article route from another page', async () => {
  const { app, calls } = freshApp({}, [{ route: 'pages/recordings/index', options: {} }])

  app.onShow({ query: { stem: 'VoiceDrop-a' } })
  await flushRoutes()

  assert.deepEqual(calls, [
    { type: 'navigateTo', url: '/pages/detail/index?stem=VoiceDrop-a' }
  ])
})

test('app still opens a different article from the current detail page', async () => {
  const { app, calls } = freshApp({}, [{
    route: 'pages/detail/index',
    options: { stem: 'VoiceDrop-a' }
  }])

  app.onShow({ query: { stem: 'VoiceDrop-b' } })
  await flushRoutes()

  assert.deepEqual(calls, [
    { type: 'navigateTo', url: '/pages/detail/index?stem=VoiceDrop-b' }
  ])
})

test('classifies shared payloads and extracts titles like Android', () => {
  assert.equal(shareRouter.classify({ mimeType: 'audio/mp4' }), 'audio')
  assert.equal(shareRouter.classify({ mimeType: 'image/jpeg' }), 'image')
  assert.equal(shareRouter.classify({ mimeType: 'application/pdf' }), 'document')
  assert.equal(shareRouter.classify({ text: 'https://example.com/a' }), 'web')
  assert.equal(shareRouter.classify({ hasText: true, text: 'plain text' }), 'text')
  assert.equal(shareRouter.firstLineTitle('\n  第一行标题\n第二行', 'fallback'), '第一行标题')
  assert.equal(shareRouter.firstLineTitle('', 'fallback'), 'fallback')
  assert.equal(shareRouter.cap('abcdefghijklmnopqrstuvwxyz', 5), 'abcde')
})
