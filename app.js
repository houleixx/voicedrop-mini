const router = require('./utils/app-router')
const prefs = require('./utils/prefs')
const auth = require('./services/auth')
const promptTree = require('./utils/prompt-tree')

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

App({
  globalData: {
    appName: 'VoiceDrop Mini',
    currentRecording: null,
    currentCommunityPost: null,
    pendingPhotoInsert: null,
    pendingReplyTo: null,
    pendingRecordTag: '',
    pendingHomeTab: ''
  },

  onLaunch(options) {
    console.log('VoiceDrop Mini launched')
    this.handleImportToken(options)
    if (wx.showShareMenu) {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] })
    }
    this.handleRouteOptions(options)
  },

  onShow(options) {
    this.handleImportToken(options)
    this.handleRouteOptions(options)
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
    const route = router.routeFor(router.parseQuery(options && options.query))
    if (!route) return
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
