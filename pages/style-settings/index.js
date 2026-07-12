const settings = require('../../services/settings')
const styleSelection = require('../../utils/style-selection')

Page({
  data: {
    style: '',
    selectedStyles: [],
    styleSummary: '未选择风格',
    styleRows: [],
    saving: false,
    styleHistory: { versions: [] },
    styleHistoryOpen: false,
    compareMode: true,
    singleSelected: null
  },

  onShow() {
    this.load()
  },

  onShareAppMessage() {
    return {
      title: 'VoiceDrop 写作风格',
      path: '/pages/style-settings/index'
    }
  },

  onShareTimeline() {
    return {
      title: 'VoiceDrop 写作风格',
      query: ''
    }
  },

  async load() {
    try {
      const style = await settings.loadStyle()
      const selectedStyles = styleSelection.normalized(style.styles || [])
      this.setData({
        style: style.style || '',
        selectedStyles,
        styleSummary: styleSelection.summary(selectedStyles)
      })
      await this.loadStyleHistory()
    } catch (error) {
      wx.showToast({ title: '加载失败', icon: 'error' })
    }
  },

  onStyleInput(event) {
    this.setData({ style: event.detail.value })
  },

  async saveStyle(options) {
    this.setData({ saving: true })
    const ok = await settings.saveStyle(this.data.style)
    this.setData({ saving: false })
    if (!options || !options.silent) {
      wx.showToast({ title: ok ? '已保存' : '保存失败', icon: ok ? 'success' : 'error' })
    }
    return ok
  },

  cancel() {
    wx.navigateBack()
  },

  async done() {
    const styleOk = await this.saveStyle({ silent: true })
    const selectionOk = await this.saveStyleSelection({ silent: true })
    wx.showToast({ title: styleOk && selectionOk ? '已完成' : '保存失败', icon: styleOk && selectionOk ? 'success' : 'error' })
    if (styleOk && selectionOk) wx.navigateBack()
  },

  async loadStyleHistory() {
    const styleHistory = await settings.loadStyleHistory()
    const versions = styleHistory.versions || []
    const head = styleHistory.head || 0
    const hasSelections = (this.data.selectedStyles && this.data.selectedStyles.length) > 0

    // Find the head version's style content
    const headVersion = versions.find(v => v.v === head)
    const headStyle = headVersion ? headVersion.style : this.data.style

    // In single mode, mark the head version as selected
    const selectedForDisplay = hasSelections ? this.data.selectedStyles : (head > 0 ? [head] : [])

    // Update summary based on mode
    let summary = hasSelections ? styleSelection.summary(this.data.selectedStyles) : ''
    if (!hasSelections && head > 0) {
      const versionName = `v${head}`
      summary = headVersion && headVersion.style ? versionName : '未选择风格'
    } else if (!hasSelections) {
      summary = '未选择风格'
    }

    this.setData({
      styleHistory,
      style: headStyle,
      styleSummary: summary,
      styleRows: styleSelection.selectedRows(versions, selectedForDisplay),
      compareMode: hasSelections
    })
  },

  preventToggle() {
    // Prevent switch tap from bubbling to parent
  },

  onCompareModeChange(event) {
    const isChecked = event.detail.value
    if (!isChecked) {
      // Turn off compare mode, clear multi-selection
      this.setData({
        compareMode: false,
        selectedStyles: [],
        styleSummary: '未选择风格',
        styleRows: styleSelection.selectedRows((this.data.styleHistory && this.data.styleHistory.versions) || [], [])
      })
    } else {
      this.setData({ compareMode: true })
    }
  },

  async toggleStyleHistory() {
    if (this.data.styleHistoryOpen) {
      // Panel is open, close it
      this.setData({ styleHistoryOpen: false })
    } else {
      // Panel is closed, load data and open it
      await this.loadStyleHistory()
      this.setData({ styleHistoryOpen: true })
    }
  },

  async selectStyleHead(event) {
    const head = Number(event.currentTarget.dataset.head)
    const ok = await settings.saveStyleHead(head)
    wx.showToast({ title: ok ? '已切换文风' : '切换失败', icon: ok ? 'success' : 'error' })
    if (ok) this.load()
  },

  toggleStyleSelection(event) {
    const version = Number(event.currentTarget.dataset.version)
    const versions = (this.data.styleHistory && this.data.styleHistory.versions) || []
    if (this.data.compareMode) {
      // Multi-selection mode (compare ON)
      const next = styleSelection.toggle(this.data.selectedStyles, version)
      if (next.limit) {
        wx.showToast({ title: '最多选择 3 个', icon: 'error' })
        return
      }
      this.setData({
        selectedStyles: next.selected,
        styleSummary: styleSelection.summary(next.selected),
        styleRows: styleSelection.selectedRows(versions, next.selected)
      })
    } else {
      // Single-selection mode (compare OFF)
      const selectedVersion = versions.find(v => v.v === version)
      this.setData({
        singleSelected: version,
        style: selectedVersion ? selectedVersion.style : '',
        styleRows: styleSelection.selectedRows(versions, [version])
      })
      // Save the selected head to server immediately
      settings.saveStyleHead(version)
    }
  },

  async saveStyleSelection(options) {
    const ok = await settings.saveStyleSelection(this.data.selectedStyles)
    if (!options || !options.silent) {
      wx.showToast({ title: ok ? '已保存' : '保存失败', icon: ok ? 'success' : 'error' })
      if (ok) {
        // Update summary to reflect current selection
        const hasSelections = (this.data.selectedStyles && this.data.selectedStyles.length) > 0
        let summary = '未选择风格'
        if (hasSelections) {
          summary = styleSelection.summary(this.data.selectedStyles)
        } else if (this.data.singleSelected > 0) {
          summary = `v${this.data.singleSelected}`
        }
        this.setData({
          styleSummary: summary,
          styleHistoryOpen: false
        })
      }
    }
    return ok
  }
})
