const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('node:vm')
const readingFont = require('../utils/reading-font')
const i18n = require('../utils/i18n')
const cache = require('../services/cache-maintenance')

function environment(t, initial) {
  const previous = global.wx
  const storage = Object.assign({}, initial)
  const state = { storage, sheet: null, toast: null }
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value },
    getSystemInfoSync: () => ({ language: 'zh_CN' }),
    showActionSheet: () => { throw new Error('reading size must use a custom sheet') },
    __state: state,
    showToast: (options) => { state.toast = options }
  }
  t.after(() => { global.wx = previous })
  return state
}

function pageContext(name) {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pages', name, 'index.js'), 'utf8'), {
    require: (id) => id.endsWith('/reading-font') ? readingFont : id.endsWith('/i18n') ? i18n : {},
    Page: (page) => { definition = page },
    getApp: () => ({ globalData: {} })
  })
  return Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(update) { Object.assign(this.data, update) },
    selectComponent(id) {
      assert.equal(id, '#reading-font-sheet')
      let component
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../components/reading-font-sheet/index.js'), 'utf8'), {
        require: (id) => id.endsWith('/reading-font') ? readingFont : i18n,
        Component: (definition) => { component = definition },
        setTimeout: () => 1,
        clearTimeout() {}
      })
      const page = this
      const sheet = Object.assign({}, component.methods, {
        data: Object.assign({}, component.data),
        setData(update) { Object.assign(this.data, update) },
        triggerEvent(name) { if (name === 'change') page.onReadingFontChange() }
      })
      const open = sheet.open
      sheet.open = function () { wx.__state.sheet = this; open.call(this) }
      return sheet
    },
    refreshCacheSize() {},
    load() {}
  })
}

test('missing, invalid or inaccessible stored reading sizes safely default to standard', (t) => {
  environment(t)
  for (const invalid of [undefined, null, '', '1.5', 0, 2, NaN, {}, 'color:red']) {
    wx.setStorageSync(readingFont.KEY, invalid)
    assert.equal(readingFont.scale(), 1)
    assert.equal(readingFont.data().readingFontLabel, '标准')
    assert.match(readingFont.data().readingFontStyle, /--reading-body-size:35rpx;/)
  }
  wx.getStorageSync = () => { throw new Error('storage unavailable') }
  assert.equal(readingFont.scale(), 1)
})

test('each of the five persisted levels scales body and headings with bounded numeric lengths', (t) => {
  environment(t)
  assert.deepEqual(readingFont.LEVELS.map((level) => level.scale), [0.9, 1, 1.15, 1.3, 1.5])
  for (const level of readingFont.LEVELS) {
    wx.setStorageSync(readingFont.KEY, level.scale)
    const data = readingFont.data()
    assert.equal(data.readingFontScale, level.scale)
    assert.equal(data.readingFontLabel, level.label)
    const sizes = Object.fromEntries(data.readingFontStyle.split(';').filter(Boolean).map((entry) => entry.split(':')))
    assert.equal(parseFloat(sizes['--reading-body-size']), Number((35 * level.scale).toFixed(2)))
    assert.ok(Math.abs(parseFloat(sizes['--reading-title-size']) - 48 * level.scale) < 0.001)
    assert.equal(parseFloat(sizes['--reading-h1-size']), Number((44 * level.scale).toFixed(2)))
    assert.equal(Object.keys(sizes).length, 6)
  }
})

test('selection updates immediately, survives module reload, and is shared by all reading pages', (t) => {
  const state = environment(t)
  const settings = pageContext('settings')
  settings.chooseReadingFont()
  assert.deepEqual(state.sheet.data.levels.map((level) => `${level.label}${level.scale === state.sheet.data.readingFontScale ? ' ✓' : ''}`), ['小', '标准 ✓', '大', '特大', '超大'])
  state.sheet.choose({ currentTarget: { dataset: { index: 4 } } })
  assert.equal(settings.data.readingFontScale, 1.5)
  delete require.cache[require.resolve('../utils/reading-font')]
  assert.equal(require('../utils/reading-font').scale(), 1.5)
  for (const name of ['community-detail', 'shared-article', 'settings']) {
    const page = pageContext(name)
    page.onShow()
    assert.equal(page.data.readingFontScale, 1.5, name)
    assert.match(page.data.readingFontStyle, /--reading-body-size:52.5rpx;/)
  }
})

