const test = require('node:test')
const assert = require('node:assert/strict')

function freshCommunityDetailPage(routes, currentCommunityPost) {
  let page
  const storage = {}
  const requests = []
  const app = {
    globalData: {
      currentCommunityPost
    }
  }
  global.getApp = () => app
  global.Page = (definition) => {
    page = definition
  }
  global.wx = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    request: (options) => {
      requests.push(options)
      const hit = routes.find((route) => options.url.endsWith(route.path) && (!route.method || route.method === options.method))
      options.success({
        statusCode: hit ? hit.statusCode || 200 : 404,
        data: hit ? hit.data : {}
      })
    }
  }
  ;[
    '../pages/community-detail/index',
    '../services/community',
    '../services/library',
    '../services/audio',
    '../services/request',
    '../services/auth',
    '../utils/pending-replies'
  ].forEach((id) => {
    delete require.cache[require.resolve(id)]
  })
  require('../pages/community-detail/index')
  page.__requests = requests
  return page
}

test('community detail refreshes list summaries before rendering article body', async () => {
  const page = freshCommunityDetailPage([
    {
      path: '/community/get/share-1',
      data: {
        post: {
          shareId: 'share-1',
          title: '列表标题',
          authorName: '匿名',
          articleKey: 'articles/VoiceDrop-a.json'
        }
      }
    },
    {
      path: '/articles/articles/VoiceDrop-a',
      data: {
        articles: [{ title: '正文标题', body: '正文内容' }]
      }
    }
  ], {
    shareId: 'share-1',
    title: '列表标题'
  })
  const ctx = {
    data: {
      shareId: 'share-1',
      post: { shareId: 'share-1', title: '列表标题' },
      sections: [],
      replies: []
    },
    setData(update) {
      Object.assign(this.data, update)
    },
    articleSections: page.articleSections,
    loadFullReplies: async () => []
  }

  await page.load.call(ctx)

  assert.equal(ctx.data.post.articleKey, 'articles/VoiceDrop-a.json')
  assert.equal(ctx.data.article.title, '正文标题')
  assert.equal(ctx.data.sections[0].blocks[0].text, '正文内容')
  assert.equal(ctx.data.loading, false)
})

test('community detail shows loading state while article body is fetching', async () => {
  const page = freshCommunityDetailPage([
    {
      path: '/community/get/share-1',
      data: {
        post: {
          shareId: 'share-1',
          title: '列表标题',
          articleKey: 'articles/VoiceDrop-a.json'
        }
      }
    },
    {
      path: '/articles/articles/VoiceDrop-a',
      data: {
        articles: [{ title: '正文标题', body: '正文内容' }]
      }
    }
  ], {
    shareId: 'share-1',
    title: '列表标题'
  })
  const loadingUpdates = []
  const ctx = {
    data: {
      shareId: 'share-1',
      post: { shareId: 'share-1', title: '列表标题' },
      sections: [],
      replies: [],
      loading: false
    },
    setData(update) {
      if (Object.prototype.hasOwnProperty.call(update, 'loading')) {
        loadingUpdates.push(update.loading)
      }
      Object.assign(this.data, update)
    },
    articleSections: page.articleSections,
    loadFullReplies: async () => []
  }

  await page.load.call(ctx)

  assert.deepEqual(loadingUpdates, [true, false])
  assert.equal(ctx.data.sections[0].blocks[0].text, '正文内容')
})

