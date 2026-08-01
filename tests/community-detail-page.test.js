const test = require('node:test')
const assert = require('node:assert/strict')

function freshCommunityDetailPage(routes, currentCommunityPost, sharedStorage) {
  let page
  const storage = sharedStorage || {}
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
    getSetting: ({ success }) => success({ authSetting: { 'scope.record': true } }),
    authorize: ({ success }) => success(),
    showLoading: () => {},
    hideLoading: () => {},
    showToast: () => {},
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

test('community share card marks its route and returns to VD community', () => {
  const page = freshCommunityDetailPage([], null)
  const relaunches = []
  global.wx.reLaunch = ({ url }) => relaunches.push(url)
  const payload = page.onShareAppMessage.call({
    data: { shareId: 'share-1', post: { title: '社区文章' }, article: null }
  })

  page.goBack.call({ data: { replyRecording: false }, openedFromShare: true })

  assert.equal(payload.path, '/pages/community-detail/index?shareId=share-1&fromShare=1')
  assert.deepEqual(relaunches, ['/pages/recordings/index?tab=community'])
})

test('community detail root page returns to VD community when WeChat drops the share marker', () => {
  const page = freshCommunityDetailPage([], null)
  const relaunches = []
  let navigatedBack = false
  global.getCurrentPages = () => [{ route: 'pages/community-detail/index' }]
  global.wx.reLaunch = ({ url }) => relaunches.push(url)
  global.wx.navigateBack = () => { navigatedBack = true }

  page.goBack.call({ data: { replyRecording: false }, openedFromShare: false })

  assert.deepEqual(relaunches, ['/pages/recordings/index?tab=community'])
  assert.equal(navigatedBack, false)
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

test('community detail restores a persistent article snapshot before revalidation', async () => {
  const storage = {}
  const fullPost = {
    shareId: 'share-cache',
    title: '缓存标题',
    authorName: '作者',
    articles: [{ title: '缓存标题', body: '缓存正文' }],
    photos: []
  }
  const firstPage = freshCommunityDetailPage([{
    path: '/community/get/share-cache',
    data: { post: fullPost }
  }], {
    shareId: 'share-cache',
    title: '列表标题'
  }, storage)
  const first = {
    data: {
      shareId: 'share-cache',
      post: { shareId: 'share-cache', title: '列表标题' },
      sections: [],
      replies: []
    },
    setData(update) { Object.assign(this.data, update) },
    articleSections: firstPage.articleSections,
    loadFullReplies: async () => []
  }
  await firstPage.load.call(first)
  assert.equal(first.data.article.title, '缓存标题')

  const secondPage = freshCommunityDetailPage([], {
    shareId: 'share-cache',
    title: '列表标题'
  }, storage)
  const updates = []
  const second = {
    data: {
      shareId: 'share-cache',
      post: { shareId: 'share-cache', title: '列表标题' },
      sections: [],
      replies: [],
      loading: true
    },
    setData(update) {
      updates.push(update)
      Object.assign(this.data, update)
    },
    articleSections: secondPage.articleSections,
    loadFullReplies: async () => []
  }

  const loading = secondPage.load.call(second)
  assert.equal(second.data.loading, false)
  assert.equal(second.data.article.title, '缓存标题')
  assert.equal(second.data.sections[0].blocks[0].text, '缓存正文')
  assert.equal(updates.some((update) => update.loading === true), false)
  await loading
})

test('community detail reveals the main article before replies finish loading', async () => {
  const page = freshCommunityDetailPage([{
    path: '/community/get/share-progressive',
    data: {
      post: {
        shareId: 'share-progressive',
        title: '先显示正文',
        articles: [{ title: '先显示正文', body: '正文不等回应' }],
        photos: []
      }
    }
  }], {
    shareId: 'share-progressive',
    title: '列表标题'
  })
  let finishReplies
  const replies = new Promise((resolve) => { finishReplies = resolve })
  const ctx = {
    data: {
      shareId: 'share-progressive',
      post: { shareId: 'share-progressive', title: '列表标题' },
      sections: [],
      replies: [],
      loading: true
    },
    setData(update) { Object.assign(this.data, update) },
    articleSections: page.articleSections,
    loadFullReplies: () => replies
  }

  const loading = page.load.call(ctx)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(ctx.data.loading, false)
  assert.equal(ctx.data.article.title, '先显示正文')
  assert.equal(ctx.data.sections[0].blocks[0].text, '正文不等回应')

  finishReplies([])
  await loading
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
  const moreButtonRule = wxss.match(/\.toolbar-actions \.tool-button\.more-button\s*\{([^}]*)\}/)[1]
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
  assert.match(wxml, /<view class="loading-card" wx:if="\{\{loading\}\}">\s*<view class="loading-spinner" aria-hidden="true"><\/view>\s*<text>加载中\.\.\.<\/text>\s*<\/view>/)
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
  assert.match(wxml, /class="tool-button more-button/)
  assert.match(wxml, /ri-more-fill/)
  assert.doesNotMatch(wxml, />•••</)
  assert.match(wxml, /ri-mic-line/)
  assert.match(wxml, /ri-share-box-line/)
  assert.doesNotMatch(wxml, /ri-share-forward-line/)
  assert.match(wxml, /ri-flag-line/)
  assert.match(wxml, /ri-hand/)
  assert.match(toolbarActionsRule, /gap:\s*0;/)
  assert.doesNotMatch(toolbarActionsRule, /column-gap|margin-(left|right):/)
  assert.match(toolButtonRule, /width:\s*72rpx;/)
  assert.match(toolButtonRule, /height:\s*72rpx;/)
  assert.doesNotMatch(iconButtonRule, /margin-(left|right):/)
  assert.match(moreButtonRule, /margin-left:\s*11px;/)
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
  assert.match(moreMenuCardRule, /right:\s*32rpx;/)
  assert.match(moreMenuCardRule, /background:\s*#ffffff;/)
  assert.match(moreMenuRowRule, /background:\s*#ffffff;/)
  assert.match(moreMenuRowRule, /border-radius:\s*0;/)
  assert.match(moreMenuShareButtonRule, /position:\s*absolute;/)
  assert.match(moreMenuShareButtonRule, /opacity:\s*0;/)
})

test('community article detail shares the list gutter and audio-detail reading rhythm', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.wxss'), 'utf8')

  assert.match(wxml, /padding-top: calc\(\{\{toolbarTop \+ toolbarHeight\}\}px \+ 54rpx\)/)
  assert.doesNotMatch(wxml, /padding-top: 115px/)
  assert.match(wxss, /\.community-detail-screen\s*\{[^}]*padding:\s*0 32rpx 72rpx;/s)
  assert.match(wxss, /\.detail-toolbar\s*\{[^}]*padding:\s*0 15rpx 0 32rpx;/s)
  assert.match(wxss, /\.article-head\s*\{[^}]*padding:\s*0 0 44rpx;/s)
  assert.match(wxss, /\.article,\s*\.empty\s*\{[^}]*padding:\s*0;/s)
  assert.match(wxss, /\.article-title\s*\{[^}]*font-size:\s*48rpx;[^}]*font-weight:\s*800;[^}]*line-height:\s*1\.28;/s)
  assert.match(wxml, /class="article-meta"/)
  assert.match(wxml, /class="article-author">\{\{post\.author \|\| post\.authorName \|\| '匿名作者'\}\}<\/text>/)
  assert.match(wxml, /class="article-date" wx:if="\{\{post\.dateLabel\}\}">\{\{post\.dateLabel\}\}<\/text>/)
  assert.doesNotMatch(wxml, /社区分享/)
  assert.match(wxss, /\.article-meta\s*\{[^}]*margin-top:\s*16rpx;[^}]*gap:\s*16rpx;[^}]*font-size:\s*26rpx;[^}]*line-height:\s*1\.4;/s)
  assert.match(wxss, /\.article-author\s*\{[^}]*color:\s*#d8593b;[^}]*font-weight:\s*600;/s)
  assert.match(wxss, /\.article-date\s*\{[^}]*color:\s*#9a9387;[^}]*font-weight:\s*400;/s)
  assert.match(wxss, /\.meta\s*\{[^}]*color:\s*#817b72;[^}]*font-size:\s*28rpx;[^}]*line-height:\s*1\.4;/s)
  assert.match(wxss, /\.paragraph\s*\{[^}]*font-size:\s*35rpx;[^}]*line-height:\s*1\.72;/s)
  assert.match(wxss, /\.article-image\s*\{[^}]*border-radius:\s*20rpx;/s)
  assert.match(wxss, /\.community-photo\s*\{[^}]*border-radius:\s*20rpx;/s)
  assert.match(wxss, /\.prompt-detail-content\s*\{[^}]*padding:\s*0 0 calc\(36rpx \+ env\(safe-area-inset-bottom\)\);/s)
  assert.match(wxss, /\.reply-recording-dock\s*\{[^}]*padding:\s*24rpx 32rpx calc\(30rpx \+ env\(safe-area-inset-bottom\)\);/s)
})

test('community detail starts with article body hidden behind loading state', () => {
  const page = freshCommunityDetailPage([], null)

  assert.equal(page.data.loading, true)
  assert.deepEqual(page.data.sections, [])
  assert.deepEqual(page.data.replies, [])
  assert.equal(page.data.promptImported, false)
  assert.equal(page.data.promptImporting, false)
})

test('community article images keep a loading placeholder until the matching image loads', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.wxss'), 'utf8')
  const page = freshCommunityDetailPage([], null)
  const sections = page.articleSections.call({ data: { sections: [] } }, {
    title: '社区文章'
  }, {
    owner: 'users/anon/',
    articles: [{ title: '社区文章', body: '正文\n[[photo:photos/a.jpg]]' }],
    photos: []
  })
  const photo = sections[0].blocks.find((block) => block.type === 'photo')
  const blockIndex = sections[0].blocks.indexOf(photo)
  const ctx = Object.assign({}, page, {
    data: { sections },
    setData(update) { Object.assign(this.data, update) }
  })

  assert.equal(photo.photoState, 'loading')
  assert.equal(photo.loaded, false)
  assert.match(wxml, /bindload="onCommunityImageLoad"/)
  assert.match(wxml, /binderror="onCommunityImageError"/)
  assert.match(wxml, /community-photo-loading/)
  assert.match(wxml, /photo-loading-spinner/)
  assert.match(wxss, /\.community-photo-image\.preloading\s*\{[^}]*position:\s*absolute;[^}]*opacity:\s*0;/s)

  page.onCommunityImageLoad.call(ctx, {
    currentTarget: {
      dataset: {
        sectionIndex: 0,
        blockIndex,
        key: photo.key,
        url: photo.url
      }
    },
    detail: { width: 640, height: 480 }
  })

  assert.equal(ctx.data.sections[0].blocks[blockIndex].photoState, 'loaded')
  assert.equal(ctx.data.sections[0].blocks[blockIndex].loaded, true)
})

