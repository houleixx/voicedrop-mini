const promptStore = require('../../services/prompt-store')
const promptDrag = require('../../utils/prompt-drag')

function rowsFor(items, depth = 0, parentId = '') {
  const rows = (items || []).flatMap((item, index) => [{
    id: item.id, type: item.type, title: item.label,
    preview: item.type === 'group' ? `${(item.children || []).length} 条提示词` : String(item.prompt || '').slice(0, 40),
    origin: item.origin, originLabel: item.origin === 'system' ? '系统' : (item.origin === 'custom' ? '派生' : '自建'),
    depth, parentId, index, childCount: (item.children || []).length
  }, ...(item.type === 'group' ? rowsFor(item.children, depth + 1, item.id) : [])])
  return depth === 0 ? rows.map((row, flatIndex) => Object.assign(row, { flatIndex })) : rows
}

Page({
  data: { rows: [], loading: true, error: '', empty: false, mutating: false, reordering: false },
  onShow() { if (!this.data.reordering) this.loadItems() },
  async loadItems() {
    const cached = promptStore.items()
    this.setData({ rows: rowsFor(cached), loading: !cached.length, error: '', empty: !cached.length })
    const result = await promptStore.refresh()
    this.setData({ rows: rowsFor(promptStore.items()), loading: false, empty: !promptStore.items().length, error: result.ok ? '' : '加载失败，正在显示上次内容' })
  },
  openItem(event) {
    if (this.data.reordering) return
    wx.navigateTo({ url: `/pages/instruction-edit/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` })
  },
  createPrompt() { wx.navigateTo({ url: '/pages/prompt-new/index?type=action' }) },
  createGroup() { wx.navigateTo({ url: '/pages/prompt-new/index?type=group' }) },
  openImport() { wx.navigateTo({ url: '/pages/prompt-import/index' }) },
  async deleteItem(event) {
    if (this.data.mutating || this.data.reordering) return
    const id = event.currentTarget.dataset.id
    const modal = await new Promise((resolve) => wx.showModal({ title: '删除提示词', content: '删除后无法恢复；删除分组会同时删除组内提示词。', confirmText: '删除', success: resolve }))
    if (!modal.confirm) return
    this.setData({ mutating: true })
    const result = await promptStore.remove(id)
    this.setData({ mutating: false, rows: rowsFor(promptStore.items()), error: result.ok ? '' : '删除失败，请重试' })
  },
  async restoreDefaults() {
    if (this.data.mutating) return
    const modal = await new Promise((resolve) => wx.showModal({ title: '恢复默认', content: '会补回缺少的系统提示词，不会删除自建内容。', success: resolve }))
    if (!modal.confirm) return
    this.setData({ mutating: true })
    const result = await promptStore.restoreDefaults()
    this.setData({ mutating: false, rows: rowsFor(promptStore.items()), error: result.ok ? '' : '恢复失败，请重试' })
  },
  startReorder() {
    this.dragController = promptDrag.create(); this.dragController.begin(promptStore.items())
    this.setData({ reordering: true, rows: rowsFor(this.dragController.draft()), error: '' })
  },
  movePrompt(event) {
    if (!this.dragController) return
    if (event.detail && event.detail.source && event.detail.source !== 'touch') return
    const id = event.currentTarget.dataset.id
    const width = typeof wx.getSystemInfoSync === 'function' ? Number(wx.getSystemInfoSync().windowWidth) || 375 : 375
    const rowPx = 112 * width / 750
    const target = this.data.rows[Math.max(0, Math.min(this.data.rows.length - 1, Math.round(Number(event.detail && event.detail.y || 0) / rowPx)))]
    if (!target || target.id === id) return
    const source = this.data.rows.find((row) => row.id === id)
    const intoGroup = target.type === 'group' && source && source.type !== 'group'
    try {
      this.dragController.move(id, intoGroup ? target.id : (target.parentId || null), intoGroup ? target.childCount : target.index)
      this.setData({ rows: rowsFor(this.dragController.draft()) })
    } catch (_) { wx.showToast({ title: '分组不能放进分组', icon: 'none' }) }
  },
  cancelReorder() {
    if (this.dragController) this.dragController.cancel()
    this.setData({ reordering: false, rows: rowsFor(promptStore.items()) })
  },
  async finishReorder() {
    if (!this.dragController || this.data.mutating) return
    this.setData({ mutating: true })
    const result = await this.dragController.commit(promptStore)
    if (!result.ok) { this.setData({ mutating: false, error: result.error === 'conflict' ? '列表已更新，请重新排序' : '保存失败，请重试' }); return }
    this.dragController = null
    this.setData({ mutating: false, reordering: false, rows: rowsFor(promptStore.items()), error: '' })
  }
})

module.exports = { rowsFor }
