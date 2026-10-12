const i18n = require('./i18n')

const KEY = 'readingFontScale'
const LEVELS = Object.freeze([
  Object.freeze({ label: '小', scale: 0.9 }),
  Object.freeze({ label: '标准', scale: 1 }),
  Object.freeze({ label: '大', scale: 1.15 }),
  Object.freeze({ label: '特大', scale: 1.3 }),
  Object.freeze({ label: '超大', scale: 1.5 })
])

function normalize(value) {
  return LEVELS.some((level) => level.scale === value) ? value : 1
}

function scale() {
  try { return normalize(wx.getStorageSync(KEY)) } catch (_) { return 1 }
}

function data() {
  const value = scale()
  // Compute lengths here: CSS calc multiplication is not portable in WXSS.
  const sizes = { title: 48, section: 38, body: 35, h1: 44, h2: 38, h3: 34 }
  const style = Object.keys(sizes).map((name) =>
    `--reading-${name}-size:${Number((sizes[name] * value).toFixed(2))}rpx;`).join('')
  return {
    readingFontScale: value,
    readingFontLabel: LEVELS.find((level) => level.scale === value).label,
    readingFontStyle: style
  }
}

function choose(page) {
  const sheet = page.selectComponent('#reading-font-sheet')
  if (sheet) sheet.open()
}

function select(page, index) {
  if (!Number.isInteger(index) || index < 0 || index >= LEVELS.length) return false
  try {
    wx.setStorageSync(KEY, LEVELS[index].scale)
    page.setData(data())
    return true
  } catch (_) {
    wx.showToast({ title: i18n.ui('字号保存失败，请重试'), icon: 'none' })
    return false
  }
}

module.exports = { KEY, LEVELS, normalize, scale, data, choose, select }
