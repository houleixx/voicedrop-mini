const { SUPPORT_EMAIL } = require('./community-terms')

const STORAGE_KEY = 'voicedrop.audioConsent.v2'
const VERSION = '2026-07-13-v1'
const EFFECTIVE_DATE = '2026-07-13'
const TITLE = '音频信息授权协议'
const SUMMARY = '为向你提供语音转写、文章生成和编辑、语音指令及社区回应功能，VoiceDrop 会在你主动操作后录制并上传音频。音频中可能包含能够识别个人的声音特征。'

const SECTIONS = [
  {
    title: '一、我们处理的信息',
    paragraphs: [
      '我们处理你主动录制的音频、录音时长，以及由该音频产生的文字、文章和指令处理结果。音频中可能包含能够识别个人的声音特征。'
    ]
  },
  {
    title: '二、处理目的和用途',
    paragraphs: [
      '音频仅用于把口述转写为文字、生成和编辑文章、支持 AI 采访、执行语音指令，以及生成你主动发起的社区回应。'
    ]
  },
  {
    title: '三、处理方式',
    paragraphs: [
      '在你主动开始录音或按住语音按钮后，小程序调用设备麦克风，并通过加密网络把完整音频或实时音频帧发送至 VoiceDrop 后端进行自动化语音处理。根据你使用的功能，我们会保存录音及对应处理结果。'
    ]
  },
  {
    title: '四、使用范围',
    paragraphs: [
      'VoiceDrop 仅把音频用于你主动触发的上述功能，不提取声纹模板，不进行声纹身份识别，不把音频用于广告画像，也不向无关第三方出售。'
    ]
  },
  {
    title: '五、保存和删除',
    paragraphs: [
      '音频和处理结果随你当前的 VoiceDrop 账户保存。你可以在录音列表删除单条录音，也可以在账户页注销并永久删除云端与本机的全部数据。'
    ]
  },
  {
    title: '六、你的权利',
    paragraphs: [
      '你可以拒绝或撤回本授权。拒绝或撤回后，我们不会开始新的音频采集；这只影响需要麦克风的功能，不影响浏览已有内容。撤回授权不会自动删除历史录音，你仍可通过录音列表或账户注销功能删除数据。'
    ]
  },
  {
    title: '七、联系我们',
    paragraphs: [
      `如对音频信息处理有疑问、建议或投诉，请发送邮件至 ${SUPPORT_EMAIL} 联系我们。`
    ]
  }
]

function isGranted() {
  try {
    const state = wx.getStorageSync(STORAGE_KEY)
    return Boolean(state && state.version === VERSION && state.agreedAt)
  } catch (_) {
    return false
  }
}

function grant(now) {
  const state = {
    version: VERSION,
    agreedAt: (now || new Date()).toISOString()
  }
  wx.setStorageSync(STORAGE_KEY, state)
  return state
}

function revoke() {
  try {
    wx.removeStorageSync(STORAGE_KEY)
    return true
  } catch (_) {
    return false
  }
}

module.exports = {
  STORAGE_KEY,
  VERSION,
  EFFECTIVE_DATE,
  TITLE,
  SUMMARY,
  SECTIONS,
  isGranted,
  grant,
  revoke
}
