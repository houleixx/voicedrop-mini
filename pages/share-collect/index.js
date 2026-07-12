const shareCollect = require('../../services/share-collect')

Page({
  data: {
    type: 'article',
    title: '',
    source: '',
    text: '',
    dataset: [],
    images: [],
    generatingImages: false,
    audioFile: null,
    generatingAudio: false
  },

  onLoad() {
    this.loadDataset()
  },

  onShareAppMessage() {
    return {
      title: '收集 VoiceDrop 文风素材',
      path: '/pages/share-collect/index'
    }
  },

  onShareTimeline() {
    return {
      title: '收集 VoiceDrop 文风素材',
      query: ''
    }
  },

  onInput(event) {
    this.setData({ [event.currentTarget.dataset.key]: event.detail.value })
  },

  chooseImages() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const images = this.data.images.concat((res.tempFiles || []).map((file) => ({ path: file.tempFilePath })))
        this.setData({ images })
      }
    })
  },

  removeImage(event) {
    const index = Number(event.currentTarget.dataset.index)
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },

  chooseAudio() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['m4a', 'mp3', 'aac', 'wav', 'mp4'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (file) this.setData({ audioFile: { path: file.path, name: file.name || '音频文件', size: file.size || 0 } })
      }
    })
  },

  clearAudio() {
    this.setData({ audioFile: null })
  },

  async generateFromAudio() {
    if (!this.data.audioFile) {
      wx.showToast({ title: '先选音频', icon: 'error' })
      return
    }
    this.setData({ generatingAudio: true })
    wx.showLoading({ title: '上传音频' })
    try {
      const ok = await shareCollect.generateFromAudio(this.data.audioFile.path, 0)
      wx.showToast({ title: ok ? '已送入 VoiceDrop' : '生成失败', icon: ok ? 'success' : 'error' })
      if (ok) this.setData({ audioFile: null })
    } finally {
      wx.hideLoading()
      this.setData({ generatingAudio: false })
    }
  },

  async generateFromImages() {
    if (!this.data.images.length) {
      wx.showToast({ title: '先选图片', icon: 'error' })
      return
    }
    this.setData({ generatingImages: true })
    wx.showLoading({ title: '上传图片' })
    try {
      const ok = await shareCollect.generateFromImages(this.data.images.map((item) => item.path))
      wx.showToast({ title: ok ? '已送入 VoiceDrop' : '生成失败', icon: ok ? 'success' : 'error' })
      if (ok) this.setData({ images: [] })
    } finally {
      wx.hideLoading()
      this.setData({ generatingImages: false })
    }
  },

  async collect() {
    if (!this.data.text.trim()) {
      wx.showToast({ title: '先粘贴内容', icon: 'error' })
      return
    }
    const title = this.data.title.trim() || shareCollect.titleForText(this.data.text, '分享内容')
    const ok = await shareCollect.collectStyle(this.data.type, title, this.data.text, this.data.source)
    wx.showToast({ title: ok ? '已收集' : '收集失败', icon: ok ? 'success' : 'error' })
    if (ok) {
      this.setData({ title: '', source: '', text: '' })
      this.loadDataset()
    }
  },

  async loadDataset() {
    this.setData({ dataset: await shareCollect.fetchDataset() })
  },

  async clearDataset() {
    const ok = await shareCollect.deleteDataset()
    wx.showToast({ title: ok ? '已清空' : '清空失败', icon: ok ? 'success' : 'error' })
    if (ok) this.setData({ dataset: [] })
  },

  async triggerExtract() {
    await this.triggerStyleExtract(true)
  },

  async triggerExtractKeep() {
    await this.triggerStyleExtract(false)
  },

  async triggerStyleExtract(clearAfter) {
    const chars = this.data.dataset.reduce((sum, item) => sum + (Number(item.chars) || 0), 0)
    if (chars < 300) {
      wx.showToast({ title: '素材至少 300 字', icon: 'error' })
      return
    }
    const ok = await shareCollect.triggerStyleExtract(clearAfter)
    wx.showToast({ title: ok ? '已提交提炼' : '提交失败', icon: ok ? 'success' : 'error' })
  }
})
