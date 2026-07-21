function label() {
  try {
    const account = typeof wx.getAccountInfoSync === 'function'
      ? wx.getAccountInfoSync()
      : null
    const miniProgram = account && account.miniProgram
    const version = miniProgram && miniProgram.version
    if (typeof version === 'string' && version.trim()) return version.trim()
    if (miniProgram && miniProgram.envVersion === 'trial') return '体验版'
    if (miniProgram && miniProgram.envVersion === 'release') return '正式版'
    return '开发版'
  } catch (error) {
    return '开发版'
  }
}

module.exports = { label }
