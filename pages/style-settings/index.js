const settings = require('../../services/settings')
const styleSelection = require('../../utils/style-selection')
const i18n = require('../../utils/i18n')

Page({
  data: {
    style: '',
    styleSummary: i18n.ui('当前风格'),
    styleRows: [],
    saving: false,
    styleHistory: { versions: [] },
    styleHistoryOpen: false,
    selectedHead: 0
  },

  onShow() {
    this.load()
  },

  onLanguageChanged() {
    this.loadStyleHistory()
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
      this.setData({
        style: style.style || ''
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

  async loadStyleHistory() {
    const styleHistory = await settings.loadStyleHistory()
    const versions = styleHistory.versions || []
    const head = styleHistory.head || 0
    const headVersion = versions.find(v => v.v === head)
    const headStyle = headVersion ? headVersion.style : this.data.style
    const rows = styleSelection.selectedRows(versions, head)
    const currentRow = rows.find(row => row.v === head)

    this.setData({
      styleHistory,
      style: headStyle,
      selectedHead: head,
      styleSummary: currentRow ? currentRow.preview : i18n.ui('当前风格'),
      styleRows: rows
    })
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

  async selectStyleVersion(event) {
    const version = Number(event.currentTarget.dataset.version)
    const versions = (this.data.styleHistory && this.data.styleHistory.versions) || []
    const selectedVersion = versions.find(v => v.v === version)
    if (!selectedVersion) return
    this.setData({
      selectedHead: version,
      style: selectedVersion.style || '',
      styleSummary: styleSelection.oneLinePreview(selectedVersion.style),
      styleRows: styleSelection.selectedRows(versions, version),
      styleHistoryOpen: false
    })
    const ok = await settings.saveStyleHead(version)
    wx.showToast({ title: ok ? '已切换文风' : '切换失败', icon: ok ? 'success' : 'error' })
    if (!ok) {
      await this.load()
    }
  }
})
