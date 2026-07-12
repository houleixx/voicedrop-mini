const instructionSettings = require('../../services/instruction-settings')

function displayTitle(item) {
  if (!item.customLabel) return item.label
  const parts = item.label.split('·').map((part) => part.trim())
  parts[parts.length - 1] = item.customLabel
  return parts.join(' · ')
}

Page({
  data: { rows: [], loading: true, error: '', empty: false },
  onShow() { this.loadItems() },
  async loadItems() {
    this.setData({ loading: true, error: '' })
    try {
      const result = await instructionSettings.load()
      if (!result.ok) throw new Error('load failed')
      const rows = result.items.map((item) => ({
        id: item.id,
        title: displayTitle(item),
        preview: item.effective.slice(0, 40),
        status: item.hidden ? '已从菜单隐藏' : (item.customized ? '已自定义' : ''),
        hidden: item.hidden,
        customized: item.customized
      }))
      this.setData({ rows, loading: false, empty: rows.length === 0 })
    } catch (_) {
      this.setData({ rows: [], loading: false, empty: false, error: '加载失败' })
    }
  },
  openItem(event) {
    const id = event.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/instruction-edit/index?id=${encodeURIComponent(id)}` })
  }
})
