const DEFAULT_GAP_PX = 10
const FALLBACK_SAFE_RIGHT_PX = 105

function safeRightPx(systemInfo, menuRect, gapPx = DEFAULT_GAP_PX) {
  const windowWidth = Number(systemInfo && systemInfo.windowWidth)
  const menuLeft = Number(menuRect && menuRect.left)
  const gap = Number(gapPx)
  if (!Number.isFinite(windowWidth) || windowWidth <= 0 ||
      !Number.isFinite(menuLeft) || menuLeft < 0 || menuLeft > windowWidth ||
      !Number.isFinite(gap) || gap < 0) {
    return FALLBACK_SAFE_RIGHT_PX
  }
  return Math.ceil(windowWidth - menuLeft + gap)
}

module.exports = {
  DEFAULT_GAP_PX,
  FALLBACK_SAFE_RIGHT_PX,
  safeRightPx
}
