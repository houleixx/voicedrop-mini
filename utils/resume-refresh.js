function shouldRedrawOnResume(detailPage, topLevelUiRendered) {
  return !detailPage && !topLevelUiRendered
}

module.exports = {
  shouldRedrawOnResume
}