test('community detail has custom actions and loading markup', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.wxss'), 'utf8')
  const toolbarActionsRule = wxss.match(/\.toolbar-actions\s*\{([^}]*)\}/)[1]
  const toolButtonRule = wxss.match(/\.tool-button\s*\{([^}]*)\}/)[1]
  const iconButtonRule = wxss.match(/\.icon-only-button\s*\{([^}]*)\}/)[1]
  const actionIconRule = wxss.match(/\.action-icon\s*\{([^}]*)\}/)[1]
  const moreIconRule = wxss.match(/\.more-icon\s*\{([^}]*)\}/)[1]
  const loadingRule = wxss.match(/\.loading-card\s*\{([^}]*)\}/)[1]
  const loadingSpinnerRule = wxss.match(/\.loading-spinner\s*\{([^}]*)\}/)?.[1] || ''
  const moreMenuCardRule = wxss.match(/\.more-menu-card\s*\{([^}]*)\}/)?.[1] || ''
  const moreMenuRowRule = wxss.match(/\.more-menu-row\s*\{([^}]*)\}/)?.[1] || ''
  const moreMenuShareButtonRule = wxss.match(/\.more-menu-share-button\s*\{([^}]*)\}/)?.[1] || ''

  assert.match(wxml, /bindtap="tip"/)
  assert.match(wxml, /bindtap="toggleLike"/)
  assert.match(wxml, /article-head[\s\S]*loading-card/)
  assert.match(wxml, /<view class="loading-card" wx:if="\{\{loading\}\}">/)
  assert.match(wxml, /<view class="loaded-content" wx:else>/)
  assert.match(wxml, /loaded-content[\s\S]*article card/)
  assert.doesNotMatch(wxml, /loaded-content[\s\S]*article-head/)
  assert.match(wxml, /<view class="loading-card" wx:if="\{\{loading\}\}">\s*<view class="loading-spinner" aria-hidden="true"><\/view>\s*<text>内容加载中\.\.\.<\/text>\s*<\/view>/)
  assert.match(wxml, /加载中/)
  assert.match(wxml, /class="more-menu-layer"/)
  assert.match(wxml, /data-action="reply"/)
  assert.match(wxml, /class="more-menu-row more-menu-share-row"/)
  assert.match(wxml, /class="more-menu-share-button"/)
  assert.match(wxml, /open-type="share"/)
  assert.match(wxml, /bindtap="shareLink"/)
  assert.match(wxml, /data-action="report"/)
  assert.match(wxml, /data-action="blockAuthor"/)
  assert.match(wxml, /aria-label="投币"/)
  assert.match(wxml, /ri-flashlight-line/)
  assert.doesNotMatch(wxml, /coin-action-icon/)
  assert.doesNotMatch(wxml, /ri-coin-line/)
  assert.match(wxml, /ri-heart-fill/)
  assert.match(wxml, /ri-heart-line/)
  assert.match(wxml, /ri-more-fill/)
  assert.doesNotMatch(wxml, />•••</)
  assert.match(wxml, /ri-mic-line/)
  assert.match(wxml, /ri-share-box-line/)
  assert.doesNotMatch(wxml, /ri-share-forward-line/)
  assert.match(wxml, /ri-flag-line/)
  assert.match(wxml, /ri-hand/)
  assert.match(toolbarActionsRule, /gap:\s*22rpx;/)
  assert.doesNotMatch(toolbarActionsRule, /column-gap|margin-(left|right):/)
  assert.match(toolButtonRule, /width:\s*64rpx;/)
  assert.match(toolButtonRule, /height:\s*64rpx;/)
  assert.doesNotMatch(iconButtonRule, /margin-(left|right):/)
  assert.match(actionIconRule, /width:\s*42rpx;/)
  assert.match(actionIconRule, /height:\s*42rpx;/)
  assert.match(actionIconRule, /font-size:\s*42rpx;/)
  assert.match(moreIconRule, /width:\s*42rpx;/)
  assert.match(moreIconRule, /height:\s*42rpx;/)
  assert.match(moreIconRule, /font-size:\s*42rpx;/)
  assert.doesNotMatch(moreIconRule, /margin-top:/)
  assert.match(loadingRule, /justify-content:\s*center;/)
  assert.match(loadingRule, /flex-direction:\s*column;/)
  assert.match(loadingRule, /text-align:\s*center;/)
  assert.match(loadingSpinnerRule, /border-top-color:\s*#c7432f;/)
  assert.match(loadingSpinnerRule, /animation:\s*loading-spin\s+0\.8s\s+linear\s+infinite;/)
  assert.doesNotMatch(wxss, /\.coin-action-icon/)
  assert.match(moreMenuCardRule, /right:\s*40rpx;/)
  assert.match(moreMenuCardRule, /background:\s*#ffffff;/)
  assert.match(moreMenuRowRule, /background:\s*#ffffff;/)
  assert.match(moreMenuRowRule, /border-radius:\s*0;/)
  assert.match(moreMenuShareButtonRule, /position:\s*absolute;/)
  assert.match(moreMenuShareButtonRule, /opacity:\s*0;/)
})

test('community detail starts with article body hidden behind loading state', () => {
  const page = freshCommunityDetailPage([], null)

  assert.equal(page.data.loading, true)
  assert.deepEqual(page.data.sections, [])
  assert.deepEqual(page.data.replies, [])
})

test('community detail opens custom more menu and routes actions', async () => {
  const page = freshCommunityDetailPage([], null)
  const calls = []
  const ctx = {
    data: {
      moreMenuOpen: false
    },
    setData(update) {
      Object.assign(this.data, update)
    },
    reply() { calls.push('reply') },
    report() { calls.push('report') },
    blockAuthor() { calls.push('blockAuthor') }
  }
  global.wx.showActionSheet = () => {
    throw new Error('custom menu should not use wx.showActionSheet')
  }

  page.showMoreActions.call(ctx)
  assert.equal(ctx.data.moreMenuOpen, true)

  await page.runMoreMenuAction.call(ctx, { currentTarget: { dataset: { action: 'reply' } } })
  await page.runMoreMenuAction.call(ctx, { currentTarget: { dataset: { action: 'report' } } })
  await page.runMoreMenuAction.call(ctx, { currentTarget: { dataset: { action: 'blockAuthor' } } })

  assert.deepEqual(calls, ['reply', 'report', 'blockAuthor'])
  assert.equal(ctx.data.moreMenuOpen, false)
})

test('community detail share action prepares Android web share URL', () => {
  const page = freshCommunityDetailPage([], null)
  const clipboard = []
  global.wx.setClipboardData = (options) => clipboard.push(options)
  const ctx = {
    data: {
      shareId: 'share-1',
      moreMenuOpen: true
    },
    setData(update) {
      Object.assign(this.data, update)
    }
  }

  page.shareLink.call(ctx)

  assert.deepEqual(clipboard, [{ data: 'https://jianshuo.dev/voicedrop/share-1' }])
  assert.equal(ctx.data.moreMenuOpen, false)
})

test('community detail reply action starts in-page voice response recording', () => {
  const page = freshCommunityDetailPage([], null)
  let started = false
  const ctx = {
    data: { shareId: 'share-1' },
    startReplyRecording() { started = true }
  }

  page.reply.call(ctx)

  assert.equal(started, true)
  assert.equal(getApp().globalData.pendingReplyTo, undefined)
})

test('community reply does not request microphone permission when audio consent is denied', async () => {
  const page = freshCommunityDetailPage([], null)
  let authorized = false
  let started = false
  global.wx.authorize = () => { authorized = true }
  const ctx = {
    data: { shareId: 'share-1', replyRecording: false, replyUploading: false },
    requestAudioConsent: async () => false,
    beginReplyRecording() { started = true }
  }

  await page.startReplyRecording.call(ctx)

  assert.equal(authorized, false)
  assert.equal(started, false)
})

test('community reply starts directly after audio consent without platform authorization', async () => {
  const page = freshCommunityDetailPage([], null)
  let started = ''
  let authorized = false
  global.wx.authorize = () => { authorized = true }
  const ctx = {
    data: { shareId: 'share-1', replyRecording: false, replyUploading: false },
    requestAudioConsent: async () => true,
    beginReplyRecording(shareId) { started = shareId }
  }

  await page.startReplyRecording.call(ctx)

  assert.equal(started, 'share-1')
  assert.equal(authorized, false)
})

test('community detail registers and renders the shared audio consent dialog', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.json'), 'utf8'))
  const js = fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.wxml'), 'utf8')

  assert.equal(config.usingComponents['audio-consent-dialog'], '/components/audio-consent-dialog/index')
  assert.doesNotMatch(js, /wx\.authorize/)
  assert.doesNotMatch(js, /需要录音权限/)
  assert.match(js, /const audioConsentFlow = require\('\.\.\/\.\.\/utils\/audio-consent-flow'\)/)
  assert.match(js, /audioConsentVisible:\s*false/)
  assert.match(js, /requestAudioConsent\(\)\s*\{\s*return audioConsentFlow\.request\(this\)/)
  assert.doesNotMatch(js, /audioConsentFlow\.markReady/)
  assert.match(js, /onUnload\(\)\s*\{\s*audioConsentFlow\.dispose\(this\)/)
  assert.doesNotMatch(js, /selectComponent\('#audio-consent-dialog'\)/)
  assert.match(wxml, /visible="\{\{audioConsentVisible\}\}"/)
  assert.doesNotMatch(wxml, /bind:ready=/)
  assert.match(wxml, /bind:agree="onAudioConsentAgree"/)
  assert.match(wxml, /bind:decline="onAudioConsentDecline"/)
  assert.match(wxml, /bind:viewagreement="onAudioConsentViewAgreement"/)
})

test('community detail saves uploaded reply recording for automatic community publish', async () => {
  const page = freshCommunityDetailPage([], null)
  const storage = {}
  const toasts = []
  global.wx.setStorageSync = (key, value) => { storage[key] = value }
  global.wx.showToast = (options) => toasts.push(options)
  const ctx = {
    data: {
      replyRecording: true,
      replyUploading: false
    },
    _replyToShareId: 'share-parent',
    _replyStartedAt: Date.now() - 1200,
    setData(update) {
      Object.assign(this.data, update)
    },
    clearReplyTimer() {},
    formatReplyTime: page.formatReplyTime
  }
  const audio = require('../services/audio')
  audio.uploadFile = async () => true
  audio.nameForSession = () => 'VoiceDrop-reply.m4a'

  await page.finishReplyRecording.call(ctx, { tempFilePath: '/tmp/reply.aac' })

  assert.equal(storage['vd.pendingReply.VoiceDrop-reply.m4a'], 'share-parent')
  assert.equal(ctx.data.replyRecording, false)
  assert.equal(ctx.data.replyUploading, false)
  assert.equal(toasts[0].title, '回应已保存，正在生成文章')
})

test('community detail tip action feeds article like Android', async () => {
  const page = freshCommunityDetailPage([
    {
      path: '/feed',
      method: 'POST',
      statusCode: 200,
      data: {
        ok: true,
        suanli: {
          feeder: 2,
          author: 3.5
        }
      }
    }
  ], null)
  const toasts = []
  const redirects = []
  global.wx.showToast = (options) => toasts.push(options)
  global.wx.redirectTo = ({ url }) => redirects.push(url)
  const ctx = {
    data: { shareId: 'share-1' }
  }

  await page.tip.call(ctx)

  const tipRequest = page.__requests.find((request) => request.url.endsWith('/feed'))
  assert.equal(tipRequest.method, 'POST')
  assert.deepEqual(tipRequest.data, { share_id: 'share-1' })
  assert.deepEqual(toasts, [{ title: '已投币：你 +2，作者 +3.5 算力' }])
  assert.deepEqual(redirects, [])
})

test('community detail tip action mirrors Android feed failure messages', async () => {
  const cases = [
    ['already', { ok: false, already: true }, '已经投过这篇了'],
    ['own', { ok: false, error: 'cannot_feed_own' }, '不能给自己的文章投币'],
    ['pool', { ok: false, error: 'pool_exhausted' }, '今日算力池已发完，明天再来'],
    ['signin', { ok: false, error: 'needs_wechat_signin' }, '投币需要先用微信登录'],
    ['other', { ok: false, error: 'unknown' }, '投币失败，稍后再试']
  ]

  for (const [name, data, expected] of cases) {
    const page = freshCommunityDetailPage([
      { path: '/feed', method: 'POST', statusCode: 200, data }
    ], null)
    const toasts = []
    global.wx.showToast = (options) => toasts.push(options)
    await page.tip.call({ data: { shareId: `share-${name}` } })
    assert.equal(toasts[0].title, expected)
  }
})

test('community detail report mirrors Android success and failure feedback', async () => {
  const page = freshCommunityDetailPage([
    { path: '/community/report/share-ok', method: 'POST', statusCode: 200, data: {} },
    { path: '/community/report/share-fail', method: 'POST', statusCode: 500, data: {} }
  ], null)
  const toasts = []
  const backs = []
  global.wx.showToast = (options) => toasts.push(options)
  global.wx.navigateBack = () => backs.push('back')
  global.wx.showModal = (options) => options.success({ confirm: true })
  const ctx = {
    data: { shareId: 'share-ok' }
  }

  await page.report.call(ctx)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(toasts.pop(), { title: '已举报，内容已下架待审核' })
  assert.deepEqual(backs, ['back'])

  ctx.data.shareId = 'share-fail'
  await page.report.call(ctx)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(toasts.pop(), { title: '举报失败', icon: 'error' })
})

test('community detail block stores author locally and leaves detail page like Android', () => {
  const page = freshCommunityDetailPage([], null)
  const toasts = []
  const backs = []
  global.wx.showToast = (options) => toasts.push(options)
  global.wx.navigateBack = () => backs.push('back')
  global.wx.showModal = (options) => options.success({ confirm: true })
  const ctx = {
    data: {
      post: { author: 'Alice' }
    }
  }

  page.blockAuthor.call(ctx)

  assert.deepEqual(global.wx.getStorageSync('vd.blockedAuthors'), ['Alice'])
  assert.deepEqual(toasts, [{ title: '已屏蔽，TA 的内容将不再显示' }])
  assert.deepEqual(backs, ['back'])
})
