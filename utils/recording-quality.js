const SILENT_PEAK_THRESHOLD = 300
const MIN_CHECK_SECONDS = 1.0

function looksSilent(peakAmplitude, durationSeconds) {
  return Number(durationSeconds) >= MIN_CHECK_SECONDS && Number(peakAmplitude) < SILENT_PEAK_THRESHOLD
}

module.exports = {
  SILENT_PEAK_THRESHOLD,
  MIN_CHECK_SECONDS,
  looksSilent
}
