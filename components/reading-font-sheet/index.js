const readingFont = require('../../utils/reading-font')
const i18n = require('../../utils/i18n')

Component({
  data: {
    visible: false,
    closing: false,
    levels: [],
    readingFontScale: 1
  },
  lifetimes: {
    detached() { clearTimeout(this.closeTimer) }
  },
  pageLifetimes: {
    hide() {
      clearTimeout(this.closeTimer)
      this.setData({ visible: false, closing: false })
    }
  },
  methods: {
    open() {
      clearTimeout(this.closeTimer)
      this.setData({
        visible: true,
        closing: false,
        i18n: i18n.copy(),
        readingFontScale: readingFont.scale(),
        levels: readingFont.LEVELS.map((level) => ({ label: i18n.ui(level.label), scale: level.scale }))
      })
    },
    close() {
      if (!this.data.visible || this.data.closing) return
      this.setData({ closing: true })
      this.closeTimer = setTimeout(() => {
        this.setData({ visible: false, closing: false })
      }, 180)
    },
    choose(event) {
      if (this.data.closing) return
      const index = Number(event.currentTarget.dataset.index)
      if (!readingFont.select(this, index)) return
      this.triggerEvent('change')
      this.close()
    },
    noop() {}
  }
})
