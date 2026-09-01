const router = require('./utils/app-router')
const prefs = require('./utils/prefs')
const auth = require('./services/auth')
const promptTree = require('./utils/prompt-tree')
const referral = require('./services/referral')
const apiRoute = require('./services/api-route')
const i18n = require('./utils/i18n')

// Every page/component receives locale copy through data, so WXML can remain
// declarative.  Wrapping registration also refreshes a visible page when the
// choice is applied; the language screen then relaunches the home shell to
// recreate native navigation titles and shared components consistently.
function installI18nRegistrationWrappers() {
  if (typeof Page === 'function' && !Page.__voiceDropI18nWrapped) {
    const registerPage = Page
    const feedbackDataKeys = new Set(['error', 'importError', 'shareError', 'denied', 'booksError', 'dockHint', 'commandReply', 'accountSubtitle', 'cacheSizeText', 'holdEditTranscriptText', 'holdEditButtonText', 'loginStatusText', 'marketError'])
    function localizeFeedbackData(data) {
      if (!data || typeof data !== 'object') return data
      const localized = Object.assign({}, data)
      Object.keys(localized).forEach((key) => {
        if (feedbackDataKeys.has(key) && typeof localized[key] === 'string') localized[key] = i18n.message(localized[key])
      })
      if (Array.isArray(localized.marketFilters)) {
        localized.marketFilters = localized.marketFilters.map((filter) => Object.assign({}, filter, { label: i18n.ui(filter.label) }))
      }
      return localized
    }
    function wrapPageSetData(instance) {
      if (!instance || instance.__voiceDropI18nSetData || typeof instance.setData !== 'function') return
      const setData = instance.setData
      instance.setData = function localizedSetData(data, callback) {
        return setData.call(this, localizeFeedbackData(data), callback)
      }
      instance.__voiceDropI18nSetData = true
    }
    const wrappedPage = function registerLocalizedPage(definition) {
      const onLoad = definition.onLoad
      const onShow = definition.onShow
      const onLanguageChanged = definition.onLanguageChanged
      return registerPage(Object.assign({}, definition, {
        data: localizeFeedbackData(Object.assign({ i18n: i18n.copy(), languageRevision: 0 }, definition.data || {})),
        onLoad(...args) {
          wrapPageSetData(this)
          if (typeof this.setData === 'function') this.setData({ i18n: i18n.copy() })
          return typeof onLoad === 'function' ? onLoad.apply(this, args) : undefined
        },
        onShow(...args) {
          wrapPageSetData(this)
          if (typeof this.setData === 'function') this.setData({ i18n: i18n.copy() })
          return typeof onShow === 'function' ? onShow.apply(this, args) : undefined
        },
        onLanguageChanged(language) {
          if (typeof this.setData === 'function') {
            const app = typeof getApp === 'function' ? getApp() : null
            const languageRevision = Number(app && app.globalData && app.globalData.languageRevision || 0)
            this.setData({ i18n: i18n.copy(language), languageRevision })
          }
          return typeof onLanguageChanged === 'function' ? onLanguageChanged.call(this, language) : undefined
        }
      }))
    }
    wrappedPage.__voiceDropI18nWrapped = true
    Page = wrappedPage
  }
  if (typeof Component === 'function' && !Component.__voiceDropI18nWrapped) {
    const registerComponent = Component
    const wrappedComponent = function registerLocalizedComponent(definition) {
      return registerComponent(Object.assign({}, definition, {
        data: Object.assign({ i18n: i18n.copy() }, definition.data || {})
      }))
    }
    wrappedComponent.__voiceDropI18nWrapped = true
    Component = wrappedComponent
  }
}

installI18nRegistrationWrappers()

// Native feedback is invoked throughout the established feature code.  Route
// its display-only fields through the same dictionary so changing language
// updates toasts, loading labels, dialogs, and native navigation titles too.
function installI18nWxFeedbackWrapper() {
  if (typeof wx === 'undefined' || wx.__voiceDropI18nWrapped) return
  ;['showToast', 'showLoading', 'showModal', 'setNavigationBarTitle'].forEach((name) => {
    if (typeof wx[name] !== 'function') return
    const original = wx[name]
    wx[name] = function localizedFeedback(options) {
      if (!options || typeof options !== 'object') return original.apply(this, arguments)
      const next = Object.assign({}, options)
      ;['title', 'content', 'confirmText', 'cancelText'].forEach((field) => {
        if (typeof next[field] === 'string') next[field] = i18n.message(next[field])
      })
      return original.call(this, next)
    }
  })
  wx.__voiceDropI18nWrapped = true
}

