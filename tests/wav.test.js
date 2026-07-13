const test = require('node:test')
const assert = require('node:assert/strict')
const wav = require('../utils/wav')

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length))
}

function pcm16(samples) {
  const data = new ArrayBuffer(samples.length * 2)
  const view = new DataView(data)
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true))
  return data
}

function samplesOf(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const samples = []
  for (let offset = 0; offset < bytes.byteLength; offset += 2) samples.push(view.getInt16(offset, true))
  return samples
}

test('wraps mono PCM16 in a valid 16 kHz WAV container', () => {
  const pcm = new Uint8Array([0x00, 0x00, 0xe8, 0x03, 0x18, 0xfc])
  const output = wav.wrapPcm16Wav(pcm, { sampleRate: 16000, channels: 1, bitsPerSample: 16 })
  const bytes = new Uint8Array(output)
  const view = new DataView(output)
  assert.equal(ascii(bytes, 0, 4), 'RIFF')
  assert.equal(ascii(bytes, 8, 4), 'WAVE')
  assert.equal(ascii(bytes, 12, 4), 'fmt ')
  assert.equal(view.getUint32(24, true), 16000)
  assert.equal(view.getUint32(28, true), 32000)
  assert.equal(view.getUint16(32, true), 2)
  assert.equal(ascii(bytes, 36, 4), 'data')
  assert.equal(view.getUint32(40, true), pcm.length)
  assert.deepEqual(Array.from(bytes.slice(44)), Array.from(pcm))
})

test('calculates absolute PCM16 peak amplitude', () => {
  const data = new ArrayBuffer(8)
  const view = new DataView(data)
  ;[0, -1200, 32767, -200].forEach((n, i) => view.setInt16(i * 2, n, true))
  assert.equal(wav.peakAmplitude(data), 32767)
})

test('mixes scheduled 24 kHz AI speech into the 16 kHz microphone timeline', () => {
  const microphone = pcm16([0, 0, 100, 100, 0, 0, 0, 0])
  const ai = pcm16([3000, 3000, 3000, 3000, 3000, 3000])

  const mixed = wav.mixPcm16(microphone, [
    { data: ai, sampleRate: 24000, startSample: 2 }
  ], { sampleRate: 16000, overlayGain: 1 })

  assert.deepEqual(samplesOf(mixed), [0, 0, 3100, 3100, 3000, 3000, 0, 0])
})

test('clips mixed PCM16 samples instead of wrapping around', () => {
  const mixed = wav.mixPcm16(pcm16([32000, -32000]), [
    { data: pcm16([10000, -10000]), sampleRate: 16000, startSample: 0 }
  ], { sampleRate: 16000, overlayGain: 1 })

  assert.deepEqual(samplesOf(mixed), [32767, -32768])
})

test('ducks microphone speaker leakage while mixing the digital AI track', () => {
  const microphoneWithAiLeakage = pcm16([100, 1000, 1000, 1000, 100])
  const ai = pcm16([3000, 3000, 3000])

  const mixed = wav.mixPcm16(microphoneWithAiLeakage, [
    { data: ai, sampleRate: 16000, startSample: 1 }
  ], { sampleRate: 16000, overlayGain: 1, baseGainDuringOverlay: 0 })

  assert.deepEqual(samplesOf(mixed), [100, 3000, 3000, 3000, 100])
})
