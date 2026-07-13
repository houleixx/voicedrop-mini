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

function sampleAt(view, index) {
  return view.getInt16(index * 2, true)
}

function resamplePcm16(input, fromRate, toRate) {
  const bytes = bytesOf(input)
  const sourceCount = Math.floor(bytes.byteLength / 2)
  if (!sourceCount || !fromRate || !toRate) return new Int16Array(0)
  const source = new DataView(bytes.buffer, bytes.byteOffset, sourceCount * 2)
  const outputCount = Math.max(1, Math.round(sourceCount * toRate / fromRate))
  const output = new Int16Array(outputCount)
  for (let index = 0; index < outputCount; index += 1) {
    const position = index * fromRate / toRate
    const left = Math.min(sourceCount - 1, Math.floor(position))
    const right = Math.min(sourceCount - 1, left + 1)
    const fraction = position - left
    output[index] = Math.round(sampleAt(source, left) * (1 - fraction) + sampleAt(source, right) * fraction)
  }
  return output
}

function mixPcm16(input, overlays, options) {
  const base = bytesOf(input)
  const evenLength = base.byteLength - (base.byteLength % 2)
  const output = new Uint8Array(evenLength)
  output.set(base.subarray(0, evenLength))
  const view = new DataView(output.buffer)
  const sampleRate = Number(options && options.sampleRate) || 16000
  const gain = Number.isFinite(options && options.overlayGain) ? Number(options.overlayGain) : 0.85
  const baseGain = Number.isFinite(options && options.baseGainDuringOverlay)
    ? Number(options.baseGainDuringOverlay)
    : 1
  const sampleCount = evenLength / 2

  const prepared = (overlays || []).map((overlay) => {
    if (!overlay || !overlay.data) return
    const startSample = Number.isFinite(overlay.startSample)
      ? Math.max(0, Math.round(overlay.startSample))
      : Math.max(0, Math.round((Number(overlay.startMs) || 0) * sampleRate / 1000))
    const samples = resamplePcm16(overlay.data, Number(overlay.sampleRate) || sampleRate, sampleRate)
    return { startSample, samples }
  }).filter(Boolean)

  if (baseGain !== 1) {
    prepared.forEach(({ startSample, samples }) => {
      for (let index = 0; index < samples.length && startSample + index < sampleCount; index += 1) {
        const offset = (startSample + index) * 2
        view.setInt16(offset, Math.round(view.getInt16(offset, true) * baseGain), true)
      }
    })
  }

  prepared.forEach(({ startSample, samples }) => {
    for (let index = 0; index < samples.length && startSample + index < sampleCount; index += 1) {
      const offset = (startSample + index) * 2
      const mixed = view.getInt16(offset, true) + Math.round(samples[index] * gain)
      view.setInt16(offset, Math.max(-32768, Math.min(32767, mixed)), true)
    }
  })
  return output.buffer
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

module.exports = { peakAmplitude, mixPcm16, wrapPcm16Wav }
