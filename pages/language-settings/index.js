const i18n = require('../../utils/i18n')

Page({
  data: {
    selectedLanguage: i18n.FOLLOW_SYSTEM,
    appliedLanguage: i18n.FOLLOW_SYSTEM,
    effectiveLanguage: i18n.SIMPLIFIED_CHINESE,
    labels: {}
  },

  onShow() {
    const selectedLanguage = i18n.selectedLanguage()
    const effectiveLanguage = i18n.currentLanguage()
    this.setData({
      selectedLanguage,
      appliedLanguage: selectedLanguage,
      effectiveLanguage,
      labels: copyFor(effectiveLanguage)
    })
  },

  selectLanguage(event) {
    const selectedLanguage = i18n.normalizeLanguage(event.detail.value)
    this.setData({ selectedLanguage })
  },

  applyLanguage() {
    const selectedLanguage = this.data.selectedLanguage
    i18n.setSelectedLanguage(selectedLanguage)
    const effectiveLanguage = i18n.currentLanguage()
    this.setData({ appliedLanguage: selectedLanguage, effectiveLanguage, labels: copyFor(effectiveLanguage) })
    i18n.notifyLanguageChanged(effectiveLanguage)
    wx.showToast({ title: effectiveLanguage === i18n.ENGLISH ? 'Language updated' : '语言已更新', icon: 'success' })
    // Active pages and shared components refresh through the language-change
    // broadcast. Return to the page that opened this picker without resetting
    // the user's navigation stack or their in-progress page state.
    if (typeof wx.navigateBack === 'function') {
      wx.navigateBack({ delta: 1 })
    }
  }
})

function copyFor(language) {
  if (language === i18n.ENGLISH) {
    return {
      title: 'Language',
      hint: 'Choose the language VoiceDrop uses. Follow System uses your WeChat/system language.',
      followSystem: 'Follow System',
      simplifiedChinese: '简体中文',
      english: 'English',
      current: 'Current',
      done: 'Done'
    }
  }
  return {
    title: '语言',
    hint: '选择 VoiceDrop 使用的语言；跟随系统会使用微信/系统语言。',
    followSystem: '跟随系统',
    simplifiedChinese: '简体中文',
    english: 'English',
    current: '当前使用',
    done: '完成'
  }
}

module.exports = { copyFor }
