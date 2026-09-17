const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const layout = require('../utils/home-filter-layout')

function mockMeasurement(run) {
  const originalWx = global.wx
  let callback, nextTick, scopedPage
  let info = { windowWidth: 375, statusBarHeight: 47 }
  const patches = []
  const page = { data: layout.layoutOffsets(160, 375), setData(patch) { patches.push(patch); Object.assign(this.data, patch) } }
  const query = {
    in(value) { scopedPage = value; return this },
    select(selector) { assert.equal(selector, '#home-tabs'); return this },
    boundingClientRect(fn) { callback = fn; return this }, exec() {}
  }
  global.wx = {
    getWindowInfo: () => info,
    createSelectorQuery: () => query,
    nextTick(fn) { nextTick = fn }
  }
  try {
    run({ page, patches, setInfo(value) { info = value },
      tick() { nextTick(); assert.equal(scopedPage, page) }, rect(value) { callback(value) } })
  } finally { global.wx = originalWx }
}

test('toolbar and refresh content follow measured header height at different screen widths', () => {
  mockMeasurement(({ page, tick, rect, setInfo }) => {
    layout.measure(page)
    tick()
    rect({ bottom: 174 })
    assert.deepEqual(page.data, { scrollContentTop: 174, filteredScrollContentTop: 218 })
    setInfo({ windowWidth: 750 })
    layout.measure(page)
    tick()
    rect({ bottom: 174 })
    assert.deepEqual(page.data, { scrollContentTop: 174, filteredScrollContentTop: 262 })
  })
})

test('invalid measurements retain fallback and unchanged geometry avoids redundant updates', () => {
  mockMeasurement(({ page, patches, tick, rect }) => {
    layout.measure(page)
    tick()
    for (const value of [null, { bottom: 0 }, { bottom: -1 }, { bottom: NaN }, { bottom: 160 }]) rect(value)
    assert.deepEqual(patches, [])
  })
})

test('measurement results arriving after either page unload do not update its layout', () => {
  for (const flag of ['_pageUnloaded', '_shelfActive']) {
    mockMeasurement(({ page, patches, tick, rect }) => {
      layout.measure(page)
      tick()
      page[flag] = flag === '_pageUnloaded'
      rect({ bottom: 180 })
      assert.deepEqual(patches, [])
    })
  }
})

test('initial placement includes safe area and tolerates older or failing window APIs', () => {
  const originalWx = global.wx
  try {
    global.wx = { getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 47 }) }
    assert.deepEqual(layout.initialOffsets(), { scrollContentTop: 147, filteredScrollContentTop: 191 })
    global.wx.getWindowInfo = () => { throw new Error('unavailable') }
    assert.equal(layout.initialOffsets().scrollContentTop, 147)
    global.wx.getSystemInfoSync = () => { throw new Error('unavailable') }
    assert.deepEqual(layout.initialOffsets(), { scrollContentTop: 120, filteredScrollContentTop: 164 })
  } finally { global.wx = originalWx }
})

test('both bookshelf toolbars live outside the vertical refresher while status stays in the content', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  for (const page of ['recordings', 'book-shelf']) {
    const wxml = read(`pages/${page}/index.wxml`)
    const scrollStart = wxml.indexOf('<scroll-view')
    assert.ok(wxml.indexOf('class="book-filter-fixed"') < scrollStart)
    assert.ok(wxml.indexOf('is="book-shelf-controls"') < scrollStart)
    assert.ok(wxml.indexOf('is="book-shelf-search-status"') > scrollStart)
    assert.match(wxml.slice(scrollStart), /refresher-enabled/)
    assert.match(wxml, /filteredScrollContentTop/)
    assert.match(read(`pages/${page}/index.js`), /homeFilterLayout\.measure\(this\)/)
  }
  const controls = read('utils/book-shelf-controls.wxml').split('</template>')[0]
  assert.doesNotMatch(controls, /book-search-status|book-search-scope/)
})