installI18nWxFeedbackWrapper()

function currentPageMatchesRoute(route) {
  if (!route || route.type !== 'navigateTo' || typeof getCurrentPages !== 'function') return false
  const pages = getCurrentPages()
  const current = pages && pages.length ? pages[pages.length - 1] : null
  if (!current) return false
  const parts = String(route.url || '').split('?')
  const targetPath = parts[0].replace(/^\//, '')
  if (current.route !== targetPath) return false
  if (!parts[1]) return true
  const options = current.options || {}
  return parts[1].split('&').every((entry) => {
    const separator = entry.indexOf('=')
    const rawKey = separator >= 0 ? entry.slice(0, separator) : entry
    const rawValue = separator >= 0 ? entry.slice(separator + 1) : ''
    const key = decodeURIComponent(rawKey)
    const value = decodeURIComponent(rawValue)
    return String(options[key] == null ? '' : options[key]) === value
  })
}

function isChatShareScene(scene) {
  return [1007, 1008, 1044].includes(Number(scene))
}

function isPublicSharedArticleLaunch(options) {
  const path = String(options && options.path || '').replace(/^\/+/, '')
  return path === 'pages/shared-article/index'
}

App({
  globalData: {
    appName: 'VoiceDrop Mini',
    currentRecording: null,
    currentCommunityPost: null,
    pendingPhotoInsert: null,
    pendingReplyTo: null,
    pendingRecordTag: '',
    pendingHomeTab: '',
    language: i18n.currentLanguage(),
    languageRevision: 0
  },

  onLaunch(options) {
    console.log('VoiceDrop Mini launched')
    this.handleImportToken(options)
    this.handleReferral(options)
    if (wx.showShareMenu) {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] })
    }
    this.handleRouteOptions(options)
    apiRoute.probe().catch(() => {})
  },

  onShow(options) {
    this.globalData.language = i18n.currentLanguage()
    this.handleImportToken(options)
    this.handleReferral(options)
    this.handleRouteOptions(options)
    apiRoute.probeIfDue().catch(() => {})
  },

  handleReferral(options) {
    const code = referral.codeFromLaunch(options)
    if (code) referral.claim(code).catch(() => {})
  },

  handleImportToken(options) {
    const token = options && options.query && options.query.importToken
    if (!token) return
    const value = decodeURIComponent(token)
    if (auth.adoptToken(value)) {
      wx.showToast({ title: 'Token 已导入' })
    }
  },

  handleRouteOptions(options) {
    // This page owns its public shareId. Do not reinterpret it as a VD community shareId.
    if (isPublicSharedArticleLaunch(options)) return
    const promptCode = promptTree.extractShareCode(options && options.query && options.query.promptCode)
    if (promptCode) {
      const url = `/pages/prompt-import/index?promptCode=${promptCode}`
      const route = { type: 'navigateTo', url }
      if (currentPageMatchesRoute(route) || this.globalData.pendingRouteUrl === url) return
      this.globalData.pendingRouteUrl = url
      setTimeout(() => {
        try { if (!currentPageMatchesRoute(route)) wx.navigateTo({ url }) }
        finally { if (this.globalData.pendingRouteUrl === url) this.globalData.pendingRouteUrl = '' }
      }, 0)
      return
    }
    const deepLink = router.parseQuery(options && options.query)
    const route = router.routeFor(deepLink)
    if (!route) return
    if (deepLink.kind === 'article' && isChatShareScene(options && options.scene)) {
      this.globalData.sharedArticleStem = deepLink.stem
    }
    if (route.tag) this.globalData.pendingRecordTag = route.tag
    if (route.tab) this.globalData.pendingHomeTab = route.tab
    if (currentPageMatchesRoute(route)) return
    if (route.type === 'navigateTo' && this.globalData.pendingRouteUrl === route.url) return
    if (route.type === 'navigateTo') this.globalData.pendingRouteUrl = route.url
    setTimeout(() => {
      try {
        if (currentPageMatchesRoute(route)) return
        if (route.type === 'reLaunch') wx.reLaunch({ url: route.url })
        else if (route.type === 'redirectTo') wx.redirectTo({ url: route.url })
        else wx.navigateTo({ url: route.url })
      } finally {
        if (this.globalData.pendingRouteUrl === route.url) this.globalData.pendingRouteUrl = ''
      }
    }, 0)
  }
})
