const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const js = fs.readFileSync(path.join(root, 'pages/record/index.js'), 'utf8')
const wxml = fs.readFileSync(path.join(root, 'pages/record/index.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/record/index.wxss'), 'utf8')
const config = JSON.parse(fs.readFileSync(path.join(root, 'pages/record/index.json'), 'utf8'))

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

function pendingItems(h) {
  const value = h.storage['vd.pendingRecordingUploads.v1']
  return typeof value === 'string' ? JSON.parse(value) : value
}

function createRecorder() {
  const callbacks = { frame: [], stop: [], error: [], pause: [], resume: [], interruptionBegin: [], interruptionEnd: [] }
  const recorder = {
    startCount: 0,
    stopCount: 0,
    pauseCount: 0,
    resumeCount: 0,
    start() { this.startCount += 1 },
    onFrameRecorded(fn) { callbacks.frame.push(fn) },
    onStop(fn) { callbacks.stop.push(fn) },
    onError(fn) { callbacks.error.push(fn) },
    onPause(fn) { callbacks.pause.push(fn) },
    onResume(fn) { callbacks.resume.push(fn) },
    onInterruptionBegin(fn) { callbacks.interruptionBegin.push(fn) },
    onInterruptionEnd(fn) { callbacks.interruptionEnd.push(fn) },
    offFrameRecorded(fn) { callbacks.frame = callbacks.frame.filter((item) => item !== fn) },
    offStop(fn) { callbacks.stop = callbacks.stop.filter((item) => item !== fn) },
    offError(fn) { callbacks.error = callbacks.error.filter((item) => item !== fn) },
    offPause(fn) { callbacks.pause = callbacks.pause.filter((item) => item !== fn) },
    offResume(fn) { callbacks.resume = callbacks.resume.filter((item) => item !== fn) },
    offInterruptionBegin(fn) { callbacks.interruptionBegin = callbacks.interruptionBegin.filter((item) => item !== fn) },
    offInterruptionEnd(fn) { callbacks.interruptionEnd = callbacks.interruptionEnd.filter((item) => item !== fn) },
    stop() { this.stopCount += 1 },
    pause() { this.pauseCount += 1 },
    resume() { this.resumeCount += 1 },
    emitFrame(frame) { callbacks.frame.slice().forEach((fn) => fn(frame)) },
    emitStop(result) {
      const payload = Object.assign({ duration: 5000 }, result)
      callbacks.stop.slice().forEach((fn) => fn(payload))
    },
    emitError(error) { callbacks.error.slice().forEach((fn) => fn(error)) },
    emitPause() { callbacks.pause.slice().forEach((fn) => fn()) },
    emitResume() { callbacks.resume.slice().forEach((fn) => fn()) },
    emitInterruptionBegin() { callbacks.interruptionBegin.slice().forEach((fn) => fn()) },
    emitInterruptionEnd() { callbacks.interruptionEnd.slice().forEach((fn) => fn()) },
    listenerCount(type) { return callbacks[type].length }
  }
  return recorder
}

