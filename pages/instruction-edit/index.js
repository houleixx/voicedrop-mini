const instructionSettings = require('../../services/instruction-settings')
const uiConfigService = require('../../services/ui-config')

Page({
  data: {
    itemId: '', item: null, loading: true, saving: false, error: '',
    pageTitle: '提示词', nameDraft: '', instructionDraft: '', hiddenDraft: false, dirty: false,
    shareCode: null, sharing: false, shareToggling: false, shareError: ''
  },
  onLoad(options) { this.setData({ itemId: decodeURIComponent(options.id || '') }) },
  onShow() { if (!this.data.item) this.loadItem() },
  async loadItem() {
    this.setData({ loading: true, error: '' })
    const result = await instructionSettings.load()
    const item = result.ok && result.items.find((entry) => entry.id === this.data.itemId)
    if (!item) { this.setData({ loading: false, error: '加载失败' }); return }
    this.setData({
      item,
      loading: false,
      pageTitle: item.label,
      nameDraft: item.customLabel || '',
      instructionDraft: item.override || '',
      hiddenDraft: item.hidden,
      shareCode: item.shareCode,
      sharing: item.sharing,
      dirty: false
    })
  },
  updateDirty(update) {
    const next = Object.assign({}, this.data, update)
    const item = next.item
    update.dirty = Boolean(item) && (next.nameDraft !== (item.customLabel || '') || next.instructionDraft !== (item.override || '') || next.hiddenDraft !== item.hidden)
    this.setData(update)
  },
  onNameInput(event) { this.updateDirty({ nameDraft: event.detail.value.slice(0, 20) }) },
  onInstructionInput(event) { this.updateDirty({ instructionDraft: event.detail.value }) },
  onHiddenChange(event) { this.updateDirty({ hiddenDraft: event.detail.value }) },
  restoreDefault() { this.updateDirty({ nameDraft: '', instructionDraft: '' }) },
  async toggleSharing(event) {
    if (this.data.shareToggling || !this.data.item) return
    const sharing = Boolean(event.detail.value)
    this.setData({ shareToggling: true, shareError: '' })
    const result = await instructionSettings.setSharing(this.data.itemId, sharing)
    if (!result.ok) {
      const messages = {
        daily_cap: '今天生成分享码的次数已达上限，明天再试',
        network_error: '网络出错，请重试'
      }
      this.setData({ shareToggling: false, shareError: messages[result.error] || '操作失败，请重试' })
      return
    }
    this.setData({
      shareToggling: false,
      sharing: Boolean(result.sharing),
      shareCode: result.code || this.data.shareCode
    })
  },
  copyShareCode() {
    if (this.data.shareCode) wx.setClipboardData({ data: this.data.shareCode })
  },
  copyShareLink() {
    if (this.data.shareCode) wx.setClipboardData({ data: `https://voicedrop.cn/${this.data.shareCode}` })
  },
  onShareAppMessage() {
    const code = this.data.sharing && this.data.shareCode
    if (!code) return { title: 'VoiceDrop 提示词', path: '/pages/instruction-settings/index' }
    const name = this.data.nameDraft || this.data.item.customLabel || this.data.item.defaultName
    return {
      title: `${name}｜分享码 ${code}｜https://voicedrop.cn/${code}`,
      path: '/pages/instruction-settings/index'
    }
  },
  async save() {
    if (this.data.saving || !this.data.item) return
    this.setData({ saving: true, error: '' })
    const result = await instructionSettings.save(this.data.itemId, this.data.instructionDraft, this.data.nameDraft, this.data.hiddenDraft)
    if (!result.ok) { this.setData({ saving: false, error: '保存失败，请重试' }); return }
    try { await uiConfigService.refresh() } catch (_) {}
    this.setData({ saving: false })
    wx.navigateBack()
  }
})
