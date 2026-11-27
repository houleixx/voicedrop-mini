const offline = require('../services/book-offline')

function decorate(items) {
  const states = offline.downloadStates(items.map((item) => item.slug))
  return items.map((item, index) => ({ ...item, downloadState: states[index] }))
}

function observe(page, field) {
  if (page.bookDownloadUnsubscribe) return
  const refresh = (slug, progress) => {
    if (progress > 0) return
    let changed = false
    const current = page.data[field] || []
    const states = slug ? null : offline.downloadStates(current.map((item) => item.slug))
    const items = current.map((item, index) => {
      if (slug && item.slug !== slug) return item
      const downloadState = states ? states[index] : offline.downloadState(item.slug)
      if (downloadState === (item.downloadState || '')) return item
      changed = true
      return { ...item, downloadState }
    })
    if (changed) {
      page.setData({ [field]: items })
      page.refreshBookSearch()
    }
  }
  page.bookDownloadUnsubscribe = offline.subscribeDownloads(refresh)
  refresh()
}

function disconnect(page) {
  if (page.bookDownloadUnsubscribe) page.bookDownloadUnsubscribe()
  page.bookDownloadUnsubscribe = null
}

module.exports = { decorate, observe, disconnect }
