Component({
  options: {
    multipleSlots: true
  },
  properties: {
    title: { type: String, value: '' },
    bgColor: { type: String, value: '#faf6ef' },
    textColor: { type: String, value: '#2a2521' },
    titleAlign: { type: String, value: 'center' },
    safeRightAction: { type: Boolean, value: false }
  },
  data: {
    toolbarTop: 0,
    toolbarHeight: 64,
    paddingLeft: 50
  },
  lifetimes: {
    attached() {
      try {
        const info = wx.getSystemInfoSync()
        const statusBarHeight = (info && info.statusBarHeight) || 0
        const windowWidth = (info && info.windowWidth) || 375
        let toolbarTop = statusBarHeight
        let toolbarHeight = 64
        let paddingLeft = 50

        const menu = wx.getMenuButtonBoundingClientRect()
        if (menu && menu.top != null && menu.height) {
          toolbarTop = menu.top
          toolbarHeight = menu.height
          // Calculate right margin from capsule button (in px)
          const rightMarginPx = windowWidth - menu.right
          // Convert to rpx and double the distance: rpx = px * (750 / windowWidth) * 2
          paddingLeft = Math.round(rightMarginPx * 750 / windowWidth * 2)
        }
        this.setData({ toolbarTop, toolbarHeight, paddingLeft })
      } catch (e) {
        this.setData({ toolbarTop: 0, toolbarHeight: 64, paddingLeft: 50 })
      }
    }
  },
  methods: {
    goBack() {
      wx.navigateBack({ delta: 1 })
    }
  }
})