function loadPage(overrides = {}) {
  const recorder = overrides.recorder || createRecorder()
  const app = overrides.app || { globalData: { pendingRecordTag: '', pendingReplyTo: null, ...(overrides.globalData || {}) } }
  const storage = {}
  const calls = { uploads: [], photoUploads: [], tags: [], mixes: [], toasts: [], modals: [], navigations: 0, unlinks: [], interviewerStops: 0, refreshes: 0, order: [] }
  const upload = overrides.upload || (() => Promise.resolve(true))
  const audio = {
    recorder: () => recorder,
    startPcmFrames: () => recorder.start(),
    stop: () => { calls.order.push('recorder.stop'); recorder.stop() },
    nameForSession: () => 'session.m4a',
    discardFile(filePath) {
      calls.unlinks.push(filePath)
      return Promise.resolve(true)
    },
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
    onPcm16() {},
    emitAiAudio(data, delayMs) { if (this.onAiAudio) this.onAiAudio(data, delayMs) }
  }
  const realtimeInterviewer = {
    createInterviewer(handlers) {
      interviewer.onAiAudio = handlers.onAiAudio
      return interviewer
    }
  }
  const wav = {
    peakAmplitude: () => 0,
    mixPcm16(data, overlays, options) {
      calls.mixes.push({ data, overlays, options })
      return data
    },
    wrapPcm16Wav: (data) => data
  }
  const library = {
    uploadPhoto(filePath, key) {
      calls.order.push('photo.upload')
      calls.photoUploads.push({ filePath, key })
      return overrides.photoUpload ? overrides.photoUpload(filePath, key) : Promise.resolve(true)
    }
  }
  const fsManager = overrides.fsManager || {
    readFile(options) { options.success({ data: new ArrayBuffer(3200) }) },
    writeFile(options) { options.success() },
    copyFile(options) { options.success() },
    unlink(options) { calls.unlinks.push(options.filePath); options.success() }
  }
  let definition
  global.getApp = () => app
  global.Page = (value) => { definition = value }
  global.getCurrentPages = () => [{ load() { calls.refreshes += 1 } }]
  global.wx = {
    env: { USER_DATA_PATH: '/user' },
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = value },
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    getFileSystemManager: () => fsManager,
    showLoading() {},
    hideLoading() {},
    showToast(options) { calls.toasts.push(options) },
    showModal(options) { calls.modals.push(options) },
    navigateBack(options = {}) { calls.navigations += 1; if (options.success) options.success() }
  }
  if (overrides.chooseMedia !== undefined) global.wx.chooseMedia = overrides.chooseMedia
  if (overrides.chooseImage !== undefined) global.wx.chooseImage = overrides.chooseImage

  const moduleIds = [
    '../pages/record/index',
    '../services/audio',
    '../services/library',
    '../services/recording-upload-queue',
    '../utils/wav',
    '../services/realtime-interviewer'
  ]
  moduleIds.forEach((id) => { delete require.cache[require.resolve(id)] })
  require.cache[require.resolve('../services/audio')] = { exports: audio }
  require.cache[require.resolve('../services/library')] = { exports: library }
  require.cache[require.resolve('../utils/wav')] = { exports: wav }
  require.cache[require.resolve('../services/realtime-interviewer')] = { exports: realtimeInterviewer }
  require('../pages/record/index')

  const page = { ...definition, data: { ...definition.data } }
  page.setData = function setData(next) { Object.assign(this.data, next) }
  const originalSetInterval = global.setInterval
  global.setInterval = () => 101
  page.onLoad({})
  global.setInterval = originalSetInterval
  return { page, app, recorder, interviewer, calls, fsManager, storage }
}

test('record page owns one guarded recording session', () => {
  assert.doesNotMatch(js, /looksSilent\(0,\s*elapsed\)/)
  assert.match(js, /app\.globalData\.activeRecorderSession = \{ type: 'record', id: sessionId \}/)
  assert.match(js, /active\.type !== 'record' \|\| active\.id !== this\._recordSessionId/)
  assert.match(js, /app\.globalData\.activeRecorderSession = null/)
  assert.match(js, /if \(this\._recorderBound\) return/)
})

test('record page discards a recording shorter than four seconds before staging or upload', async () => {
  const h = loadPage({
    globalData: { pendingRecordTag: '工作', pendingReplyTo: 'share-1' }
  })

  h.recorder.emitStop({ tempFilePath: '/tmp/short.pcm', duration: 3999 })
  await flush()

  assert.deepEqual(h.calls.unlinks, ['/tmp/short.pcm'])
  assert.equal(h.calls.uploads.length, 0)
  assert.equal(h.app.globalData.pendingRecordTag, '')
  assert.equal(h.app.globalData.pendingReplyTo, null)
  assert.equal(h.calls.modals.length, 1)
  assert.equal(h.calls.modals[0].title, '录音太短')
  assert.match(h.calls.modals[0].content, /不足以产生文章/)
})

test('record page uses the shared page header and custom navigation', () => {
  assert.equal(config.navigationStyle, 'custom')
  assert.equal(config.usingComponents['page-header'], '../../components/page-header/index')
  assert.match(wxml, /<page-header title="录音"\s*\/>/)
  assert.doesNotMatch(wxml, /class="status-bar"[^>]*padding-top:/)
  assert.match(wxss, /\.status-bar\s*\{[^}]*padding-top:\s*180rpx;/)
  assert.doesNotMatch(js, /getSystemInfoSync/)
})

