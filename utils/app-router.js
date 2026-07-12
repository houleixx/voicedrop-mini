function none() {
  return { kind: 'none', stem: '', tag: '' }
}

function parse(raw) {
  if (!raw || !String(raw).trim()) return none()
  try {
    const url = new URL(raw)
    if (url.protocol !== 'voicedrop:') return none()
    const route = url.hostname || ''
    const first = url.pathname && url.pathname.length > 1 ? decodeURIComponent(url.pathname.split('/')[1] || '') : ''
    const tag = (url.searchParams.get('tag') || '').trim()
    if (route === 'recordings' || route === '') return { kind: 'recordings', stem: '', tag: '' }
    if (route === 'community') return { kind: 'community', stem: '', tag: '' }
    if (route === 'settings') return { kind: 'settings', stem: '', tag: '' }
    if (route === 'record') return { kind: 'record', stem: '', tag }
    if (route === 'article' && first) return { kind: 'article', stem: first, tag: '' }
    return none()
  } catch (error) {
    return none()
  }
}

function parseQuery(query) {
  if (!query) return none()
  if (query.deeplink) return parse(decodeURIComponent(query.deeplink))
  if (query.tab === 'community') return { kind: 'community', stem: '', tag: '' }
  if (query.tab === 'recordings') return { kind: 'recordings', stem: '', tag: '' }
  if (query.route === 'community') return { kind: 'community', stem: '', tag: '' }
  if (query.route === 'settings') return { kind: 'settings', stem: '', tag: '' }
  if (query.route === 'record') return { kind: 'record', stem: '', tag: query.tag || '' }
  if (query.stem) return { kind: 'article', stem: query.stem, tag: '' }
  if (query.shareId) return { kind: 'community-detail', stem: query.shareId, tag: '' }
  return none()
}

function routeFor(deepLink) {
  const link = deepLink || none()
  if (link.kind === 'recordings') return { type: 'reLaunch', url: '/pages/recordings/index', tab: 'recordings' }
  if (link.kind === 'community') return { type: 'reLaunch', url: '/pages/recordings/index?tab=community', tab: 'community' }
  if (link.kind === 'settings') return { type: 'navigateTo', url: '/pages/settings/index' }
  if (link.kind === 'record') return { type: 'reLaunch', url: '/pages/recordings/index', tab: 'recordings', tag: link.tag || '' }
  if (link.kind === 'article') return { type: 'navigateTo', url: `/pages/detail/index?stem=${encodeURIComponent(link.stem)}` }
  if (link.kind === 'community-detail') return { type: 'navigateTo', url: `/pages/community-detail/index?shareId=${encodeURIComponent(link.stem)}` }
  return null
}

module.exports = {
  parse,
  parseQuery,
  routeFor
}