test('community article downloads photos through the persistent scoped cache', async () => {
  const page = freshCommunityDetailPage([], null)
  const library = require('../services/library')
  const originalDownloadPhotoTemp = library.downloadPhotoTemp
  const downloads = []
  library.downloadPhotoTemp = async (key, scope) => {
    downloads.push({ key, scope })
    return 'wxfile://cached-community-photo.jpg'
  }
  try {
    const sections = page.articleSections.call({ data: { sections: [] } }, {
      title: '社区文章'
    }, {
      owner: 'users/anon-owner/',
      articles: [{ title: '社区文章', body: '正文\n[[photo:photos/a.jpg]]' }],
      photos: []
    })
    const ctx = Object.assign({}, page, {
      data: { sections, blocks: sections[0].blocks },
      setData(update) { Object.assign(this.data, update) },
      communityPhotoLoadSeq: 0,
      communityPhotoCache: {}
    })

    page.loadCommunityPhotos.call(ctx, sections, 'users/anon-owner/')
    await new Promise((resolve) => setImmediate(resolve))

    assert.deepEqual(downloads, [{
      key: 'photos/a.jpg',
      scope: 'users/anon-owner/'
    }])
    const photo = ctx.data.sections[0].blocks.find((block) => block.type === 'photo')
    assert.equal(photo.url, 'wxfile://cached-community-photo.jpg')
    assert.equal(photo.photoState, 'loading')
    assert.equal(ctx.data.blocks, ctx.data.sections[0].blocks)
  } finally {
    library.downloadPhotoTemp = originalDownloadPhotoTemp
  }
})

