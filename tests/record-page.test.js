const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const js = fs.readFileSync(path.join(root, 'pages/record/index.js'), 'utf8')
const wxml = fs.readFileSync(path.join(root, 'pages/record/index.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/record/index.wxss'), 'utf8')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

function createRecorder() {
  const callbacks = { frame: [], stop: [], error: [] }
  const recorder = {
    startCount: 0,
    stopCount: 0,
    start() { this.startCount += 1 },
    onFrameRecorded(fn) { callbacks.frame.push(fn) },
    onStop(fn) { callbacks.stop.push(fn) },
    onError(fn) { callbacks.error.push(fn) },
    offFrameRecorded(fn) { callbacks.frame = callbacks.frame.filter((item) => item !== fn) },
    offStop(fn) { callbacks.stop = callbacks.stop.filter((item) => item !== fn) },
    offError(fn) { callbacks.error = callbacks.error.filter((item) => item !== fn) },
    stop() { this.stopCount += 1 },
    emitFrame(frame) { callbacks.frame.slice().forEach((fn) => fn(frame)) },
    emitStop(result) { callbacks.stop.slice().forEach((fn) => fn(result)) },
    emitError(error) { callbacks.error.slice().forEach((fn) => fn(error)) },
    listenerCount(type) { return callbacks[type].length }
  }
  return recorder
}

function loadPage(overrides = {}) {
  const recorder = overrides.recorder || createRecorder()
  const app = overrides.app || { globalData: { pendingRecordTag: '', pendingReplyTo: null, ...(overrides.globalData || {}) } }
  const calls = { uploads: [], tags: [], toasts: [], navigations: 0, unlinks: [], interviewerStops: 0, refreshes: 0, order: [] }
  const upload = overrides.upload || (() => Promise.resolve(true))
  const audio = {
    recorder: () => recorder,
    startPcmFrames: () => recorder.start(),
    stop: () => { calls.order.push('recorder.stop'); recorder.stop() },
    nameForSession: () => 'session.m4a',
    uploadFile(filePath, name, contentType) {
      calls.order.push('upload')
      calls.uploads.push({ filePath, name, contentType })
      return upload(filePath, name, contentType)
    },
    uploadTags(name, tags) { calls.tags.push({ name, tags }); return Promise.resolve(true) }
  }
  const interviewer = {
    stop() {
      calls.interviewerStops += 1
      calls.order.push('interviewer.stop')
      if (overrides.interviewerStopError) throw overrides.interviewerStopError
    },
    toggle() {},
    onPcm16() {}
  }
  const realtimeInterviewer = { createInterviewer: () => interviewer }
  const wav = {
    peakAmplitude: () => 0,
    wrapPcm16Wav: (data) => data
  }
  const fsManager = overrides.fsManager || {
    readFile(options) { options.success({ data: new ArrayBuffer(2) }) },
    writeFile(options) { options.success() },
    unlink(options) { calls.unlinks.push(options.filePath); options.success() }
  }
  let definition
  global.getApp = () => app
  global.Page = (value) => { definition = value }
  global.getCurrentPages = () => [{ load() { calls.refreshes += 1 } }]
  global.wx = {
    env: { USER_DATA_PATH: '/user' },
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    getFileSystemManager: () => fsManager,
    showLoading() {},
    hideLoading() {},
    showToast(options) { calls.toasts.push(options) },
    navigateBack(options = {}) { calls.navigations += 1; if (options.success) options.success() }
  }

  const moduleIds = [
    '../pages/record/index',
    '../services/audio',
    '../utils/wav',
    '../services/realtime-interviewer'
  ]
  moduleIds.forEach((id) => { delete require.cache[require.resolve(id)] })
  require.cache[require.resolve('../services/audio')] = { exports: audio }
  require.cache[require.resolve('../utils/wav')] = { exports: wav }
  require.cache[require.resolve('../services/realtime-interviewer')] = { exports: realtimeInterviewer }
  require('../pages/record/index')

  const page = { ...definition, data: { ...definition.data } }
  page.setData = function setData(next) { Object.assign(this.data, next) }
  const originalSetInterval = global.setInterval
  global.setInterval = () => 101
  page.onLoad({})
  global.setInterval = originalSetInterval
  return { page, app, recorder, calls, fsManager }
}

