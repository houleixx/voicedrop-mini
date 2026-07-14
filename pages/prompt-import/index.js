const promptStore = require('../../services/prompt-store')
const tree = require('../../utils/prompt-tree')

Page({
  data: { code: '', preview: null, loading: false, importing: false, error: '' },
  onLoad(options) {
    const code = tree.extractShareCode(decodeURIComponent(options && options.promptCode || '')) || ''
    this.setData({ code }); if (code) this.loadPreview(code)
  },
  onCodeInput(event) {
    const code = tree.mergeCodeInput(this.data.code, event.detail.value)
    this.setData({ code, preview: null, error: '' })
    if (tree.extractShareCode(code) === code) this.loadPreview(code)
    return code
  },
  async loadPreview(code) {
    this.setData({ loading: true, error: '' })
    const result = await promptStore.preview(code)
    if (code !== this.data.code) return
    this.setData({ loading: false, preview: result.ok ? result.data : null, error: result.ok ? '' : (result.error === 'not_found' ? '分享码无效或已停止分享' : '加载失败，请重试') })
  },
  async confirmImport() {
    if (!this.data.preview || this.data.importing) return
    this.setData({ importing: true, error: '' })
    const result = await promptStore.importCode(this.data.code)
    if (result.ok) { wx.showToast({ title: '已导入' }); wx.navigateBack() }
    else this.setData({ importing: false, error: '导入失败，请重试' })
  },
  onShareAppMessage() {
    return { title: this.data.preview ? `${this.data.preview.label}｜VoiceDrop 提示词` : 'VoiceDrop 提示词', path: `/pages/prompt-import/index?promptCode=${this.data.code}` }
  }
})
