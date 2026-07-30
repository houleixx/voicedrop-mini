const SILENT_PEAK_THRESHOLD = 300
const MIN_CHECK_SECONDS = 1.0
const MIN_DURATION_SECONDS = 4.0

function durationSeconds(reportedDurationMs, fallbackDurationMs = 0) {
  const reported = Number(reportedDurationMs)
  const fallback = Number(fallbackDurationMs)
  const milliseconds = Number.isFinite(reported) && reported > 0
    ? reported
    : (Number.isFinite(fallback) && fallback > 0 ? fallback : 0)
  return milliseconds / 1000
}

function isTooShort(duration) {
  return Number(duration) < MIN_DURATION_SECONDS
}

function looksSilent(peakAmplitude, durationSeconds) {
  return Number(durationSeconds) >= MIN_CHECK_SECONDS && Number(peakAmplitude) < SILENT_PEAK_THRESHOLD
}

module.exports = {
  SILENT_PEAK_THRESHOLD,
  MIN_CHECK_SECONDS,
  MIN_DURATION_SECONDS,
  durationSeconds,
  isTooShort,
  looksSilent
}
