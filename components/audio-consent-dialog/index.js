const audioConsent = require('../../utils/audio-consent')

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    }
  },

  data: {
    summary: audioConsent.SUMMARY
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
  },

  lifetimes: {
    ready() {
      this.triggerEvent('ready')
    }
  }
})
