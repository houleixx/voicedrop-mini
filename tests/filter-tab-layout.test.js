const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { baselineClass, currentBaselineClass } = require('../utils/filter-tab-layout')

test('real iOS retains its baseline while Android and unknown runtimes use community correction', () => {
  assert.equal(baselineClass({ platform: 'ios', model: 'iPhone' }, {}), '')
  assert.equal(baselineClass({}, { platform: 'iOS' }), '')
  assert.equal(baselineClass({ platform: 'android' }, {}), 'filter-baseline-default')
  assert.equal(baselineClass({}, {}), 'filter-baseline-default')
  assert.equal(baselineClass(null, undefined), 'filter-baseline-default')
})

test('developer tools keep centered labels regardless of the simulated device', () => {
  assert.equal(baselineClass({ platform: 'devtools' }, { platform: 'ios' }), '')
  assert.equal(baselineClass({ platform: 'ios' }, { brand: 'wechatdevtools' }), '')
  assert.equal(baselineClass({ platform: 'devtools' }, { system: 'HarmonyOS 5' }), '')
})

test('device API can identify developer tools when the system API is unavailable', () => {
  const originalWx = global.wx
  try {
    global.wx = {
      getSystemInfoSync() { throw new Error('unavailable') },
      getDeviceInfo() { return { platform: 'devtools', system: 'Android 15' } }
    }
    assert.equal(currentBaselineClass(), '')
  } finally { global.wx = originalWx }
})

test('HarmonyOS uses its device-specific correction even when platform reports Android', () => {
  for (const info of [{ platform: 'ohos' }, { system: 'HarmonyOS 5.0' }, { system: 'OpenHarmony' }]) {
    assert.equal(baselineClass({ platform: 'android' }, info), 'filter-baseline-harmony')
  }
})

test('runtime detection tolerates unavailable or failing metadata APIs independently', () => {
  const originalWx = global.wx
  try {
    global.wx = { getSystemInfoSync() { throw new Error('unavailable') }, getDeviceInfo() { return { platform: 'ios' } } }
    assert.equal(currentBaselineClass(), '')
    global.wx = { getSystemInfoSync() { return { platform: 'android' } }, getDeviceInfo() { throw new Error('unavailable') } }
    assert.equal(currentBaselineClass(), 'filter-baseline-default')
    global.wx = {}
    assert.equal(currentBaselineClass(), 'filter-baseline-default')
    delete global.wx
    assert.equal(currentBaselineClass(), 'filter-baseline-default')
  } finally { global.wx = originalWx }
})

test('both shelf entry points and community wire the shared correction to filter labels only', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  for (const page of ['recordings', 'book-shelf']) {
    assert.match(read(`pages/${page}/index.js`), /filterBaselineClass: filterTabLayout\.currentBaselineClass\(\)/)
    assert.match(read(`pages/${page}/index.wxml`), /is="book-shelf-controls" data="\{\{filterBaselineClass,/)
  }
  assert.match(read('pages/recordings/index.wxml'), /class="community-feed-tabs \{\{filterBaselineClass\}\}"/)
  assert.match(read('pages/recordings/index.wxml'), /class="community-feed-tab-label filter-tab-label"/)
  const controls = read('utils/book-shelf-controls.wxml')
  assert.match(controls, /class="book-filter-bar \{\{filterBaselineClass\}\}"/)
  assert.match(controls, /class="book-filter-label filter-tab-label"/)
  assert.doesNotMatch(controls, /class="(?:book-search[^"\n]*|book-filter) filter-tab-label"/)
  assert.match(read('utils/book-shelf-controls.wxss'), /@import "\.\/filter-tab-layout.wxss"/)
})
