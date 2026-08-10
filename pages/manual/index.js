const manualService = require('../../services/manual')

const SECTIONS = [
  { id: 'ch1', label: '1 上手' },
  { id: 'ch2', label: '2 录音' },
  { id: 'ch3', label: '3 改稿' },
  { id: 'ch4', label: '4 发布' },
  { id: 'ch5', label: '5 社区' },
  { id: 'ch6', label: '6 文风' },
  { id: 'ch7', label: '7 账号' },
  { id: 'ch8', label: '8 FAQ' }
]

Page({
  data: {
    sections: SECTIONS,
    activeSection: 'ch1',
    scrollTarget: '',
    chapters: [],
    loading: true,
    error: ''
  },

  onLoad() {
    const saved = manualService.cached()
    if (saved.sections.length) this.setData({ chapters: saved.sections, loading: false })
    this.syncManual()
  },

  async syncManual() {
    const result = await manualService.sync()
    if (result.sections.length) {
      this.setData({ chapters: result.sections, loading: false, error: '' })
      return
    }
    this.setData({ loading: false, error: result.error || '使用手册暂时无法加载' })
  },

  jumpToSection(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    this.setData({ activeSection: id, scrollTarget: '' })
    wx.nextTick(() => this.setData({ scrollTarget: id }))
  },

  onSectionVisible(event) {
    const id = event.currentTarget.dataset.id
    if (id && id !== this.data.activeSection) this.setData({ activeSection: id })
  }
})
