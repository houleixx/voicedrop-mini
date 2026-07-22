const realtimeSession = require('./realtime-session')
const realtimePlayer = require('./realtime-audio-player')
const muLaw = require('../utils/mu-law')

function stateText(active, state, muted, playbackError) {
  if (!active) return ''
  if (state === 'connecting') return 'AI 连接中…'
  if (state === 'degraded') return 'AI 已断开 · 录音继续'
  if (state === 'unavailable') return 'AI 采访暂不可用 · 录音继续'
  if (playbackError) return 'AI 语音播放异常 · 采访仍在进行'
  if (state === 'live') return muted ? 'AI 正在说话' : 'AI 采访中 · 再点一下结束'
  return 'AI 采访中'
}

function createInterviewer(handlers, injected) {
  const deps = injected || {}
  const notify = (handlers && handlers.onChange) || (() => {})
  const later = deps.setTimeout || setTimeout
  const cancel = deps.clearTimeout || clearTimeout
  const convert = deps.pcm16ToPcmu8k || muLaw.pcm16ToPcmu8k
  let active = false
  let connectionState = 'idle'
  let muted = false
  let responseDone = false
  let playbackError = false
  let reconnectAttempt = 0
  let reconnectTimer = null
  let resumeTimer = null
  let watchdog = null

  const player = (deps.createPlayer || realtimePlayer.createPlayer)({
    onDrain: () => tryResume(),
    onError: () => {
      playbackError = true
      changed()
    },
    onScheduled: (data, delayMs) => {
      if (handlers && typeof handlers.onAiAudio === 'function') {
        handlers.onAiAudio(data, delayMs)
      }
    }
  })
  const session = (deps.createSession || realtimeSession.createSession)({
    onState: (state) => {
      connectionState = state
      if (state === 'live') reconnectAttempt = 0
      if (state === 'degraded') scheduleReconnect()
      if (state === 'unavailable') {
        if (reconnectTimer) cancel(reconnectTimer)
        if (resumeTimer) cancel(resumeTimer)
        if (watchdog) cancel(watchdog)
        reconnectTimer = null
        resumeTimer = null
        watchdog = null
        muted = true
        responseDone = false
        player.stop()
      }
      changed()
    },
    onResponseCreated: () => beginAiTurn(),
    onAudioDelta: (pcm) => {
      beginAiTurn()
      if (player.enqueue(pcm) && playbackError) {
        playbackError = false
        changed()
      }
    },
    onResponseDone: () => {
      responseDone = true
      tryResume()
    }
  })

  function snapshot() {
    return {
      active,
      state: connectionState,
      muted,
      stateText: stateText(active, connectionState, muted, playbackError)
    }
  }

  function changed() { notify(snapshot()) }

  function start() {
    if (active) return
    active = true
    muted = false
    responseDone = false
    playbackError = false
    reconnectAttempt = 0
    player.prepare()
    session.connect()
    changed()
  }

  function stop() {
    active = false
    muted = false
    responseDone = false
    playbackError = false
    if (reconnectTimer) cancel(reconnectTimer)
    if (resumeTimer) cancel(resumeTimer)
    if (watchdog) cancel(watchdog)
    reconnectTimer = null
    resumeTimer = null
    watchdog = null
    reconnectAttempt = 0
    player.stop()
    session.disconnect()
    connectionState = 'idle'
    changed()
  }

  function toggle() {
    if (active) stop()
    else start()
  }

  function onPcm16(frame, sampleRate) {
    if (!active || muted || connectionState === 'unavailable') return
    const encoded = convert(frame, sampleRate)
    if (encoded.byteLength) session.appendAudio(encoded)
  }

  function beginAiTurn() {
    if (!active) return
    muted = true
    responseDone = false
    if (resumeTimer) cancel(resumeTimer)
    if (watchdog) cancel(watchdog)
    watchdog = later(() => {
      watchdog = null
      openMic()
    }, 15000)
    changed()
  }

  function openMic() {
    if (active) session.clearInputBuffer()
    muted = false
    changed()
  }

  function tryResume() {
    if (!muted || !responseDone || !player.isIdle()) return
    if (resumeTimer) cancel(resumeTimer)
    resumeTimer = later(() => {
      if (watchdog) cancel(watchdog)
      watchdog = null
      resumeTimer = null
      openMic()
    }, 500)
  }

  function scheduleReconnect() {
    if (!active || reconnectTimer || reconnectAttempt >= 6) return
    const delay = (2 ** reconnectAttempt) * 1000
    reconnectAttempt += 1
    reconnectTimer = later(() => {
      reconnectTimer = null
      if (!active || connectionState !== 'degraded') return
      if (resumeTimer) cancel(resumeTimer)
      if (watchdog) cancel(watchdog)
      resumeTimer = null
      watchdog = null
      muted = false
      responseDone = false
      session.disconnect()
      session.connect()
      changed()
    }, delay)
  }

  return {
    toggle,
    start,
    stop,
    onPcm16,
    active: () => active,
    state: snapshot,
    stateText: () => stateText(active, connectionState, muted, playbackError)
  }
}

module.exports = { createInterviewer, stateText }
