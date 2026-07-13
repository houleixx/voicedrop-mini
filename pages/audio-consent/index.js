const audioConsent = require('../../utils/audio-consent')

Page({
  data: {
    title: audioConsent.TITLE,
    version: audioConsent.VERSION,
    effectiveDate: audioConsent.EFFECTIVE_DATE,
    summary: audioConsent.SUMMARY,
    sections: audioConsent.SECTIONS
  }
})
