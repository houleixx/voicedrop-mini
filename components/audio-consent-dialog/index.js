const audioConsent = require('../../utils/audio-consent')

Component({
  data: {
    visible: false,
    summary: audioConsent.SUMMARY
  },

  methods: {
    request() {
      if (audioConsent.isGranted()) return Promise.resolve(true)
      if (this._pendingPromise) return this._pendingPromise
      this.setData({ visible: true })
      this._pendingPromise = new Promise((resolve) => {
        this._resolveRequest = resolve
      })
      return this._pendingPromise
    },

    settle(granted) {
      this.setData({ visible: false })
      const resolve = this._resolveRequest
      this._resolveRequest = null
      this._pendingPromise = null
      if (resolve) resolve(granted)
    },

    agree() {
      try {
        audioConsent.grant()
        this.settle(true)
      } catch (_) {
        wx.showToast({ title: '授权状态保存失败', icon: 'none' })
        this.settle(false)
      }
    },

    decline() {
      this.settle(false)
    },

    viewAgreement() {
      this.settle(false)
      wx.navigateTo({ url: '/pages/audio-consent/index' })
    },

    preventTouchMove() {}
  },

  lifetimes: {
    detached() {
      const resolve = this._resolveRequest
      this._resolveRequest = null
      this._pendingPromise = null
      if (resolve) resolve(false)
    }
  }
})
