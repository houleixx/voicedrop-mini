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
    error: ''
  },

  onLoad() {
    const chapters = manualService.loadBundled()
    if (chapters.length) {
      this.setData({ chapters, error: '' })
      return
    }
    this.setData({ error: '使用手册暂时无法读取' })
  },

  jumpToSection(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    if (id !== this.data.activeSection) this.pendingSection = id
    this.setData({ activeSection: id, scrollTarget: '' })
    wx.nextTick(() => this.setData({ scrollTarget: id }))
    clearTimeout(this.sectionTimer)
    this.sectionTimer = setTimeout(() => { this.pendingSection = '' }, 700)
  },

  onSectionVisible(event) {
    const id = event.currentTarget.dataset.id
    if (this.pendingSection) {
      if (id === this.pendingSection) this.pendingSection = ''
      return
    }
    if (id && id !== this.data.activeSection) this.setData({ activeSection: id })
  },

  onUnload() {
    clearTimeout(this.sectionTimer)
  }
})