test('community detail starts scoped photo caching after rendering a fetched article', async () => {
  const page = freshCommunityDetailPage([{
    path: '/community/get/share-photo',
    data: {
      post: {
        shareId: 'share-photo',
        title: '带图文章',
        owner: 'users/anon-owner/',
        articles: [{
          title: '带图文章',
          body: '正文\n[[photo:photos/a.jpg]]'
        }],
        photos: []
      }
    }
  }], {
    shareId: 'share-photo',
    title: '带图文章'
  })
  const loads = []
  const ctx = {
    data: {
      shareId: 'share-photo',
      post: { shareId: 'share-photo', title: '带图文章' },
      sections: [],
      replies: [],
      loading: true
    },
    setData(update) { Object.assign(this.data, update) },
    articleSections: page.articleSections,
    loadCommunityPhotos(sections, scope) { loads.push({ sections, scope }) },
    loadFullReplies: async () => []
  }

  await page.load.call(ctx)

  assert.equal(loads.length, 1)
  assert.equal(loads[0].scope, 'users/anon-owner/')
  assert.equal(loads[0].sections[0].blocks[1].key, 'photos/a.jpg')
})

test('community article ignores cached photo results from a stale document', async () => {
  const page = freshCommunityDetailPage([], null)
  const library = require('../services/library')
  const originalDownloadPhotoTemp = library.downloadPhotoTemp
  const pending = {}
  library.downloadPhotoTemp = (key) => new Promise((resolve) => {
    pending[key] = resolve
  })
  try {
    const firstSections = page.articleSections.call({ data: { sections: [] } }, {
      title: '旧文章'
    }, {
      owner: 'users/anon-owner/',
      articles: [{ title: '旧文章', body: '[[photo:photos/old.jpg]]' }],
      photos: []
    })
    const ctx = Object.assign({}, page, {
      data: { sections: firstSections, blocks: firstSections[0].blocks },
      setData(update) { Object.assign(this.data, update) },
      communityPhotoLoadSeq: 0,
      communityPhotoCache: {}
    })
    page.loadCommunityPhotos.call(ctx, firstSections, 'users/anon-owner/')

    const secondSections = page.articleSections.call({ data: { sections: [] } }, {
      title: '新文章'
    }, {
      owner: 'users/anon-owner/',
      articles: [{ title: '新文章', body: '[[photo:photos/new.jpg]]' }],
      photos: []
    })
    ctx.data.sections = secondSections
    ctx.data.blocks = secondSections[0].blocks
    page.loadCommunityPhotos.call(ctx, secondSections, 'users/anon-owner/')

    pending['photos/old.jpg']('wxfile://stale.jpg')
    pending['photos/new.jpg']('wxfile://fresh.jpg')
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(ctx.data.sections[0].blocks[0].key, 'photos/new.jpg')
    assert.equal(ctx.data.sections[0].blocks[0].url, 'wxfile://fresh.jpg')
  } finally {
    library.downloadPhotoTemp = originalDownloadPhotoTemp
  }
})

