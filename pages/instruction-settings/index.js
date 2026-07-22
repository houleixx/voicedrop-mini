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

function marketKindLabel(item) {
  return appliesLabel(item) === '仅图片' ? '配图提示词' : '文字提示词'
}

function authorInitial(author) {
  return String(author || '匿名').trim().slice(0, 1) || '匿'
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

function findItem(items, id) {
  for (const item of items || []) {
    if (item.id === id) return item
    if (item.type === 'group') {
      const child = findItem(item.children, id)
      if (child) return child
    }
  }
  return null
}

Page({
  data: {
    rows: [], expandedGroups: [], loading: true, error: '', empty: false,
    mutating: false, reordering: false, newMenuVisible: false, newMenuClosing: false, groupDialogVisible: false, groupName: '', importVisible: false, importClosing: false,
    importCode: '', importPreview: null, importLoading: false, importing: false, importError: '', importKeyboardHeight: 0, rowHeightPx: 56,
    swipedRowId: '', swipeOffset: 0, swipeDeletePx: 72, swipeDragging: false,
    marketFilters: [
      { key: 'hot', label: '热门', sort: 'hot', scope: '' },
      { key: 'new', label: '最新', sort: 'new', scope: '' },
      { key: 'text', label: '文字', sort: 'hot', scope: 'text' },
      { key: 'image', label: '配图', sort: 'hot', scope: 'image' }
    ],
    marketFilter: 'hot', marketItems: [], marketLoading: false, marketError: '', marketImportingCode: '',
    marketDetail: null, marketDetailPrompt: '', marketDetailLoading: false, marketDetailClosing: false
  },
  onLoad() {
    this._sheetClosingDisposed = false
    this._sheetCloseTimers = []
    try {
      const width = Number(wx.getSystemInfoSync().windowWidth) || 375
      this.setData({ rowHeightPx: 112 * width / 750, swipeDeletePx: 144 * width / 750 })
    } catch (_) {}
  },
  onUnload() {
    this._sheetClosingDisposed = true
    ;(this._sheetCloseTimers || []).forEach((timer) => clearTimeout(timer))
    this._sheetCloseTimers = []
  },
  onShow() {
    if (!this.data.reordering) {
      this.loadItems()
      if (!this.data.marketItems.length && !this.data.marketLoading) this.loadMarket()
    }
  },
  displayedRows(items) { return rowsFor(items, this.data.expandedGroups) },
  async loadItems() {
    const cached = promptStore.items()
    this.setData({ rows: this.displayedRows(cached), loading: !cached.length, error: '', empty: !cached.length })
    const result = await promptStore.refresh()
    const items = promptStore.items()
    this.setData({ rows: this.displayedRows(items), loading: false, empty: !items.length,
      marketItems: this.decorateMarket(this.data.marketItems), error: result.ok ? '' : '加载失败，正在显示上次内容' })
  },
  decorateMarket(items) {
    return (items || []).map((item) => Object.assign({}, item, {
      appliesLabel: appliesLabel(item).replace('仅', '') || '全部',
      detailKindLabel: marketKindLabel(item),
      authorInitial: authorInitial(item.author),
      imageOnly: appliesLabel(item) === '仅图片',
      imported: tree.containsImport(promptStore.items(), item.code)
    }))
  },
  async loadMarket() {
    if (this.data.marketLoading) return
    const filter = this.data.marketFilters.find((item) => item.key === this.data.marketFilter) || this.data.marketFilters[0]
    const requestKey = filter.key
    this.setData({ marketLoading: true, marketError: '' })
    const result = await promptStore.market({ sort: filter.sort, scope: filter.scope, limit: 30 })
    if (requestKey !== this.data.marketFilter) return
    this.setData({ marketLoading: false, marketItems: result.ok ? this.decorateMarket(result.items) : [],
      marketError: result.ok ? '' : '社区提示词加载失败，点此重试' })
  },
  selectMarketFilter(event) {
    const key = event.currentTarget.dataset.key
    if (!this.data.marketFilters.some((item) => item.key === key) || key === this.data.marketFilter || this.data.marketLoading) return
    this.setData({ marketFilter: key, marketItems: [], marketError: '' })
    this.loadMarket()
  },
  retryMarket() { this.loadMarket() },
  openMarketDetail(event) {
    const code = event.currentTarget.dataset.code
    const item = this.data.marketItems.find((entry) => entry.code === code)
    if (!item) return
    this.setData({ marketDetail: item, marketDetailPrompt: '', marketDetailLoading: true, marketDetailClosing: false })
    this.loadMarketDetail(code)
  },
  closeMarketDetail() {
    if (!this.data.marketImportingCode) this.closeBottomSheet('marketDetailClosing', { marketDetail: null, marketDetailPrompt: '', marketDetailLoading: false })
  },
  async loadMarketDetail(code) {
    const result = await promptStore.preview(code)
    if (!this.data.marketDetail || this.data.marketDetail.code !== code) return
    this.setData({ marketDetailLoading: false,
      marketDetailPrompt: result.ok && result.data && result.data.prompt ? result.data.prompt : '这条提示词暂时无法读取。' })
  },
  async quickImportMarket(event) { return this.importMarketCode(event.currentTarget.dataset.code, false) },
  async importMarketDetail() {
    if (!this.data.marketDetail) return
    return this.importMarketCode(this.data.marketDetail.code, true)
  },
  async importMarketCode(code, closeDetail) {
    const item = this.data.marketItems.find((entry) => entry.code === code)
    if (!item || item.imported || this.data.marketImportingCode) return
    this.setData({ marketImportingCode: code })
    const result = await promptStore.importCode(code)
    if (!result.ok) {
      this.setData({ marketImportingCode: '' })
      wx.showToast({ title: '导入失败，请重试', icon: 'none' })
      return
    }
    this.setData({ marketImportingCode: '', marketItems: this.decorateMarket(this.data.marketItems) })
    if (closeDetail) this.closeMarketDetail()
    wx.showToast({ title: result.already ? '已经导入过了' : '已加入提示词', icon: 'none' })
    await this.loadItems()
  },
  handleRowTap(event) {
    if (this.ignoreNextRowTap) { this.ignoreNextRowTap = false; return }
    if (this.data.swipedRowId) { this.closeSwipe(); return }
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
    if (this.data.reordering || event.currentTarget.dataset.type !== 'action') { this.rowTouch = null; return }
    const touch = event.touches && event.touches[0]
    if (touch) {
      const id = event.currentTarget.dataset.id
      const startOffset = this.data.swipedRowId === id ? this.data.swipeOffset : 0
      this.rowTouch = { x: touch.pageX, y: touch.pageY, id, startOffset, horizontal: false }
      if (this.data.swipedRowId && this.data.swipedRowId !== id) this.setData({ swipedRowId: '', swipeOffset: 0 })
    }
  },
  rowTouchMove(event) {
    if (!this.rowTouch) return
    const touch = event.touches && event.touches[0]
    if (!touch) return
    const dx = touch.pageX - this.rowTouch.x
    const dy = touch.pageY - this.rowTouch.y
    if (!this.rowTouch.horizontal && Math.abs(dx) <= Math.abs(dy)) return
    this.rowTouch.horizontal = true
    const swipeOffset = Math.max(-this.data.swipeDeletePx, Math.min(0, this.rowTouch.startOffset + dx))
    this.setData({ swipedRowId: this.rowTouch.id, swipeOffset, swipeDragging: true })
  },
  rowTouchEnd(event) {
    if (!this.rowTouch || this.data.reordering) { this.rowTouch = null; return }
    const touch = event.changedTouches && event.changedTouches[0]
    const start = this.rowTouch; this.rowTouch = null
    if (!touch || start.id !== event.currentTarget.dataset.id) return
    const dx = touch.pageX - start.x; const dy = Math.abs(touch.pageY - start.y)
    if (start.horizontal || (Math.abs(dx) > 12 && Math.abs(dx) > dy)) {
      this.ignoreNextRowTap = true
      setTimeout(() => { this.ignoreNextRowTap = false }, 350)
      const finalOffset = Math.max(-this.data.swipeDeletePx, Math.min(0, start.startOffset + dx))
      const reveal = finalOffset <= -this.data.swipeDeletePx / 2
      this.setData({ swipedRowId: reveal ? start.id : '', swipeOffset: reveal ? -this.data.swipeDeletePx : 0, swipeDragging: false })
    }
  },
  closeSwipe() { this.setData({ swipedRowId: '', swipeOffset: 0, swipeDragging: false }) },
  openNewMenu() { if (!this.data.mutating && !this.data.reordering) this.setData({ newMenuVisible: true, newMenuClosing: false }) },
  closeNewMenu() { this.closeBottomSheet('newMenuClosing', { newMenuVisible: false }) },
  closeBottomSheet(closingKey, hiddenState) {
    if (this.data[closingKey]) return
    this.setData({ [closingKey]: true })
    const timer = setTimeout(() => {
      this._sheetCloseTimers = (this._sheetCloseTimers || []).filter((entry) => entry !== timer)
      if (this._sheetClosingDisposed) return
      this.setData(Object.assign({ [closingKey]: false }, hiddenState))
    }, 200)
    this._sheetCloseTimers = (this._sheetCloseTimers || []).concat(timer)
  },
  noop() {},
  createPrompt() { this.setData({ newMenuVisible: false }); wx.navigateTo({ url: '/pages/prompt-new/index?type=action' }) },
  createGroup() { this.setData({ groupDialogVisible: true, groupName: '' }) },
  closeGroupDialog() { if (!this.data.mutating) this.setData({ groupDialogVisible: false, groupName: '' }) },
  onGroupNameInput(event) { this.setData({ groupName: event.detail.value.slice(0, 40) }) },
  async confirmCreateGroup() {
    if (this.data.mutating) return
    const label = this.data.groupName.trim()
    if (!label) { wx.showToast({ title: '请输入分组名字', icon: 'none' }); return }
    this.setData({ mutating: true })
    const result = await promptStore.add({ id: tree.newUserId(), type: 'group', label, origin: 'user', children: [] }, null)
    if (!result.ok) { this.setData({ mutating: false, error: '创建失败，请重试' }); return }
    wx.showToast({ title: '已创建' })
    this.setData({ mutating: false, newMenuVisible: false, groupDialogVisible: false, groupName: '' })
    await this.loadItems()
  },
  openImport() { this.setData({ importVisible: true, importClosing: false, importCode: '', importPreview: null, importLoading: false, importing: false, importError: '', importKeyboardHeight: 0 }) },
  closeImport() { if (!this.data.importing) this.closeBottomSheet('importClosing', { importVisible: false, importKeyboardHeight: 0 }) },
  onImportKeyboardHeightChange(event) {
    const height = Number(event && event.detail && event.detail.height) || 0
    this.setData({ importKeyboardHeight: Math.max(0, height) })
  },
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
    this.setData({ importing: false })
    this.closeImport()
    await this.loadItems()
  },
  async deleteItem(event) {
    if (this.data.mutating || this.data.reordering) return
    const id = event.currentTarget.dataset.id
    const item = findItem(promptStore.items(), id)
    if (!item || item.type !== 'action') { this.closeSwipe(); return }
    const modal = await new Promise((resolve) => wx.showModal({ title: '删除提示词', content: `确定删除“${item.label}”吗？删除后无法恢复。`, confirmText: '删除', confirmColor: '#d8593b', success: resolve }))
    if (!modal.confirm) { this.closeSwipe(); return }
    this.setData({ mutating: true })
    wx.showLoading({ title: '删除中', mask: true })
    let result
    try {
      result = await promptStore.remove(id)
    } catch (_) {
      result = { ok: false, error: 'delete_failed' }
    } finally {
      wx.hideLoading()
    }
    this.setData({ mutating: false, swipedRowId: '', swipeOffset: 0, rows: this.displayedRows(promptStore.items()), error: result.ok ? '' : '删除失败，请重试' })
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
    this.rowTouch = null
    this.dragController = promptDrag.create(); this.dragController.begin(promptStore.items())
    this.setData({ reordering: true, swipedRowId: '', swipeOffset: 0, swipeDragging: false, rows: this.displayedRows(this.dragController.draft()), error: '' })
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
    wx.showLoading({ title: '保存中', mask: true })
    let result
    try {
      result = await this.dragController.commit(promptStore)
    } catch (_) {
      result = { ok: false, error: 'save_failed' }
    } finally {
      wx.hideLoading()
    }
    if (!result.ok) { this.setData({ mutating: false, error: result.error === 'conflict' ? '列表已更新，请重新排序' : '保存失败，请重试' }); return }
    this.dragController = null
    this.setData({ mutating: false, reordering: false, rows: this.displayedRows(promptStore.items()), error: '' })
  }
})

module.exports = { rowsFor, appliesLabel, marketKindLabel, authorInitial, findItem }
