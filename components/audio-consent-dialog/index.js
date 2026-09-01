const audioConsent = require('../../utils/audio-consent')
const i18n = require('../../utils/i18n')

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    }
  },

  data: {
    summary: i18n.ui(audioConsent.SUMMARY)
  },

  methods: {
    agree() {
      this.triggerEvent('agree')
    },

    decline() {
      this.triggerEvent('decline')
    },

    viewAgreement() {
      this.triggerEvent('viewagreement')
    },

    preventTouchMove() {}
  }
})
