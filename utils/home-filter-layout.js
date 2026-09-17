// Community and books share an 88rpx toolbar below the measured home header.
function layoutOffsets(headerBottom, windowWidth) {
  const pxPerRpx = Math.max(1, Number(windowWidth) || 375) / 750
  const scrollContentTop = Math.max(0, Number(headerBottom) || 0)
  return { scrollContentTop, filteredScrollContentTop: scrollContentTop + 88 * pxPerRpx }
}

function windowInfo() {
  if (typeof wx === 'undefined') return {}
  try { if (wx.getWindowInfo) return wx.getWindowInfo() } catch (_) {}
  try { if (wx.getSystemInfoSync) return wx.getSystemInfoSync() } catch (_) {}
  return {}
}

function initialOffsets() {
  const info = windowInfo()
  const width = Number(info.windowWidth) || 375
  const statusBar = Number.isFinite(info.statusBarHeight) ? info.statusBarHeight : 20
  return layoutOffsets(statusBar + 200 * width / 750, width)
}

function measure(page) {
  if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return
  const inactive = () => page._pageUnloaded || page._shelfActive === false
  const run = () => {
    if (inactive()) return
    const query = wx.createSelectorQuery()
    // Scope delayed measurement to the page that requested it.
    const scoped = typeof query.in === 'function' ? query.in(page) : query
    scoped.select('#home-tabs').boundingClientRect((rect) => {
      if (inactive() || !rect || !Number.isFinite(rect.bottom) || rect.bottom <= 0) return
      const width = windowInfo().windowWidth || 375
      const offsets = layoutOffsets(rect.bottom, width)
      if (Object.keys(offsets).every((key) => Math.abs(offsets[key] - page.data[key]) < 0.5)) return
      page.setData(offsets)
    }).exec()
  }
  if (typeof wx.nextTick === 'function') wx.nextTick(run)
  else setTimeout(run, 0)
}

module.exports = { layoutOffsets, initialOffsets, measure }
