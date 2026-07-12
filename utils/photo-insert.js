function instructionForKeys(relKeys) {
  if (!relKeys || !relKeys.length) return ''
  const markers = relKeys.map((key) => `[[photo:${key}]]`).join('、')
  const countWord = relKeys.length === 1 ? '这张照片' : `这${relKeys.length}张照片`
  const pronoun = relKeys.length === 1 ? '它' : '每一张都'
  return `我刚拍了${countWord}，请把${pronoun}插入文章里最合适的位置。每张照片用它自己的标记（原样写进正文，放在和场景最相符的段落附近）：${markers}。所有照片必须全部插入，不能遗漏。`
}

function offsetSeconds(sessionTs, captureTime) {
  const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(sessionTs || '')
  if (!captureTime) return 0
  if (!match) return 0
  const start = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]))
  const capture = captureTime instanceof Date ? captureTime : new Date(captureTime)
  if (Number.isNaN(capture.getTime())) return 0
  return Math.max(0, Math.floor((capture.getTime() - start.getTime()) / 1000))
}

function mediaCaptureTime(file) {
  if (!file) return null
  const value = file.time || file.createTime || file.lastModified || file.lastModifiedDate
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'number' && value > 0) {
    return new Date(value < 10000000000 ? value * 1000 : value)
  }
  return new Date(value)
}

function photoOffsetForFile(sessionTs, file, fallbackIndex) {
  const capture = mediaCaptureTime(file)
  if (!capture || Number.isNaN(capture.getTime())) return Math.max(0, fallbackIndex || 0)
  return offsetSeconds(sessionTs, capture)
}

function sampleSizeForBounds(width, height, maxPixel) {
  if (width <= 0 || height <= 0 || maxPixel <= 0) return 1
  let sample = 1
  while ((width / sample) > maxPixel || (height / sample) > maxPixel) {
    sample *= 2
  }
  return sample
}

module.exports = {
  instructionForKeys,
  offsetSeconds,
  mediaCaptureTime,
  photoOffsetForFile,
  sampleSizeForBounds
}
