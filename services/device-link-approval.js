const auth = require('./auth')
const deviceLink = require('./device-link')
const deviceLinkCrypto = require('../utils/device-link-crypto')

function validRequest(request) {
  return Boolean(request && request.pairingId && /^\d{4}$/.test(String(request.code || '')) && request.pubkey)
}

function createApproval(options) {
  const deps = Object.assign({ auth, deviceLink, crypto: deviceLinkCrypto, wx: typeof wx === 'undefined' ? null : wx }, options || {})
  let pending = null
  const settled = new Set()
  const releasing = new Set()

  function clear(pairingId) {
    if (!pairingId || pending && pending.pairingId === pairingId) pending = null
  }

  async function reject(pairingId) {
    if (!pairingId || settled.has(pairingId)) return
    settled.add(pairingId)
    clear(pairingId)
    await deps.deviceLink.cancel(pairingId).catch(() => null)
  }

  function present(request) {
    if (!validRequest(request) || settled.has(request.pairingId)) return false
    if (pending && pending.pairingId === request.pairingId) return true
    pending = request
    if (typeof deps.onPresent === 'function') {
      deps.onPresent(request)
      return true
    }
    deps.wx.showModal({
      title: '设备登录请求',
      content: `有新设备想登录当前账号。\n\n验证码：${request.code}\n\n请在新设备输入验证码；如果不是你本人，请拒绝。`,
      confirmText: '这是我',
      cancelText: '不是我',
      success: (result) => {
        if (result.cancel) reject(request.pairingId)
      }
    })
    return true
  }

  async function release(message) {
    const pairingId = message && message.pairingId
    if (!pairingId || settled.has(pairingId) || releasing.has(pairingId)) return false
    releasing.add(pairingId)
    try {
      let request = pending && pending.pairingId === pairingId ? pending : null
      if (!request) request = await deps.deviceLink.pending()
      if (!validRequest(request) || request.pairingId !== pairingId) throw new Error('找不到待处理的设备登录')
      const blob = await deps.crypto.encrypt(deps.auth.bearer(), request.pubkey)
      const completed = await deps.deviceLink.complete(pairingId, blob)
      if (!completed) throw new Error('设备登录确认失败')
      settled.add(pairingId)
      clear(pairingId)
      deps.wx.showToast({ title: '已在新设备登录', icon: 'success' })
      return true
    } catch (_) {
      deps.wx.showToast({ title: '设备登录失败，请重试', icon: 'none' })
      return false
    } finally {
      releasing.delete(pairingId)
    }
  }

  async function recover() {
    try {
      const request = await deps.deviceLink.pending()
      if (!validRequest(request) || settled.has(request.pairingId)) return false
      if (request.released) return release({ pairingId: request.pairingId })
      return present(request)
    } catch (_) {
      return false
    }
  }

  return { present, release, recover, reject }
}

module.exports = { createApproval, validRequest }
