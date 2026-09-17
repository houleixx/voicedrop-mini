// Preserve the community tab optical correction for physical device fonts.
// Current developer tools already center the label; simulated OS metadata must
// not apply a device correction on top of that centering.
// Only labels move; row geometry and touch targets stay the same.
function baselineClass(systemInfo, deviceInfo) {
  const infos = [systemInfo || {}, deviceInfo || {}]
  const matches = (pattern) => infos.some((info) =>
    Object.values(info).some((value) => pattern.test(String(value || ''))))
  if (matches(/devtools|wechatdevtools|微信开发者工具/i)) return ''
  if (matches(/harmony|ohos|openharmony/i)) return 'filter-baseline-harmony'
  if (infos.some((info) => String(info.platform || '').toLowerCase() === 'ios')) return ''
  return 'filter-baseline-default'
}

function currentBaselineClass() {
  let systemInfo = {}, deviceInfo = {}
  if (typeof wx !== 'undefined') {
    try { systemInfo = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {} } catch (_) {}
    try { deviceInfo = wx.getDeviceInfo ? wx.getDeviceInfo() : {} } catch (_) {}
  }
  return baselineClass(systemInfo, deviceInfo)
}

module.exports = { baselineClass, currentBaselineClass }
