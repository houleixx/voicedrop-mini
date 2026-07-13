const audioConsent = require('./audio-consent')

function settle(page, granted) {
  page.setData({ audioConsentVisible: false })
  const resolve = page._resolveAudioConsent
  page._resolveAudioConsent = null
  page._audioConsentPromise = null
  if (resolve) resolve(granted)
}

function request(page) {
  if (audioConsent.isGranted()) return Promise.resolve(true)
  if (!page._audioConsentDialogReady) {
    wx.showToast({ title: '授权组件加载失败，请重试', icon: 'none' })
    return Promise.resolve(false)
  }
  if (page._audioConsentPromise) return page._audioConsentPromise
  page.setData({ audioConsentVisible: true })
  page._audioConsentPromise = new Promise((resolve) => {
    page._resolveAudioConsent = resolve
  })
  return page._audioConsentPromise
}

function markReady(page) {
  page._audioConsentDialogReady = true
}

function agree(page) {
  try {
    audioConsent.grant()
    settle(page, true)
  } catch (_) {
    wx.showToast({ title: '授权状态保存失败', icon: 'none' })
    settle(page, false)
  }
}

function decline(page) {
  settle(page, false)
}

function dispose(page) {
  page._audioConsentDialogReady = false
  const resolve = page._resolveAudioConsent
  page._resolveAudioConsent = null
  page._audioConsentPromise = null
  if (resolve) resolve(false)
}

module.exports = {
  request,
  markReady,
  agree,
  decline,
  dispose
}
