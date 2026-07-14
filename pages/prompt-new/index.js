const promptStore = require('../../services/prompt-store')
const tree = require('../../utils/prompt-tree')

Page({
  data: { type: 'action', pageTitle: '新建提示词', label: '', prompt: '', text: true, image: false, saving: false, error: '' },
  onLoad(options) { const type = options && options.type === 'group' ? 'group' : 'action'; this.setData({ type, pageTitle: type === 'group' ? '新建分组' : '新建提示词' }) },
  onLabel(event) { this.setData({ label: event.detail.value.slice(0, 40) }) },
  onPrompt(event) { this.setData({ prompt: event.detail.value }) },
  onText(event) { this.setData({ text: event.detail.value }) },
  onImage(event) { this.setData({ image: event.detail.value }) },
  async save() {
    if (this.data.saving) return
    const label = this.data.label.trim(); const prompt = this.data.prompt.trim()
    if (!label || (this.data.type === 'action' && (!prompt || (!this.data.text && !this.data.image)))) { this.setData({ error: '请填写名称和提示词，并至少选择一种应用场景' }); return }
    const node = { id: tree.newUserId(), type: this.data.type, label, origin: 'user' }
    if (node.type === 'group') node.children = []
    else { node.prompt = prompt; node.appliesTo = [...(this.data.text ? ['text'] : []), ...(this.data.image ? ['image'] : [])] }
    this.setData({ saving: true, error: '' })
    const result = await promptStore.add(node, null)
    if (result.ok) wx.navigateBack()
    else this.setData({ saving: false, error: '保存失败，请重试' })
  }
})
