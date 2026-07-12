Component({
  data: {
    statusBarHeight: 20,
    settingsTop: 0
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
        { key: 'community', label: 'VD社区' }
      ]
    }
  },

  lifetimes: {
    attached() {
      try {
        const info = wx.getSystemInfoSync()
        this.setData({ statusBarHeight: info.statusBarHeight })
        // Get capsule position to align settings button
        const menu = wx.getMenuButtonBoundingClientRect()
        if (menu && menu.top != null) {
          this.setData({ settingsTop: menu.top })
        }
      } catch (_) {
        this.setData({ statusBarHeight: 20 })
      }
    }
  },

  methods: {
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
