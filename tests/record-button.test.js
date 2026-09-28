const test = require('node:test')
const assert = require('node:assert/strict')
const permission = require('../utils/record-permission')

function harness(t) {
  let page
  global.getApp = () => ({ globalData: {} })
  global.Page = (value) => { page = value }
  const navigations = []
  const vibrations = []
  global.wx = {
    getStorageSync() {},
    navigateTo(options) { navigations.push(options) },
    vibrateShort(options) { vibrations.push(options) }
  }
  delete require.cache[require.resolve('../pages/recordings/index')]
  require('../pages/recordings/index')
  const ctx = Object.assign({}, page, {
    data: { ...page.data },
    requestAudioConsent: async () => true,
    setData(update) { Object.assign(this.data, update) }
  })
  const oldEnsure = permission.ensure
  permission.ensure = async () => true
  t.after(() => { permission.ensure = oldEnsure; ctx._clearMicLongPressTimer() })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  return { ctx, navigations, vibrations }
}
const down = { touches: [{ pageX: 100, pageY: 100 }] }
async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve() }

test('short tap opens one normal recording page on release without a haptic', async (t) => {
  const { ctx, navigations, vibrations } = harness(t)
  ctx.onMicTouchStart(down)
  t.mock.timers.tick(399)
  assert.equal(navigations.length, 0)
  ctx.onMicTouchEnd()
  await settle()
  t.mock.timers.tick(1000)
  assert.equal(navigations.length, 1)
  assert.equal(navigations[0].url, '/pages/record/index')
  assert.equal(vibrations.length, 0)
})

test('400 ms hold opens recording before release and release cannot open twice', async (t) => {
  const { ctx, navigations, vibrations } = harness(t)
  ctx.onMicTouchStart(down)
  t.mock.timers.tick(400)
  await settle()
  assert.equal(navigations.length, 1)
  assert.deepEqual(vibrations, [{ type: 'medium' }])
  ctx.onMicTouchEnd()
  ctx.onMicTouchEnd()
  await settle()
  assert.equal(navigations.length, 1)
})

for (const action of ['cancel', 'move', 'hide', 'unload']) {
  test(`${action} before threshold prevents both delayed and release launches`, async (t) => {
    const { ctx, navigations } = harness(t)
    ctx.onMicTouchStart(down)
    if (action === 'cancel') ctx.onMicTouchCancel()
    if (action === 'move') ctx.onMicTouchMove({ touches: [{ pageX: 125, pageY: 100 }] })
    if (action === 'hide') ctx.onHide()
    if (action === 'unload') ctx.onUnload()
    t.mock.timers.tick(500)
    ctx.onMicTouchEnd()
    await settle()
    assert.equal(navigations.length, 0)
  })
}

test('small finger movement preserves a hold', async (t) => {
  const { ctx, navigations } = harness(t)
  ctx.onMicTouchStart(down)
  ctx.onMicTouchMove({ touches: [{ pageX: 124, pageY: 100 }] })
  t.mock.timers.tick(400)
  await settle()
  assert.equal(navigations.length, 1)
})

test('releasing and tapping during consent cannot duplicate permission or navigation', async (t) => {
  const { ctx, navigations } = harness(t)
  let agree
  let requests = 0
  ctx.requestAudioConsent = () => { requests++; return new Promise((resolve) => { agree = resolve }) }
  ctx.onMicTouchStart(down)
  t.mock.timers.tick(400)
  ctx.onMicTouchEnd()
  ctx.onMicTouchStart(down)
  ctx.onMicTouchEnd()
  assert.equal(requests, 1)
  agree(true)
  await settle()
  assert.equal(navigations.length, 1)
})

test('permission response after leaving home cannot open a stale recorder', async (t) => {
  const { ctx, navigations } = harness(t)
  let permit
  permission.ensure = () => new Promise((resolve) => { permit = resolve })
  const launching = ctx.startRecord()
  await settle()
  ctx.onHide()
  permit(true)
  await launching
  assert.equal(navigations.length, 0)
})

test('declined permission and failed navigation release the launch guard for retry', async (t) => {
  const { ctx, navigations } = harness(t)
  permission.ensure = async () => false
  await ctx.startRecord()
  assert.equal(navigations.length, 0)
  permission.ensure = async () => true
  await ctx.startRecord()
  assert.equal(navigations.length, 1)
  navigations[0].fail()
  await ctx.startRecord()
  assert.equal(navigations.length, 2)
})

test('returning from recording permits a new recording gesture', async (t) => {
  const { ctx, navigations } = harness(t)
  await ctx.startRecord()
  ctx.onHide()
  ctx.showPendingRecordingUploads = () => {}
  ctx.drainPendingRecordingUploads = () => {}
  ctx.resetAccountSessionsIfNeeded = () => {}
  ctx.applyPendingHomeTab = () => {}
  ctx._awaitingInitialShow = true
  ctx.onShow()
  await ctx.startRecord()
  assert.equal(navigations.length, 2)
})

test('a second touch does not restart the hold timer and empty touches are ignored', async (t) => {
  const { ctx, navigations } = harness(t)
  ctx.onMicTouchStart({ touches: [] })
  ctx.onMicTouchStart(down)
  t.mock.timers.tick(250)
  ctx.onMicTouchStart(down)
  t.mock.timers.tick(150)
  await settle()
  assert.equal(navigations.length, 1)
})

test('switching home tabs cancels an armed hold and an outstanding consent result', async (t) => {
  const { ctx, navigations } = harness(t)
  ctx.saveScrollPosition = () => {}
  ctx.restoreScrollPosition = () => {}
  ctx.loadCommunity = () => {}
  ctx.onMicTouchStart(down)
  ctx.switchHomeTab({ detail: { key: 'community' } })
  t.mock.timers.tick(400)
  await settle()
  assert.equal(navigations.length, 0)
  ctx.data.activeTab = 'recordings'
  ctx.data.currentHomeTab = 'recordings'
  let agree
  ctx.requestAudioConsent = () => new Promise((resolve) => { agree = resolve })
  const launching = ctx.startRecord()
  ctx.switchHomeTab({ detail: { key: 'community' } })
  agree(true)
  await launching
  assert.equal(navigations.length, 0)
  await ctx.startRecord()
  assert.equal(navigations.length, 0)
})

test('missing haptic hardware cannot prevent recording or leave the launch guard stuck', async (t) => {
  const { ctx, navigations } = harness(t)
  global.wx.vibrateShort = () => { throw new Error('unsupported') }
  await ctx.startRecord(true)
  assert.equal(navigations.length, 1)
  navigations[0].fail()
  await ctx.startRecord()
  assert.equal(navigations.length, 2)
})
