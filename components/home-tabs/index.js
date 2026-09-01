const capsuleLayout = require('../../utils/capsule-layout')
const i18n = require('../../utils/i18n')

Component({
  data: {
    statusBarHeight: 20,
    settingsTop: 0,
    capsuleSafeRightPx: capsuleLayout.FALLBACK_SAFE_RIGHT_PX,
    displayTabs: [],
    brandName: i18n.ui('VoiceDrop 口述'),
    settingsLabel: i18n.ui('设置')
  },

  observers: {
    tabs() { this.refreshTabs() },
    languageRevision() { this.refreshTabs() }
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
      })
    },
    openSettings() {
      this.triggerEvent('settings')
    },

    selectTab(event) {
      const tab = this.data.tabs.find((item) => item.key === event.currentTarget.dataset.tab)
      if (!tab || tab.key === this.data.current) return
      this.triggerEvent('change', { key: tab.key, tab })
    }
  }
})
