const test = require('node:test')
const assert = require('node:assert/strict')
const nodeCrypto = require('node:crypto')
const nacl = require('tweetnacl')

const deviceLinkCrypto = require('../utils/device-link-crypto')
const { createApproval, validRequest } = require('../services/device-link-approval')

test('device-link encryption matches the cross-platform X25519/HKDF/AES-GCM wire format', async () => {
  const peerSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
  const peer = nacl.box.keyPair.fromSecretKey(peerSecret)
  const peerPublic = deviceLinkCrypto.b64url(peer.publicKey)
  const random = Uint8Array.from({ length: 44 }, (_, index) => index + 33)

  const blob = await deviceLinkCrypto.encrypt('anon_cross_platform_test', peerPublic, {
    randomBytes: async () => random
  })

  assert.deepEqual(blob, {
    epk: 'WGmv9FBUlzLLqu1eXfmzCm2jHLDldCutWtShp2jxpns',
    sealed: 'QUJDREVGR0hJSktM9zdda4A_kU1xzzHN5zuwzaUNr7pjmK9Dkeai_MuPwwdJ36c9krsymw'
  })

  const privateKey = nodeCrypto.createPrivateKey({
    key: { kty: 'OKP', crv: 'X25519', d: deviceLinkCrypto.b64url(peerSecret), x: peerPublic },
    format: 'jwk'
  })
  const ephemeralKey = nodeCrypto.createPublicKey({
    key: { kty: 'OKP', crv: 'X25519', x: blob.epk },
    format: 'jwk'
  })
  const shared = nodeCrypto.diffieHellman({ privateKey, publicKey: ephemeralKey })
  const key = nodeCrypto.hkdfSync('sha256', shared, 'voicedrop-device-link/v1', 'anon-token', 32)
  const sealed = Buffer.from(deviceLinkCrypto.unb64url(blob.sealed))
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12))
  decipher.setAuthTag(sealed.subarray(sealed.length - 16))
  const plain = Buffer.concat([decipher.update(sealed.subarray(12, -16)), decipher.final()])
  assert.equal(plain.toString(), 'anon_cross_platform_test')
})

function approvalHarness(config) {
  const calls = { modals: [], toasts: [], canceled: [], completed: [], encrypted: [] }
  const request = {
    pairingId: '0123456789abcdef0123456789abcdef',
    code: '0427',
    pubkey: 'peer-public-key'
  }
  const approval = createApproval({
    auth: {
      anonymousBearer: () => 'anon_secret',
      bearer: () => 'wechat.session.token'
    },
    crypto: {
      encrypt: async (token, pubkey) => {
        calls.encrypted.push({ token, pubkey })
        return { epk: 'ephemeral', sealed: 'ciphertext' }
      }
    },
    deviceLink: {
      pending: async () => config && config.pendingResponse || request,
      complete: async (pairingId, blob) => {
        calls.completed.push({ pairingId, blob })
        return true
      },
      cancel: async (pairingId) => { calls.canceled.push(pairingId) }
    },
    wx: {
      showModal: (options) => { calls.modals.push(options) },
      showToast: (options) => { calls.toasts.push(options) }
    }
  })
  return { approval, calls, request }
}

test('old mini-program device shows the four-digit code and rejects unknown login requests', async () => {
  const { approval, calls, request } = approvalHarness()
  assert.equal(validRequest(request), true)
  assert.equal(approval.present(request), true)
  assert.equal(calls.modals.length, 1)
  assert.match(calls.modals[0].content, /0427/)
  assert.equal(calls.modals[0].cancelText, '不是我')

  calls.modals[0].success({ cancel: true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls.canceled, [request.pairingId])
  assert.equal(await approval.release({ pairingId: request.pairingId }), false)
  assert.equal(calls.completed.length, 0)
})

test('old mini-program device can present a custom pairing dialog instead of the native modal', () => {
  const presented = []
  const { approval, calls, request } = approvalHarness()
  const custom = createApproval({
    auth: { bearer: () => 'anon_secret' },
    deviceLink: {},
    crypto: {},
    wx: { showModal: (options) => calls.modals.push(options) },
    onPresent: (value) => presented.push(value)
  })

  assert.equal(custom.present(request), true)
  assert.deepEqual(presented, [request])
  assert.equal(calls.modals.length, 0)
})

test('recordings page mirrors the iOS pairing copy and emphasizes an unboxed code', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.join(__dirname, '..')
  const js = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(root, 'pages/recordings/index.wxss'), 'utf8')

  assert.match(js, /this\.setData\(\{ linkRequest: request \}\)/)
  assert.match(wxml, /有新设备想登录你的账号/)
  assert.match(wxml, /在新设备上输入下面的验证码/)
  assert.match(wxml, /不是你本人操作？点「不是我」。/)
  assert.match(wxml, /class="device-link-code"[^>]*>\{\{linkRequest\.code\}\}<\/text>/)
  assert.match(wxml, /bindtap="rejectDeviceLink"[\s\S]*bindtap="acknowledgeDeviceLink"/)
  const codeStyle = wxss.match(/\.device-link-code\s*\{([^}]*)\}/)[1]
  assert.match(codeStyle, /font-size: 84rpx;/)
  assert.match(codeStyle, /font-weight: 800;/)
  assert.doesNotMatch(codeStyle, /background:/)
})

test('old mini-program device encrypts the current bearer after link_release', async () => {
  const { approval, calls, request } = approvalHarness()
  approval.present(request)

  assert.equal(await approval.release({ pairingId: request.pairingId }), true)
  assert.deepEqual(calls.encrypted, [{ token: 'wechat.session.token', pubkey: request.pubkey }])
  assert.deepEqual(calls.completed, [{
    pairingId: request.pairingId,
    blob: { epk: 'ephemeral', sealed: 'ciphertext' }
  }])
  assert.equal(calls.toasts[0].title, '已在新设备登录')
})

test('old mini-program device recovers a missed released request from the backend', async () => {
  const pendingResponse = {
    pairingId: '0123456789abcdef0123456789abcdef',
    code: '0427',
    pubkey: 'peer-public-key',
    released: true
  }
  const { approval, calls } = approvalHarness({ pendingResponse })

  assert.equal(await approval.recover(), true)
  assert.equal(calls.modals.length, 0)
  assert.equal(calls.completed.length, 1)
})
