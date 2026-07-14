const promptStore = require('../../services/prompt-store')
const promptDrag = require('../../utils/prompt-drag')
const tree = require('../../utils/prompt-tree')

function appliesLabel(item) {
  const applies = item.appliesTo || []
  if (applies.includes('text') && applies.includes('image')) return '文字+图片'
  if (applies.includes('image')) return '仅图片'
  if (applies.includes('text')) return '仅文字'
  return ''
}

function rowFor(item, depth, parentId, index, expanded) {
  return {
    id: item.id, type: item.type, title: item.label, depth, parentId, index,
    childCount: (item.children || []).length, expanded: !!expanded,
    imageOnly: appliesLabel(item) === '仅图片', appliesLabel: appliesLabel(item),
    originLabel: item.origin === 'custom' ? '已自定义' : (item.origin === 'user' ? '自建' : '')
  }
}

function rowsFor(items, expandedGroups = []) {
  const expanded = new Set(expandedGroups)
  const rows = []
  ;(items || []).forEach((item, index) => {
    const isExpanded = item.type === 'group' && expanded.has(item.id)
    rows.push(rowFor(item, 0, '', index, isExpanded))
    if (isExpanded) (item.children || []).forEach((child, childIndex) => rows.push(rowFor(child, 1, item.id, childIndex, false)))
  })
  return rows.map((row, flatIndex) => Object.assign(row, { flatIndex }))
}

