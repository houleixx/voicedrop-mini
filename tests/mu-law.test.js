const test = require('node:test')
const assert = require('node:assert/strict')
const muLaw = require('../utils/mu-law')

function pcm16(samples) {
  const out = new ArrayBuffer(samples.length * 2)
  const view = new DataView(out)
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true))
  return out
}

test('encodes PCM16 samples with the Android G.711 algorithm', () => {
  const encoded = muLaw.pcm16ToPcmu8k(pcm16([0, 1000, -1000, 32000, -32000]), 8000)
  assert.deepEqual(Array.from(encoded), [255, 206, 78, 128, 0])
})

test('downsamples 16 kHz input to 8 kHz by taking every second sample', () => {
  const all = muLaw.pcm16ToPcmu8k(pcm16([0, 111, 1000, 222, -1000, 333]), 16000)
  const expected = muLaw.pcm16ToPcmu8k(pcm16([0, 1000, -1000]), 8000)
  assert.deepEqual(all, expected)
})

test('returns an empty byte array for invalid input', () => {
  assert.equal(muLaw.pcm16ToPcmu8k(new Uint8Array([1]), 16000).length, 0)
  assert.equal(muLaw.pcm16ToPcmu8k(new Uint8Array([0, 0]), 0).length, 0)
})

test('rejects sample rates without a frame-safe 8 kHz conversion contract', () => {
  const input = pcm16([0, 1000, -1000, 2000])
  assert.equal(muLaw.pcm16ToPcmu8k(input, 44100).length, 0)
  assert.equal(muLaw.pcm16ToPcmu8k(input, 48000).length, 0)
})