test('record page uses PCM frames for waveform and interview uplink', () => {
  assert.match(js, /audio\.startPcmFrames\(\)/)
  assert.match(js, /manager\.onFrameRecorded/)
  assert.match(js, /wav\.peakAmplitude\(frame\.frameBuffer\)/)
  assert.match(js, /this\.interviewer\.onPcm16\(frame\.frameBuffer, 16000\)/)
  assert.match(js, /wav\.wrapPcm16Wav/)
  assert.match(js, /wav\.mixPcm16/)
  assert.match(js, /recordingUploads\.stage\(\{/)
  assert.match(js, /contentType: 'audio\/wav'/)
  assert.doesNotMatch(js, /recordingUploads\.upload\(item\.name\)/)
  assert.match(js, /wx\.navigateBack\(/)
})

test('record page mixes AI playback into the final microphone PCM timeline', async () => {
  const h = loadPage()
  const ai = new ArrayBuffer(4)

  h.interviewer.emitAiAudio(ai, 250)
  await h.page.finalizePcmFile('/tmp/raw.pcm', h.page._recordSessionId)

  assert.equal(h.calls.mixes.length, 1)
  assert.equal(h.calls.mixes[0].overlays.length, 1)
  assert.equal(h.calls.mixes[0].overlays[0].data, ai)
  assert.equal(h.calls.mixes[0].overlays[0].sampleRate, 24000)
  assert.ok(h.calls.mixes[0].overlays[0].startMs >= 250)
  assert.equal(h.calls.mixes[0].options.sampleRate, 16000)
  assert.equal(h.calls.mixes[0].options.baseGainDuringOverlay, 0)
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

test('record page side controls sit closer to the center', () => {
  assert.match(wxss, /\.interview-button-column\s*\{[^}]*left:\s*88rpx;/)
  assert.match(wxss, /\.camera-button-column\s*\{[^}]*right:\s*88rpx;/)
})

test('record page captures camera or album images into the current recording filmstrip', () => {
  let request
  const h = loadPage({
    chooseMedia(options) {
      request = options
      options.success({ tempFiles: [{ tempFilePath: '/tmp/scene.jpg' }] })
      options.complete()
    }
  })
  h.page.data.startedAt = new Date(2026, 6, 26, 10, 20, 30).getTime()

  h.page.takePhoto()
  assert.equal(request, undefined)
  h.recorder.emitPause()

  assert.deepEqual(request.sourceType, ['camera', 'album'])
  assert.deepEqual(request.mediaType, ['image'])
  assert.equal(h.page.data.capturedPhotos.length, 1)
  assert.equal(h.page.data.capturedPhotos[0].path, '/tmp/scene.jpg')
  assert.match(h.page.data.capturedPhotos[0].key, /^photos\/2026-07-26-102030\/\d+-[0-9a-z]{3}\.jpg$/)
  assert.match(wxml, /class="photo-filmstrip"/)
  assert.match(wxml, /catchtap="removePhoto"/)
})

test('record page removes a captured photo before upload', () => {
  const h = loadPage()
  h.page.setData({
    capturedPhotos: [
      { path: '/tmp/a.jpg', key: 'photos/session/1-abc.jpg' },
      { path: '/tmp/b.jpg', key: 'photos/session/2-def.jpg' }
    ]
  })

  h.page.removePhoto({ currentTarget: { dataset: { index: 0 } } })

  assert.deepEqual(h.page.data.capturedPhotos, [
    { path: '/tmp/b.jpg', key: 'photos/session/2-def.jpg' }
  ])
})

test('record page stages photos and immediately returns to the recordings list', async () => {
  const h = loadPage()
  h.page.setData({
    capturedPhotos: [
      { path: '/tmp/a.jpg', key: 'photos/session/1-abc.jpg' },
      { path: '/tmp/b.jpg', key: 'photos/session/2-def.jpg' }
    ]
  })

  h.recorder.emitStop({ tempFilePath: '/tmp/raw.pcm' })
  await flush()
  await flush()

  assert.equal(h.calls.photoUploads.length, 0)
  assert.equal(h.calls.uploads.length, 0)
  assert.equal(h.calls.navigations, 1)
})

test('a recording with photos returns once its durable upload plan is staged', async () => {
  const h = loadPage({ photoUpload: () => Promise.reject(new Error('photo offline')) })
  h.page.setData({
    capturedPhotos: [{ path: '/tmp/a.jpg', key: 'photos/session/1-abc.jpg' }]
  })

  h.recorder.emitStop({ tempFilePath: '/tmp/raw.pcm' })
  await flush()
  await flush()

  assert.equal(h.calls.uploads.length, 0)
  assert.equal(h.calls.photoUploads.length, 0)
  assert.equal(h.calls.navigations, 1)
  assert.equal(pendingItems(h).length, 1)
})

test('record page resumes its elapsed timer after returning from the system picker', () => {
  const show = js.slice(js.indexOf('onShow()'), js.indexOf('onHide()'))
  assert.match(show, /this\.startTimer\(\)/)
  assert.match(js, /startTimer\(\)\s*\{[\s\S]*if \(this\.data\.timerInterval\) return/)
})

test('canceling the system photo picker resumes the owned RecorderManager after returning', () => {
  let request
  const h = loadPage({
    chooseMedia(options) { request = options }
  })

  h.page.takePhoto()
  h.recorder.emitPause()
  h.page.onHide()
  request.fail({ errMsg: 'chooseMedia:fail cancel' })
  request.complete()
  assert.equal(h.recorder.resumeCount, 0)

  h.page.onShow()

  assert.equal(h.recorder.resumeCount, 1)
  assert.equal(h.recorder.listenerCount('pause'), 1)
  assert.equal(h.recorder.listenerCount('resume'), 1)
  assert.equal(h.recorder.listenerCount('interruptionBegin'), 1)
  assert.equal(h.recorder.listenerCount('interruptionEnd'), 1)
  h.page.onUnload()
})

test('the recorder is paused before opening a system picker so its PCM remains usable', async () => {
  let request
  let openedWhileRunning = false
  const recorder = createRecorder()
  const fsManager = {
    readFile(options) {
      options.success({ data: new ArrayBuffer(openedWhileRunning ? 0 : 3200) })
    },
    writeFile(options) { options.success() },
    copyFile(options) { options.success() },
    saveFile(options) { options.success({ savedFilePath: options.filePath }) },
    unlink(options) { options.success() }
  }
  const h = loadPage({
    recorder,
    fsManager,
    chooseMedia(options) {
      request = options
      openedWhileRunning = recorder.pauseCount === 0
    }
  })

  h.page.takePhoto()
  h.recorder.emitPause()
  h.page.onHide()
  request.fail({ errMsg: 'chooseMedia:fail cancel' })
  request.complete()
  h.page.onShow()
  h.recorder.emitResume()
  h.recorder.emitStop({ tempFilePath: '/tmp/picker-session.pcm' })
  await flush()
  await flush()

  assert.equal(openedWhileRunning, false)
  assert.equal(h.recorder.pauseCount, 1)
  assert.equal(h.calls.modals.length, 0)
  assert.equal(h.calls.uploads.length, 0)
  assert.equal(h.calls.navigations, 1)
})

test('returning before the picker complete callback still resumes recording exactly once', () => {
  let request
  const h = loadPage({
    chooseMedia(options) { request = options }
  })

  h.page.takePhoto()
  h.recorder.emitPause()
  h.page.onHide()
  h.page.onShow()
  assert.equal(h.recorder.resumeCount, 0)

  request.fail({ errMsg: 'chooseMedia:fail cancel' })
  request.complete()
  request.complete()

  assert.equal(h.recorder.resumeCount, 1)
  h.page.onUnload()
})

test('a RecorderManager system interruption resumes the owned recording', () => {
  const h = loadPage()

  h.recorder.emitInterruptionBegin()
  h.recorder.emitPause()
  assert.ok(h.page._recordingPausedAt)

  h.recorder.emitInterruptionEnd()
  assert.equal(h.recorder.resumeCount, 1)

  h.recorder.emitResume()
  assert.equal(h.page._recordingPausedAt, 0)
  h.page.onUnload()
})

test('an empty PCM file after a recorder interruption is never uploaded', async () => {
  const fsManager = {
    readFile(options) { options.success({ data: new ArrayBuffer(0) }) },
    writeFile() { throw new Error('empty PCM must not be written') },
    copyFile(options) { options.success() },
    unlink(options) { options.success() }
  }
  const h = loadPage({ fsManager })

  h.recorder.emitStop({ tempFilePath: '/tmp/empty-after-picker.pcm' })
  await flush()
  await flush()

  assert.equal(h.calls.uploads.length, 0)
  assert.equal(h.calls.photoUploads.length, 0)
  assert.equal(h.calls.modals.at(-1).title, '录音已中断')
  assert.match(h.calls.modals.at(-1).content, /没有录到有效声音/)
})

test('record page owns named recorder callbacks and releases them after the session', () => {
  const unload = js.slice(js.indexOf('onUnload()'), js.indexOf('onShow()'))
  assert.match(unload, /this\._alive = false[\s\S]*this\.stopRecording\(\)/)
  assert.match(js, /this\._frameRecordedHandler =/)
  assert.match(js, /this\._stopHandler =/)
  assert.match(js, /this\._errorHandler =/)
  assert.match(js, /this\._pauseHandler =/)
  assert.match(js, /this\._resumeHandler =/)
  assert.match(js, /this\._interruptionBeginHandler =/)
  assert.match(js, /this\._interruptionEndHandler =/)
  assert.match(js, /manager\.offFrameRecorded\(this\._frameRecordedHandler\)/)
  assert.match(js, /manager\.offStop\(this\._stopHandler\)/)
  assert.match(js, /manager\.offError\(this\._errorHandler\)/)
  assert.match(js, /manager\.offPause\(this\._pauseHandler\)/)
  assert.match(js, /manager\.offResume\(this\._resumeHandler\)/)
  assert.match(js, /manager\.offInterruptionBegin\(this\._interruptionBeginHandler\)/)
  assert.match(js, /manager\.offInterruptionEnd\(this\._interruptionEndHandler\)/)
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

test('a current recorder error exposes errMsg and stays on the record page', () => {
  const h = loadPage()

  h.recorder.emitError({ errMsg: 'operateRecorder:fail auth deny' })

  assert.equal(h.app.globalData.activeRecorderSession, null)
  assert.equal(h.calls.navigations, 0)
  assert.equal(h.calls.modals.length, 1)
  assert.equal(h.calls.modals[0].title, '录音失败')
  assert.match(h.calls.modals[0].content, /operateRecorder:fail auth deny/)
  assert.equal(h.recorder.listenerCount('frame'), 0)
  assert.equal(h.recorder.listenerCount('stop'), 0)
  assert.equal(h.recorder.listenerCount('error'), 0)
})

test('unload stops an owned recording and its onStop still stages a durable upload', async () => {
  const h = loadPage()

  h.page.onUnload()
  assert.equal(h.recorder.stopCount, 1)
  assert.deepEqual(h.calls.order.slice(0, 2), ['interviewer.stop', 'recorder.stop'])
  h.recorder.emitStop({ tempFilePath: '/tmp/raw.pcm' })
  await flush()

  assert.equal(h.calls.uploads.length, 0)
  assert.equal(pendingItems(h).length, 1)
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

test('staging after unload keeps the durable plan but performs no UI side effects', async () => {
  const h = loadPage({
    globalData: { pendingRecordTag: 'work', pendingReplyTo: null }
  })
  h.recorder.emitStop({ tempFilePath: '/tmp/raw.pcm' })
  h.page.onUnload()
  await flush()

  assert.equal(pendingItems(h)[0].tag, 'work')
  assert.equal(h.calls.navigations, 0)
  assert.deepEqual(h.calls.toasts, [])
})

test('WAV finalization uses the captured session id even if the page id later changes', async () => {
  let finishRead
  const fsManager = {
    readFile(options) { finishRead = () => options.success({ data: new ArrayBuffer(3200) }) },
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

test('the generated WAV remains available for the recordings-page upload queue', async () => {
  const h = loadPage()
  const sessionId = h.page._recordSessionId
  h.recorder.emitStop({ tempFilePath: '/tmp/staged.pcm' })
  await flush()

  assert.equal(h.calls.unlinks.includes(`/user/voicedrop-${sessionId}.wav`), false)
  assert.equal(pendingItems(h)[0].audioPath,
    `/user/voicedrop-${sessionId}.wav`)
})

test('an automatic recorder stop stops the interviewer before staging its upload', async () => {
  const h = loadPage()
  h.recorder.emitStop({ tempFilePath: '/tmp/raw.pcm' })
  await flush()

  assert.equal(h.calls.interviewerStops, 1)
  assert.equal(h.calls.uploads.length, 0)
  assert.equal(h.calls.navigations, 1)
  assert.equal(h.calls.order[0], 'interviewer.stop')
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
