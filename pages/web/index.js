const ALLOWED = new Set([
  'https://voicedrop.cn/help/manual/',
  'https://voicedrop.cn/books/'
])

Page({
  data: { url: '', title: 'VoiceDrop' },
  onLoad(options) {
    const url = decodeURIComponent(options && options.url || '')
    const title = decodeURIComponent(options && options.title || 'VoiceDrop')
    if (!ALLOWED.has(url)) { wx.showToast({ title: '无法打开这个地址', icon: 'none' }); return }
    this.setData({ url, title })
    if (wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title })
  }
})
