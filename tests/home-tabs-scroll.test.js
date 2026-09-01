const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')

function loadHomeTabs(rects) {
  let definition
  const previousComponent = global.Component
  const previousWx = global.wx
  global.Component = (value) => { definition = value }
  global.wx = {
    nextTick(fn) { fn() },
    createSelectorQuery() {
      return {
        in() { return this },
        select() { return this },
        boundingClientRect() { return this },
        exec(done) { done(rects) }
      }
    }
  }
  delete require.cache[require.resolve('../components/home-tabs/index')]
  require('../components/home-tabs/index')
  return {
    component: definition,
    restore() {
      global.Component = previousComponent
      global.wx = previousWx
    }
  }
}

test('home tabs return the first tab to the left edge after scrolling', () => {
  const loaded = loadHomeTabs([
    { left: 0, width: 375 },
    { left: -96, width: 120 }
  ])
  const ctx = {
    data: { scrollLeft: 140 },
    properties: { current: 'recordings' },
    setData(next, done) {
      Object.assign(this.data, next)
      if (done) done()
    }
  }

  try {
    loaded.component.methods.centerTab.call(ctx, 'recordings', false)
    assert.equal(ctx.data.scrollLeft, 0)
  } finally {
    loaded.restore()
  }
})

test('home tabs center the second tab after moving back from the third tab', () => {
  const loaded = loadHomeTabs([
    { left: 0, width: 375 },
    { left: -90, width: 200 }
  ])
  const ctx = {
    data: { scrollLeft: 240 },
    properties: { current: 'community' },
    setData(next, done) {
      Object.assign(this.data, next)
      if (done) done()
    }
  }

  try {
    loaded.component.methods.onTabsScroll.call(ctx, { detail: { scrollLeft: 240 } })
    loaded.component.methods.centerTab.call(ctx, 'community', true)
    assert.equal(ctx.data.scrollLeft, 62.5)
  } finally {
    loaded.restore()
  }
})

test('home tabs use the actual clamped scroll position when moving back from the last tab', () => {
  const loaded = loadHomeTabs([
    { left: 0, width: 375 },
    { left: -90, width: 200 }
  ])
  const ctx = {
    data: { scrollLeft: 360 },
    properties: { current: 'community' },
    setData(next, done) {
      Object.assign(this.data, next)
      if (done) done()
    }
  }

  try {
    loaded.component.methods.onTabsScroll.call(ctx, { detail: { scrollLeft: 240 } })
    loaded.component.methods.centerTab.call(ctx, 'community', true)
    assert.equal(ctx.data.scrollLeft, 62.5)
  } finally {
    loaded.restore()
  }
})

test('selecting a tab waits for its active layout before centering', () => {
  const loaded = loadHomeTabs([])
  const calls = { centers: 0, changes: [] }
  const ctx = {
    data: {
      tabs: [
        { key: 'recordings', label: 'My recordings' },
        { key: 'community', label: 'VD Community' }
      ]
    },
    properties: { current: 'recordings' },
    centerTab() { calls.centers += 1 },
    triggerEvent(name, detail) { calls.changes.push({ name, detail }) }
  }

  try {
    loaded.component.methods.selectTab.call(ctx, {
      currentTarget: { dataset: { tab: 'community' } }
    })
    assert.equal(calls.centers, 0)
    assert.deepEqual(calls.changes, [{
      name: 'change',
      detail: { key: 'community', tab: { key: 'community', label: 'VD Community' } }
    }])
  } finally {
    loaded.restore()
  }
})