Page({
  data: {
    rows: [], expandedGroups: [], loading: true, error: '', empty: false,
    mutating: false, reordering: false, newMenuVisible: false, importVisible: false,
    importCode: '', importPreview: null, importLoading: false, importing: false, importError: '', rowHeightPx: 64
  },
  onLoad() {
    try {
      const width = Number(wx.getSystemInfoSync().windowWidth) || 375
      this.setData({ rowHeightPx: 128 * width / 750 })
    } catch (_) {}
  },
  onShow() { if (!this.data.reordering) this.loadItems() },
  displayedRows(items) { return rowsFor(items, this.data.expandedGroups) },
  async loadItems() {
    const cached = promptStore.items()
    this.setData({ rows: this.displayedRows(cached), loading: !cached.length, error: '', empty: !cached.length })
    const result = await promptStore.refresh()
    const items = promptStore.items()
    this.setData({ rows: this.displayedRows(items), loading: false, empty: !items.length, error: result.ok ? '' : '加载失败，正在显示上次内容' })
  },
  handleRowTap(event) {
    if (this.ignoreNextRowTap) { this.ignoreNextRowTap = false; return }
    if (this.data.reordering && event.currentTarget.dataset.type !== 'group') return
    if (event.currentTarget.dataset.type === 'group') this.toggleGroup(event)
    else this.openItem(event)
  },
  toggleGroup(event) {
    const id = event.currentTarget.dataset.id
    const expanded = new Set(this.data.expandedGroups)
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id)
    const expandedGroups = Array.from(expanded)
    this.setData({ expandedGroups, rows: rowsFor(this.data.reordering && this.dragController ? this.dragController.draft() : promptStore.items(), expandedGroups) })
  },
  openItem(event) {
    if (this.data.reordering) return
    wx.navigateTo({ url: `/pages/instruction-edit/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` })
  },
  rowTouchStart(event) {
    const touch = event.touches && event.touches[0]
    if (touch) this.rowTouch = { x: touch.pageX, y: touch.pageY, id: event.currentTarget.dataset.id }
  },
  rowTouchEnd(event) {
    if (!this.rowTouch || this.data.reordering) { this.rowTouch = null; return }
    const touch = event.changedTouches && event.changedTouches[0]
    const start = this.rowTouch; this.rowTouch = null
    if (!touch || start.id !== event.currentTarget.dataset.id) return
    const dx = touch.pageX - start.x; const dy = Math.abs(touch.pageY - start.y)
    if (dx < -60 && dy < 40) {
      this.ignoreNextRowTap = true
      setTimeout(() => { this.ignoreNextRowTap = false }, 350)
      this.deleteItem({ currentTarget: { dataset: { id: start.id } } })
    }
  },
  openNewMenu() { if (!this.data.mutating && !this.data.reordering) this.setData({ newMenuVisible: true }) },
  closeNewMenu() { this.setData({ newMenuVisible: false }) },
  noop() {},
  createPrompt() { this.setData({ newMenuVisible: false }); wx.navigateTo({ url: '/pages/prompt-new/index?type=action' }) },
  createGroup() { this.setData({ newMenuVisible: false }); wx.navigateTo({ url: '/pages/prompt-new/index?type=group' }) },
  openImport() { this.setData({ importVisible: true, importCode: '', importPreview: null, importLoading: false, importing: false, importError: '' }) },
  closeImport() { if (!this.data.importing) this.setData({ importVisible: false }) },
  onImportCodeInput(event) {
    const importCode = tree.mergeCodeInput(this.data.importCode, event.detail.value)
    this.setData({ importCode, importPreview: null, importError: '' })
    if (tree.extractShareCode(importCode) === importCode) this.loadImportPreview(importCode)
  },
  async loadImportPreview(code) {
    this.setData({ importLoading: true, importError: '' })
    const result = await promptStore.preview(code)
    if (code !== this.data.importCode) return
    this.setData({ importLoading: false, importPreview: result.ok ? result.data : null, importError: result.ok ? '' : (result.error === 'not_found' ? '分享码无效或已停止分享' : '加载失败，请重试') })
  },
  async confirmImportSheet() {
    if (!this.data.importPreview || this.data.importing) return
    this.setData({ importing: true, importError: '' })
    const result = await promptStore.importCode(this.data.importCode)
    if (!result.ok) { this.setData({ importing: false, importError: '导入失败，请重试' }); return }
    wx.showToast({ title: '已导入' })
    this.setData({ importVisible: false, importing: false })
    await this.loadItems()
  },
  async deleteItem(event) {
    if (this.data.mutating || this.data.reordering) return
    const id = event.currentTarget.dataset.id
    const modal = await new Promise((resolve) => wx.showModal({ title: '删除提示词', content: '删除后无法恢复；删除分组会同时删除组内提示词。', confirmText: '删除', success: resolve }))
    if (!modal.confirm) return
    this.setData({ mutating: true })
    const result = await promptStore.remove(id)
    this.setData({ mutating: false, rows: this.displayedRows(promptStore.items()), error: result.ok ? '' : '删除失败，请重试' })
  },
  async restoreDefaults() {
    if (this.data.mutating) return
    const modal = await new Promise((resolve) => wx.showModal({ title: '恢复默认提示词', content: '会补回缺少的系统提示词，不会删除自建内容。', success: resolve }))
    if (!modal.confirm) return
    this.setData({ mutating: true })
    const result = await promptStore.restoreDefaults()
    this.setData({ mutating: false, rows: this.displayedRows(promptStore.items()), error: result.ok ? '' : '恢复失败，请重试' })
  },
  startReorder() {
    if (this.data.reordering || this.data.mutating) return
    this.dragController = promptDrag.create(); this.dragController.begin(promptStore.items())
    this.setData({ reordering: true, rows: this.displayedRows(this.dragController.draft()), error: '' })
  },
  movePrompt(event) {
    if (!this.dragController || !this.data.reordering) return
    if (event.detail && event.detail.source && event.detail.source !== 'touch') return
    const id = event.currentTarget.dataset.id
    const target = this.data.rows[Math.max(0, Math.min(this.data.rows.length - 1, Math.round(Number(event.detail && event.detail.y || 0) / this.data.rowHeightPx)))]
    if (!target || target.id === id) return
    const source = this.data.rows.find((row) => row.id === id)
    const intoGroup = target.type === 'group' && source && source.type !== 'group'
    try {
      this.dragController.move(id, intoGroup ? target.id : (target.parentId || null), intoGroup ? target.childCount : target.index)
      const expandedGroups = intoGroup ? Array.from(new Set([...this.data.expandedGroups, target.id])) : this.data.expandedGroups
      this.setData({ expandedGroups, rows: rowsFor(this.dragController.draft(), expandedGroups) })
    } catch (_) { wx.showToast({ title: '分组不能放进分组', icon: 'none' }) }
  },
  cancelReorder() {
    if (this.dragController) this.dragController.cancel()
    this.dragController = null
    this.setData({ reordering: false, rows: this.displayedRows(promptStore.items()) })
  },
  async finishReorder() {
    if (!this.dragController || this.data.mutating) return
    this.setData({ mutating: true })
    const result = await this.dragController.commit(promptStore)
    if (!result.ok) { this.setData({ mutating: false, error: result.error === 'conflict' ? '列表已更新，请重新排序' : '保存失败，请重试' }); return }
    this.dragController = null
    this.setData({ mutating: false, reordering: false, rows: this.displayedRows(promptStore.items()), error: '' })
  }
})

module.exports = { rowsFor, appliesLabel }
