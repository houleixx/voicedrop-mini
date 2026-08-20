const { nacl, gcm, hkdf, sha256 } = require('./device-link-primitives')

const SALT = utf8('voicedrop-device-link/v1')
const INFO = utf8('anon-token')

function utf8(value) {
  const input = String(value || '')
  const encoded = unescape(encodeURIComponent(input))
  const output = new Uint8Array(encoded.length)
  for (let index = 0; index < encoded.length; index += 1) output[index] = encoded.charCodeAt(index)
  return output
}

function b64url(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]
    const hasB = index + 1 < bytes.length
    const hasC = index + 2 < bytes.length
    const b = hasB ? bytes[index + 1] : 0
    const c = hasC ? bytes[index + 2] : 0
    output += alphabet[a >> 2]
    output += alphabet[((a & 3) << 4) | (b >> 4)]
    if (hasB) output += alphabet[((b & 15) << 2) | (c >> 6)]
    if (hasC) output += alphabet[c & 63]
  }
  return output
}

function unb64url(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const input = String(value || '').replace(/=+$/, '')
  if (!input || input.length % 4 === 1) throw new Error('设备配对公钥格式错误')
  const output = new Uint8Array(Math.floor(input.length * 6 / 8))
  let bits = 0
  let bitCount = 0
  let offset = 0
  for (const char of input) {
    const next = alphabet.indexOf(char)
    if (next < 0) throw new Error('设备配对公钥格式错误')
    bits = (bits << 6) | next
    bitCount += 6
    if (bitCount >= 8) {
      bitCount -= 8
      output[offset] = (bits >> bitCount) & 0xff
      offset += 1
      bits &= bitCount ? (1 << bitCount) - 1 : 0
    }
  }
  return output
}

function secureRandom(length) {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx.getRandomValues !== 'function') {
      reject(new Error('当前微信版本不支持安全设备登录'))
      return
    }
    wx.getRandomValues({
      length,
      success: (result) => resolve(new Uint8Array(result.randomValues)),
      fail: () => reject(new Error('无法生成设备登录密钥'))
    })
  })
}

async function encrypt(token, publicKeyB64, options) {
  const publicKey = unb64url(publicKeyB64)
  if (publicKey.length !== nacl.box.publicKeyLength) throw new Error('X25519 公钥长度错误')

  const randomBytes = options && options.randomBytes ? options.randomBytes : secureRandom
  const random = await randomBytes(44)
  if (!(random instanceof Uint8Array) || random.length !== 44) throw new Error('设备登录随机数长度错误')

  const secretKey = random.slice(0, 32)
  const nonce = random.slice(32)
  const ephemeral = nacl.box.keyPair.fromSecretKey(secretKey)
  const shared = nacl.scalarMult(secretKey, publicKey)
  const key = hkdf(sha256, shared, SALT, INFO, 32)
  const encrypted = gcm(key, nonce).encrypt(utf8(token))
  const sealed = new Uint8Array(nonce.length + encrypted.length)
  sealed.set(nonce)
  sealed.set(encrypted, nonce.length)

  secretKey.fill(0)
  shared.fill(0)
  key.fill(0)

  return { epk: b64url(ephemeral.publicKey), sealed: b64url(sealed) }
}

module.exports = {
  encrypt,
  b64url,
  unb64url,
  utf8
}
