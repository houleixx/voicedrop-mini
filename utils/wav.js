function bytesOf(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  return new Uint8Array(0)
}

function peakAmplitude(input) {
  const bytes = bytesOf(input)
  const evenLength = bytes.byteLength - (bytes.byteLength % 2)
  const view = new DataView(bytes.buffer, bytes.byteOffset, evenLength)
  let peak = 0
  for (let offset = 0; offset < evenLength; offset += 2) {
    peak = Math.max(peak, Math.abs(view.getInt16(offset, true)))
  }
  return peak
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
}

function wrapPcm16Wav(input, options) {
  const pcm = bytesOf(input)
  const sampleRate = Number(options && options.sampleRate) || 16000
  const channels = Number(options && options.channels) || 1
  const bitsPerSample = Number(options && options.bitsPerSample) || 16
  const blockAlign = channels * bitsPerSample / 8
  const out = new ArrayBuffer(44 + pcm.byteLength)
  const view = new DataView(out)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + pcm.byteLength, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, pcm.byteLength, true)
  new Uint8Array(out, 44).set(pcm)
  return out
}

module.exports = { peakAmplitude, wrapPcm16Wav }
