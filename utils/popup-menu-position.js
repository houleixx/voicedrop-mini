function rightAlignedXOffset(anchorWidth, menuWidth) {
  return Number(anchorWidth || 0) - Number(menuWidth || 0)
}

function upwardYOffset(menuHeight) {
  return -Number(menuHeight || 0)
}

module.exports = {
  rightAlignedXOffset,
  upwardYOffset
}
