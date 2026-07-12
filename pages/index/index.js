Page({
  data: {
    title: 'VoiceDrop Mini',
    subtitle: '轻量语音收集与处理入口',
    steps: [
      '录制或上传语音',
      '整理文本与摘要',
      '保存并分享结果'
    ]
  },

  onLoad() {
    wx.redirectTo({ url: '/pages/recordings/index' })
  },

  onStartTap() {
    wx.redirectTo({ url: '/pages/recordings/index' })
  }
})
