const offline = require('../services/book-offline')

function decorate(items) {
  return items.map((item) => ({ ...item, downloadState: offline.downloadState(item.slug) }))
}

function observe(page, field) {
  if (page.bookDownloadUnsubscribe) return
  const refresh = (slug, progress) => {
    if (progress > 0) return
    let changed = false
    const items = (page.data[field] || []).map((item) => {
      if (slug && item.slug !== slug) return item
      const downloadState = offline.downloadState(item.slug)
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
