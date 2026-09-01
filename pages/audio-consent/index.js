const audioConsent = require('../../utils/audio-consent')
const i18n = require('../../utils/i18n')

function agreementCopy(language) {
  return audioConsent.localizedCopy(language || i18n.currentLanguage())
}

Page({
  data: agreementCopy(),

  onShow() {
    this.setData(agreementCopy())
  },

  onLanguageChanged(language) {
    this.setData(agreementCopy(language))
  }
})
