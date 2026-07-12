const MODE_IDLE = 'idle'
const MODE_LOADING = 'loading'
const MODE_PLAYING = 'playing'

function initial() {
  return { mode: MODE_IDLE, progress: 0 }
}

function requestPlay(state) {
  if (state && state.mode !== MODE_IDLE) return { accepted: false, state: state || initial() }
  return { accepted: true, state: { mode: MODE_LOADING, progress: 0 } }
}

function requestStop(state) {
  if (!state || state.mode === MODE_IDLE) return { accepted: false, state: initial() }
  return { accepted: true, state: initial() }
}

function started() {
  return { mode: MODE_PLAYING, progress: 0 }
}

function completed() {
  return initial()
}

function failed() {
  return initial()
}

function progress(positionSeconds, durationSeconds) {
  const duration = Number(durationSeconds) || 0
  if (duration <= 0) return 0
  const value = (Number(positionSeconds) || 0) / duration
  return Math.max(0, Math.min(1, value))
}

module.exports = {
  MODE_IDLE,
  MODE_LOADING,
  MODE_PLAYING,
  initial,
  requestPlay,
  requestStop,
  started,
  completed,
  failed,
  progress
}
