const SUPPORT_EMAIL = 'jianshuo@hotmail.com'
const AGREED_KEY = 'voicedrop.community.terms.agreed'

const BODY = `发布到 VD社区，表示你同意以下社区公约：

• 你对自己发布的内容负责，并拥有发布它的权利。
• 严禁发布令人反感的内容，包括色情或露骨性内容、暴力血腥、仇恨或歧视、骚扰或欺凌、违法内容、自残等。VoiceDrop 对令人反感的内容和滥用行为零容忍。
• 违规内容一经举报将被立即下架，并在 24 小时内处理；屡次或严重违规的账号将被移除。
• 你可以随时举报不当内容、屏蔽不想看到的用户。

继续即表示你已阅读并同意本社区公约与最终用户许可协议（EULA）。如需联系或投诉内容，请发邮件至 ${SUPPORT_EMAIL}。`

function defaultStorage() {
  return typeof wx === 'undefined' ? memoryStorage() : wx
}

function agreed(storage) {
  const store = storage || defaultStorage()
  try {
    return store.getStorageSync(AGREED_KEY) === '1'
  } catch (error) {
    return false
  }
}

function setAgreed(value, storage) {
  const store = storage || defaultStorage()
  try {
    if (value) store.setStorageSync(AGREED_KEY, '1')
    else store.removeStorageSync(AGREED_KEY)
  } catch (error) {
  }
}

function memoryStorage() {
  const data = {}
  return {
    getStorageSync: (key) => data[key],
    setStorageSync: (key, value) => { data[key] = value },
    removeStorageSync: (key) => { delete data[key] }
  }
}

module.exports = {
  SUPPORT_EMAIL,
  BODY,
  agreed,
  setAgreed,
  memoryStorage
}
