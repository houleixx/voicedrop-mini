const promptStore = require('../../services/prompt-store')
const tree = require('../../utils/prompt-tree')

function find(items, id) {
  for (const item of items || []) { if (item.id === id) return item; const child = find(item.children, id); if (child) return child }
  return null
}

Page({
  data: {
    itemId: '', item: null, loading: true, saving: false, error: '', pageTitle: '提示词',
    nameDraft: '', instructionDraft: '', textDraft: true, imageDraft: false, dirty: false,
    shareCode: null, sharing: false, shareToggling: false, shareError: ''
  },
  onLoad(options) { this.setData({ itemId: decodeURIComponent(options.id || '') }) },
  onShow() { if (!this.data.item) this.loadItem() },
  async loadItem() {
    const item = find(promptStore.items(), this.data.itemId)
    if (!item) { this.setData({ loading: false, error: '加载失败' }); return }
    const shares = item.type === 'action' ? await promptStore.shareStates() : { byItem: {} }
    const share = shares.byItem && shares.byItem[item.id] || {}
    this.setData({
      item, loading: false, pageTitle: item.label, nameDraft: item.label,
      instructionDraft: item.prompt || '', textDraft: (item.appliesTo || []).includes('text'), imageDraft: (item.appliesTo || []).includes('image'),
      shareCode: share.code || null, sharing: Boolean(share.sharing), dirty: false, error: ''
    })
  },
  updateDirty(update) {
    const next = Object.assign({}, this.data, update); const item = next.item
    update.dirty = Boolean(item) && (next.nameDraft !== item.label || next.instructionDraft !== (item.prompt || '') || next.textDraft !== (item.appliesTo || []).includes('text') || next.imageDraft !== (item.appliesTo || []).includes('image'))
    this.setData(update)
  },
  onNameInput(event) { this.updateDirty({ nameDraft: event.detail.value.slice(0, 40) }) },
  onInstructionInput(event) { this.updateDirty({ instructionDraft: event.detail.value }) },
  onTextChange(event) { this.updateDirty({ textDraft: event.detail.value }) },
  onImageChange(event) { this.updateDirty({ imageDraft: event.detail.value }) },
  toggleText() { this.updateDirty({ textDraft: !this.data.textDraft }) },
  toggleImage() { this.updateDirty({ imageDraft: !this.data.imageDraft }) },
  restoreDefault() {
    if (!this.data.item || !this.data.item.forkedFrom) return
    this.setData({ error: '派生项可直接修改；如需系统原版，请在列表中使用“恢复默认”' })
  },
  async toggleSharing(event) {
    if (this.data.shareToggling || !this.data.item) return
    const previous = Boolean(this.data.sharing)
    const desired = Boolean(event.detail.value); this.setData({ shareToggling: true, shareError: '' })
    const result = await promptStore.setSharing(this.data.itemId, desired)
    if (!result.ok) {
      const messages = {
        daily_cap: '今天生成分享码的次数已达上限，明天再试',
        needs_wechat_signin: '请先微信登录后再分享提示词',
        content_flagged: '提示词未通过社区审核，暂时不能分享',
        'not-shareable': '这条提示词暂时不能分享'
      }
      this.setData({ shareToggling: false, sharing: previous, shareError: messages[result.error] || `操作失败：${result.error || '请重试'}` }); return
    }
    this.setData({ shareToggling: false, sharing: result.sharing, shareCode: result.code || this.data.shareCode })
  },
  copyShareCode() { if (this.data.shareCode) wx.setClipboardData({ data: this.data.shareCode }) },
  copyShareLink() { if (this.data.shareCode) wx.setClipboardData({ data: `https://voicedrop.cn/${this.data.shareCode}` }) },
  onShareAppMessage() {
    const code = this.data.sharing && this.data.shareCode
    if (!code) return { title: 'VoiceDrop 提示词', path: '/pages/instruction-settings/index' }
    return { title: `${this.data.nameDraft}｜分享码 ${code}｜https://voicedrop.cn/${code}`, path: `/pages/prompt-import/index?promptCode=${code}` }
  },
  async save() {
    if (this.data.saving || !this.data.item || !this.data.dirty) return
    const label = this.data.nameDraft.trim(); const prompt = this.data.instructionDraft.trim()
    if (!label || (this.data.item.type === 'action' && (!prompt || (!this.data.textDraft && !this.data.imageDraft)))) { this.setData({ error: '请填写名称和提示词，并至少选择一种应用场景' }); return }
    let next = this.data.item.origin === 'system' ? tree.fork(this.data.item) : tree.cloneNode(this.data.item)
    next.label = label
    if (next.type === 'action') { next.prompt = prompt; next.appliesTo = [...(this.data.textDraft ? ['text'] : []), ...(this.data.imageDraft ? ['image'] : [])] }
    this.setData({ saving: true, error: '' })
    const result = await promptStore.replace(this.data.item.id, next)
    if (result.ok) wx.navigateBack()
    else this.setData({ saving: false, error: '保存失败，请重试' })
  }
})

module.exports = { find }
