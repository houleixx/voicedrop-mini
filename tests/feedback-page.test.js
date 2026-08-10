const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')

function freshFeedback() {
  const settings = require('../services/settings')
  const originalLoadStyle = settings.loadStyle
  const originalSendFeedback = settings.sendFeedback
  const toasts = []
  const navigations = []
  const loadingCalls = []
  const events = []
  let page
  settings.loadStyle = async () => ({ name: '测试用户' })
  settings.sendFeedback = async () => true
  global.Page = (definition) => { page = definition }
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { version: '1.2.3', envVersion: 'release' } }),
    showLoading: (options) => { loadingCalls.push(['show', options]); events.push('loading') },
    hideLoading: () => { loadingCalls.push(['hide']); events.push('hide-loading') },
    showToast: (options) => { toasts.push(options); events.push('toast') },
    navigateBack: (options) => {
      navigations.push({ delta: options.delta })
      events.push('navigate')
      if (options.success) options.success()
    }
  }
  delete require.cache[require.resolve('../pages/feedback/index')]
  require('../pages/feedback/index')
  const ctx = Object.assign({}, page, {
    data: Object.assign({}, page.data, { draft: '希望增加这个功能' }),
    setData(update) { Object.assign(this.data, update) }
  })
  return {
    page,
    ctx,
    toasts,
    navigations,
    loadingCalls,
    events,
    restore() {
      settings.loadStyle = originalLoadStyle
      settings.sendFeedback = originalSendFeedback
    }
  }
}

test('feedback content clears the fixed title bar and the send label is flex-centered', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/feedback/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/feedback/index.wxss'), 'utf8')

  assert.match(wxml, /class="screen settings-screen feedback-page"[\s\S]*class="page-body feedback-body"/)
  assert.match(css, /\.feedback-page\s*\{[^}]*--settings-content-top:\s*198rpx;/s)
  assert.match(css, /\.feature-primary\s*\{[^}]*display:\s*flex;[^}]*height:\s*92rpx;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s)
  assert.match(wxml, /placeholder="哪里不顺手？想要什么功能？写一句就行。"/)
  assert.doesNotMatch(wxml, /class="feature-intro"/)
  assert.match(wxml, /wx:if="\{\{sending\}\}" class="feature-loading"[\s\S]*class="feature-spinner"[\s\S]*发送中…/)
  assert.match(css, /@keyframes feedback-spin/)
})

test('successful feedback shows confirmation and returns to about', async () => {
  const h = freshFeedback()
  try {
    await h.page.send.call(h.ctx)
    assert.deepEqual(h.toasts, [{ title: '提交成功', icon: 'success' }])
    assert.deepEqual(h.navigations, [{ delta: 1 }])
    assert.deepEqual(h.loadingCalls, [
      ['show', { title: '提交中…', mask: true }],
      ['hide']
    ])
    assert.deepEqual(h.events, ['loading', 'hide-loading', 'navigate', 'toast'])
  } finally {
    h.restore()
  }
})
