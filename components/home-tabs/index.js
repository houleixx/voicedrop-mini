const capsuleLayout = require('../../utils/capsule-layout')
const i18n = require('../../utils/i18n')

Component({
  data: {
    statusBarHeight: 20,
    settingsTop: 0,
    capsuleSafeRightPx: capsuleLayout.FALLBACK_SAFE_RIGHT_PX,
    scrollLeft: 0,
    scrollWithAnimation: false,
    displayTabs: [],
    brandName: i18n.ui('VoiceDrop 口述'),
    settingsLabel: i18n.ui('设置')
  },

  observers: {
    tabs() { this.refreshTabs() },
    languageRevision() { this.refreshTabs() },
    current() { this.centerCurrentTab(true) }
  },

  properties: {
    current: {
      type: String,
      value: 'recordings'
    },
    tabs: {
      type: Array,
      value: [
        { key: 'recordings', label: '我的录音' },
        { key: 'community', label: 'VD社区' },
        { key: 'books', label: '写书' }
      ]
    },
    languageRevision: { type: Number, value: 0 }
  },

  lifetimes: {
    attached() {
      if (typeof this.refreshTabs === 'function') this.refreshTabs()
      try {
        const info = wx.getSystemInfoSync()
        this.setData({ statusBarHeight: info.statusBarHeight })
        // Get capsule position to align settings button
        const menu = wx.getMenuButtonBoundingClientRect()
        if (menu && menu.top != null) {
          this.setData({
            settingsTop: menu.top,
            capsuleSafeRightPx: capsuleLayout.safeRightPx(info, menu)
          })
        }
      } catch (_) {
        this.setData({
          statusBarHeight: 20,
          capsuleSafeRightPx: capsuleLayout.FALLBACK_SAFE_RIGHT_PX
        })
      }
    }
  },

  methods: {
    refreshTabs() {
      this.setData({
        displayTabs: (this.properties.tabs || []).map((tab) => Object.assign({}, tab, {
          label: i18n.ui(tab.label)
        })),
        brandName: i18n.ui('VoiceDrop 口述'),
        settingsLabel: i18n.ui('设置')
      }, () => this.centerCurrentTab(false))
    },
    centerCurrentTab(animate) {
      this.centerTab(this.properties.current, animate)
    },
    centerTab(key, animate, done) {
      if (!key || typeof wx.createSelectorQuery !== 'function') return
      wx.nextTick(() => {
        wx.createSelectorQuery().in(this)
          .select('.section-tabs').boundingClientRect()
          .select(`#home-tab-${key}`).boundingClientRect()
          .exec((rects) => {
            const viewport = rects && rects[0]
            const tab = rects && rects[1]
            if (!viewport || !tab) return
            const currentLeft = Number(this.data.scrollLeft) || 0
            const target = currentLeft + tab.left - viewport.left + tab.width / 2 - viewport.width / 2
            this.setData({
              scrollLeft: Math.max(0, target),
              scrollWithAnimation: Boolean(animate)
            }, done)
          })
      })
    },
    openSettings() {
      this.triggerEvent('settings')
    },

    selectTab(event) {
      const tab = this.data.tabs.find((item) => item.key === event.currentTarget.dataset.tab)
      if (!tab || tab.key === this.data.current) return
      // Start centering immediately; page switching can otherwise delay the visual response.
      this.centerTab(tab.key, true, () => this.triggerEvent('change', { key: tab.key, tab }))
    }
  }
})