test('returning to an existing page refreshes a preference changed on another page without reloading content', (t) => {
  const state = environment(t)
  const community = pageContext('community-detail')
  const shared = pageContext('shared-article')
  const blocks = [{ text: 'keep [[photo:photos/s/a.jpg]]' }]
  community.data.blocks = blocks
  community.data.moreMenuOpen = true
  community.chooseReadingFont()
  assert.equal(community.data.moreMenuOpen, false)
  state.sheet.choose({ currentTarget: { dataset: { index: 2 } } })
  shared.onShow()
  assert.equal(shared.data.readingFontScale, 1.15)
  shared.chooseReadingFont()
  state.sheet.choose({ currentTarget: { dataset: { index: 0 } } })
  community.onShow()
  assert.equal(community.data.readingFontScale, 0.9)
  assert.equal(community.data.blocks, blocks)
})

test('dismissal, invalid indices and failed storage writes leave the saved and displayed size intact', (t) => {
  const state = environment(t, { [readingFont.KEY]: 1.3 })
  const page = pageContext('shared-article')
  readingFont.choose(page)
  assert.equal(state.storage[readingFont.KEY], 1.3) // opening alone does not save
  state.sheet.choose({ currentTarget: { dataset: { index: 99 } } })
  assert.equal(page.data.readingFontScale, 1.3)
  wx.setStorageSync = () => { throw new Error('quota exceeded') }
  state.sheet.choose({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(page.data.readingFontScale, 1.3)
  assert.equal(state.storage[readingFont.KEY], 1.3)
  assert.equal(state.toast.title, '字号保存失败，请重试')
})

test('reading preferences survive cache clearing and remain local instead of changing account settings', (t) => {
  environment(t)
  assert.equal(cache.isClearableStorageKey(readingFont.KEY), false)
  const source = fs.readFileSync(path.join(__dirname, '../utils/reading-font.js'), 'utf8')
  assert.doesNotMatch(source, /http|request|auth|upload/)
})

test('reading size menus and settings descriptions are translated using the selected language', (t) => {
  const state = environment(t, { appLanguage: 'en', [readingFont.KEY]: 1.15 })
  readingFont.choose(pageContext('shared-article'))
  assert.deepEqual(state.sheet.data.levels.map((level) => `${level.label}${level.scale === state.sheet.data.readingFontScale ? ' ✓' : ''}`), ['Small', 'Standard', 'Large ✓', 'Extra large', 'Largest'])
  const copy = i18n.copy('en')
  assert.equal(copy['阅读字号'], 'Reading font size')
  assert.equal(copy['社区和分享文章的正文大小'], 'Text size in community and shared articles')
})

test('prompt posts do not offer reading scaling; article controls and photos are outside font selectors', (t) => {
  const state = environment(t)
  const page = pageContext('community-detail')
  page.data.post = { isPrompt: true }
  page.chooseReadingFont()
  assert.equal(state.sheet, null)
  const template = fs.readFileSync(path.join(__dirname, '../pages/community-detail/index.wxml'), 'utf8')
  assert.match(template, /post.isPrompt \? 'prompt-detail-screen' : 'reading-font'/)
  assert.match(template, /wx:if="{{!post.isPrompt}}" bindtap="chooseReadingFont"/)
  const styles = fs.readFileSync(path.join(__dirname, '../styles/reading-font.wxss'), 'utf8')
  assert.doesNotMatch(styles, /prompt-body|tool-button|article-image|more-menu/)
  for (const name of ['community-detail', 'shared-article']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'pages', name, 'index.wxml'), 'utf8')
    assert.match(html, /style="{{readingFontStyle}}"/)
    assert.match(html, /bindtap="chooseReadingFont"/)
  }
  const ownArticle = fs.readFileSync(path.join(__dirname, '../pages/detail/index.js'), 'utf8')
  assert.doesNotMatch(ownArticle, /reading-font/)
})


test('closing the custom sheet preserves preference and reopening refreshes selection', (t) => {
  const state = environment(t, { [readingFont.KEY]: 1.3 })
  const page = pageContext('settings')
  page.chooseReadingFont()
  const sheet = state.sheet
  sheet.close()
  assert.equal(sheet.data.closing, true)
  assert.equal(state.storage[readingFont.KEY], 1.3)
  wx.setStorageSync(readingFont.KEY, 0.9)
  sheet.open()
  assert.equal(sheet.data.visible, true)
  assert.equal(sheet.data.closing, false)
  assert.equal(sheet.data.readingFontScale, 0.9)
})
