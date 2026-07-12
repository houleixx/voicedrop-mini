const BIAS = 0x84
const CLIP = 32635

function bytesOf(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  return new Uint8Array(0)
}

function linearToMuLaw(value) {
  let sample = value
  const sign = (sample >> 8) & 0x80
  if (sign) sample = -sample
  if (sample > CLIP) sample = CLIP
  sample += BIAS
  let exponent = 7
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) exponent -= 1
  const mantissa = (sample >> (exponent + 3)) & 0x0f
  return (~(sign | (exponent << 4) | mantissa)) & 0xff
}

function pcm16ToPcmu8k(input, sampleRate) {
  const bytes = bytesOf(input)
  if (bytes.byteLength < 2 || bytes.byteLength % 2 !== 0 || (sampleRate !== 8000 && sampleRate !== 16000)) {
    return new Uint8Array(0)
  }
  const samples = bytes.byteLength / 2
  const step = sampleRate === 16000 ? 2 : 1
  const out = new Uint8Array(Math.ceil(samples / step))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let write = 0
  for (let index = 0; index < samples; index += step) {
    out[write] = linearToMuLaw(view.getInt16(index * 2, true))
    write += 1
  }
  return write === out.length ? out : out.slice(0, write)
}

module.exports = { pcm16ToPcmu8k, linearToMuLaw }
