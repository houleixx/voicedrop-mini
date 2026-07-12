const test = require('node:test')
const assert = require('node:assert/strict')
const wav = require('../utils/wav')

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length))
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