test('community article ignores stale image events and exposes a terminal load failure', () => {
  const page = freshCommunityDetailPage([], null)
  const photo = {
    type: 'photo',
    key: 'photos/new.jpg',
    url: 'https://example.com/new.jpg',
    photoState: 'loading',
    loaded: false,
    failed: false
  }
  const ctx = Object.assign({}, page, {
    data: { sections: [{ title: '', blocks: [photo] }] },
    setData(update) { Object.assign(this.data, update) }
  })

  page.onCommunityImageLoad.call(ctx, {
    currentTarget: {
      dataset: {
        sectionIndex: 0,
        blockIndex: 0,
        key: 'photos/old.jpg',
        url: 'https://example.com/old.jpg'
      }
    }
  })
  assert.equal(ctx.data.sections[0].blocks[0].photoState, 'loading')

  page.onCommunityImageError.call(ctx, {
    currentTarget: {
      dataset: {
        sectionIndex: 0,
        blockIndex: 0,
        key: photo.key,
        url: photo.url
      }
    }
  })
  assert.equal(ctx.data.sections[0].blocks[0].photoState, 'loadFailed')
  assert.equal(ctx.data.sections[0].blocks[0].failed, true)
})

test('community prompt detail uses its own iOS-aligned layout without replacing ordinary article markup', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.wxss'), 'utf8')

  assert.match(wxml, /class="prompt-detail-content" wx:if="\{\{post\.isPrompt\}\}"/)
  assert.match(wxml, /一条 VoiceDrop 提示词 · 分享码/)
  assert.match(wxml, /用 \{\{post\.promptCode\}\} 改这段/)
  assert.match(wxml, /收下这条提示词/)
  assert.match(wxml, /promptImported \? '已收下'/)
  assert.match(wxml, /<view\s+class="prompt-collect-button/)
  assert.doesNotMatch(wxml, /<button\s+class="prompt-collect-button/)
  assert.doesNotMatch(wxml, /loading="\{\{promptImporting\}\}"/)
  assert.match(wxml, /ri-loader-4-line is-spinning/)
  assert.match(wxml, /<block wx:else>[\s\S]*class="article card"/)
  assert.match(wxml, /class="more-menu-row" data-action="reply"/)
  assert.doesNotMatch(wxml, /prompt-detail-badge|prompt-collect-card/)
  assert.match(wxss, /\.prompt-share-code\s*\{[\s\S]*letter-spacing:\s*16rpx;/)
  assert.match(wxss, /\.prompt-body-panel\s*\{[\s\S]*background:\s*#f0ede7;/)
  assert.match(wxss, /\.prompt-more-button\s*\{[\s\S]*background:\s*#282520;/)
  assert.match(wxss, /\.prompt-collect-label\s*\{[\s\S]*white-space:\s*nowrap;/)
})

test('community prompt collect mirrors iOS imported state and disables repeat imports', async () => {
  const page = freshCommunityDetailPage([], null)
  const promptStore = require('../services/prompt-store')
  const toasts = []
  let imports = 0
  promptStore.importCode = async () => {
    imports += 1
    return { ok: true, already: false }
  }
  global.wx.showToast = (options) => toasts.push(options)
  const ctx = {
    data: {
      post: { isPrompt: true, promptCode: '3295225' },
      promptImported: false,
      promptImporting: false
    },
    setData(update) { Object.assign(this.data, update) }
  }

  await page.collectPrompt.call(ctx)
  await page.collectPrompt.call(ctx)

  assert.equal(imports, 1)
  assert.equal(ctx.data.promptImported, true)
  assert.equal(ctx.data.promptImporting, false)
  assert.equal(toasts[0].title, '已加入你的提示词')
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

  assert.deepEqual(clipboard, [{ data: 'https://voicedrop.cn/share-1' }])
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

test('community reply requests platform permission after audio consent', async () => {
  const page = freshCommunityDetailPage([], null)
  let started = ''
  let authorized = false
  global.wx.getSetting = ({ success }) => success({ authSetting: {} })
  global.wx.authorize = ({ scope, success }) => { authorized = scope === 'scope.record'; success() }
  const ctx = {
    data: { shareId: 'share-1', replyRecording: false, replyUploading: false },
    requestAudioConsent: async () => true,
    beginReplyRecording(shareId) { started = shareId }
  }

  await page.startReplyRecording.call(ctx)

  assert.equal(started, 'share-1')
  assert.equal(authorized, true)
})

test('community detail registers and renders the shared audio consent dialog', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.json'), 'utf8'))
  const js = fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.wxml'), 'utf8')

  assert.equal(config.usingComponents['audio-consent-dialog'], '/components/audio-consent-dialog/index')
  assert.match(js, /const audioConsentFlow = require\('\.\.\/\.\.\/utils\/audio-consent-flow'\)/)
  assert.match(js, /const recordPermission = require\('\.\.\/\.\.\/utils\/record-permission'\)/)
  assert.match(js, /startReplyRecording\(\)[\s\S]*requestAudioConsent\(\)[\s\S]*recordPermission\.ensure\(wx\)[\s\S]*beginReplyRecording/)
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
    _replyStartedAt: Date.now() - 5000,
    setData(update) {
      Object.assign(this.data, update)
    },
    clearReplyTimer() {},
    formatReplyTime: page.formatReplyTime
  }
  const audio = require('../services/audio')
  audio.uploadFile = async () => true
  audio.nameForSession = () => 'VoiceDrop-reply.m4a'

  await page.finishReplyRecording.call(ctx, { tempFilePath: '/tmp/reply.aac', duration: 5000 })

  assert.equal(storage['vd.pendingReply.VoiceDrop-reply.m4a'], 'share-parent')
  assert.equal(ctx.data.replyRecording, false)
  assert.equal(ctx.data.replyUploading, false)
  assert.equal(toasts[0].title, '回应已保存，正在生成文章')
})

test('community detail discards and explains a reply shorter than four seconds', async () => {
  const page = freshCommunityDetailPage([], null)
  const toasts = []
  const discarded = []
  global.wx.showToast = (options) => toasts.push(options)
  const ctx = {
    data: {
      replyRecording: true,
      replyUploading: false
    },
    _replyToShareId: 'share-parent',
    _replyStartedAt: Date.now() - 3999,
    setData(update) {
      Object.assign(this.data, update)
    },
    clearReplyTimer() {}
  }
  const audio = require('../services/audio')
  audio.discardFile = async (filePath) => { discarded.push(filePath); return true }
  audio.uploadFile = async () => assert.fail('short recording must not upload')

  await page.finishReplyRecording.call(ctx, { tempFilePath: '/tmp/short-reply.aac', duration: 3999 })

  assert.deepEqual(discarded, ['/tmp/short-reply.aac'])
  assert.equal(ctx.data.replyRecording, false)
  assert.equal(ctx.data.replyUploading, false)
  assert.equal(toasts[0].title, '时间太短，不足以产生文章')
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
    data: { shareId: 'share-1', fed: false, feeding: false },
    setData(update) { Object.assign(this.data, update) }
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
    const ctx = {
      data: { shareId: `share-${name}`, fed: false, feeding: false },
      setData(update) { Object.assign(this.data, update) }
    }
    await page.tip.call(ctx)
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