test('record page owns one guarded recording session', () => {
  assert.doesNotMatch(js, /looksSilent\(0,\s*elapsed\)/)
  assert.match(js, /app\.globalData\.activeRecorderSession = \{ type: 'record', id: sessionId \}/)
  assert.match(js, /active\.type !== 'record' \|\| active\.id !== this\._recordSessionId/)
  assert.match(js, /app\.globalData\.activeRecorderSession = null/)
  assert.match(js, /if \(this\._recorderBound\) return/)
})

test('record page uses PCM frames for waveform and interview uplink', () => {
  assert.match(js, /audio\.startPcmFrames\(\)/)
  assert.match(js, /manager\.onFrameRecorded/)
  assert.match(js, /wav\.peakAmplitude\(frame\.frameBuffer\)/)
  assert.match(js, /this\.interviewer\.onPcm16\(frame\.frameBuffer, 16000\)/)
  assert.match(js, /wav\.wrapPcm16Wav/)
  assert.match(js, /audio\.uploadFile\(finalizedPath, name, 'audio\/wav'\)/)
})

test('record page stops interview before primary recording and renders Android copy', () => {
  assert.match(js, /stopRecording\(\)\s*\{[\s\S]*this\.stopInterviewer\(\)[\s\S]*audio\.stop\(\)/)
  assert.match(wxml, /bindtap="toggleInterview"/)
  assert.match(wxml, />采访</)
  assert.match(wxml, /AI 采访中/)
  assert.match(wxml, /interviewStateText/)
  assert.match(wxss, /\.interview-button-column/)
  assert.match(wxss, /\.interview-button\.active/)
})

test('record page owns named recorder callbacks and releases them after the session', () => {
  const unload = js.slice(js.indexOf('onUnload()'), js.indexOf('onShow()'))
  assert.match(unload, /this\._alive = false[\s\S]*this\.stopRecording\(\)/)
  assert.match(js, /this\._frameRecordedHandler =/)
  assert.match(js, /this\._stopHandler =/)
  assert.match(js, /this\._errorHandler =/)
  assert.match(js, /manager\.offFrameRecorded\(this\._frameRecordedHandler\)/)
  assert.match(js, /manager\.offStop\(this\._stopHandler\)/)
  assert.match(js, /manager\.offError\(this\._errorHandler\)/)
})

test('a stale shared-recorder error callback cannot navigate or toast', () => {
  const shared = createRecorder()
  const old = loadPage({ recorder: shared })
  old.app.globalData.activeRecorderSession = { type: 'record', id: 'new-page-session' }

  shared.emitError(new Error('late recorder error'))

  assert.equal(old.calls.navigations, 0)
  assert.deepEqual(old.calls.toasts, [])
  assert.equal(shared.listenerCount('frame'), 0)
  assert.equal(shared.listenerCount('stop'), 0)
  assert.equal(shared.listenerCount('error'), 0)
})

test('unload stops an owned recording and its onStop still uploads', async () => {
  const h = loadPage()

  h.page.onUnload()
  assert.equal(h.recorder.stopCount, 1)
  assert.deepEqual(h.calls.order.slice(0, 2), ['interviewer.stop', 'recorder.stop'])
  h.recorder.emitStop({ tempFilePath: '/tmp/raw.pcm' })
  await flush()

  assert.equal(h.calls.uploads.length, 1)
})

test('a new page cannot replace an unloading recorder owner until the old stop arrives', async () => {
  const recorder = createRecorder()
  const app = { globalData: { pendingRecordTag: '', pendingReplyTo: null } }
  const old = loadPage({ app, recorder })
  const oldOwner = { ...app.globalData.activeRecorderSession }

  old.page.onUnload()
  const next = loadPage({ app, recorder })

  assert.deepEqual(app.globalData.activeRecorderSession, oldOwner)
  assert.equal(recorder.startCount, 1)
  assert.equal(recorder.listenerCount('stop'), 1)
  assert.equal(next.calls.toasts.at(-1).title, '上一段录音正在结束，请稍后重试')
  assert.equal(next.calls.navigations, 1)

  recorder.emitStop({ tempFilePath: '/tmp/old.pcm' })
  await flush()
  assert.equal(app.globalData.activeRecorderSession, null)

  next.page.startRecording()
  assert.equal(recorder.startCount, 2)
  assert.equal(app.globalData.activeRecorderSession.type, 'record')
  assert.notEqual(app.globalData.activeRecorderSession.id, oldOwner.id)
  next.page.onUnload()
})

test('an upload finishing after unload keeps data side effects but performs no UI side effects', async () => {
  const pendingUpload = deferred()
  const h = loadPage({
    upload: () => pendingUpload.promise,
    globalData: { pendingRecordTag: 'work', pendingReplyTo: null }
  })
  h.recorder.emitStop({ tempFilePath: '/tmp/raw.pcm' })
  h.page.onUnload()
  pendingUpload.resolve(true)
  await flush()

  assert.deepEqual(h.calls.tags, [{ name: 'session.m4a', tags: ['work'] }])
  assert.equal(h.calls.navigations, 0)
  assert.deepEqual(h.calls.toasts, [])
  assert.equal(h.calls.refreshes, 0)
})

test('WAV finalization uses the captured session id even if the page id later changes', async () => {
  let finishRead
  const fsManager = {
    readFile(options) { finishRead = () => options.success({ data: new ArrayBuffer(2) }) },
    writeFile(options) { this.writtenPath = options.filePath; options.success() },
    unlink(options) { options.success() }
  }
  const h = loadPage({ fsManager })
  const sessionId = h.page._recordSessionId

  const result = h.page.finalizePcmFile('/tmp/raw.pcm', sessionId)
  h.page._recordSessionId = 'replacement-session'
  finishRead()

  assert.equal(await result, `/user/voicedrop-${sessionId}.wav`)
  assert.equal(fsManager.writtenPath, `/user/voicedrop-${sessionId}.wav`)
})

test('the generated WAV is unlinked after both upload success and failure', async () => {
  const success = loadPage()
  const successId = success.page._recordSessionId
  success.recorder.emitStop({ tempFilePath: '/tmp/success.pcm' })
  await flush()
  assert.deepEqual(success.calls.unlinks, [`/user/voicedrop-${successId}.wav`])

  const failure = loadPage({ upload: () => Promise.reject(new Error('upload failed')) })
  const failureId = failure.page._recordSessionId
  failure.recorder.emitStop({ tempFilePath: '/tmp/failure.pcm' })
  await flush()
  assert.deepEqual(failure.calls.unlinks, [`/user/voicedrop-${failureId}.wav`])
  assert.equal(failure.calls.toasts.at(-1).title, '上传失败')
})

test('an automatic recorder stop stops the interviewer before upload', async () => {
  const h = loadPage()
  h.recorder.emitStop({ tempFilePath: '/tmp/raw.pcm' })
  await flush()

  assert.equal(h.calls.interviewerStops, 1)
  assert.equal(h.calls.uploads.length, 1)
  assert.deepEqual(h.calls.order.slice(0, 2), ['interviewer.stop', 'upload'])
})

test('double stop requests RecorderManager.stop only once', () => {
  const h = loadPage()

  h.page.stopRecording()
  h.page.stopRecording()

  assert.equal(h.recorder.stopCount, 1)
})

test('an interviewer stop error cannot block the primary recording stop', () => {
  const h = loadPage({ interviewerStopError: new Error('interview close failed') })

  assert.doesNotThrow(() => h.page.stopRecording())
  assert.equal(h.recorder.stopCount, 1)
  assert.deepEqual(h.calls.order.slice(0, 2), ['interviewer.stop', 'recorder.stop'])
})
