const test = require('node:test')
const assert = require('node:assert/strict')

const route = require('../services/api-route')

function deferredPlatform(storage) {
  const requests = []
  const writes = []
  const platform = {
    getStorageSync(key) { return key === route.STORAGE_KEY ? storage : undefined },
    setStorageSync(key, value) { writes.push({ key, value }) },
    request(options) {
      const item = { options, aborted: false }
      requests.push(item)
      return { abort() { item.aborted = true } }
    }
  }
  return { platform, requests, writes }
}

test('route policy keeps incumbent on dual failure and switches to a sole survivor', () => {
  assert.equal(route.pickHost(route.CN_HOST, null, null), route.CN_HOST)
  assert.equal(route.pickHost(route.CF_HOST, null, null), route.CF_HOST)
  assert.equal(route.pickHost(route.CF_HOST, 500, null), route.CN_HOST)
  assert.equal(route.pickHost(route.CN_HOST, null, 500), route.CF_HOST)
})

test('route policy requires a challenger to be strictly more than 150ms faster', () => {
  assert.equal(route.pickHost(route.CN_HOST, 550, 400), route.CN_HOST)
  assert.equal(route.pickHost(route.CN_HOST, 551, 400), route.CF_HOST)
  assert.equal(route.pickHost(route.CF_HOST, 400, 550), route.CF_HOST)
  assert.equal(route.pickHost(route.CF_HOST, 400, 551), route.CN_HOST)
})

test('selector defaults to cn and restores only a recognized persisted host', () => {
  let harness = deferredPlatform({ host: 'evil.example', probedAt: 10 })
  let selector = route.createRouteSelector(harness.platform, () => 20)
  assert.equal(selector.currentHost(), route.CN_HOST)
  assert.equal(selector.publicWebBase(), 'https://voicedrop.cn')

  harness = deferredPlatform({ host: route.CF_HOST, probedAt: 10 })
  selector = route.createRouteSelector(harness.platform, () => 20)
  assert.equal(selector.currentHost(), route.CF_HOST)
  assert.equal(selector.publicWebBase(), 'https://jianshuo.dev/voicedrop')
})

test('probe starts both cache-bypassing HEAD requests concurrently and persists the winner', async () => {
  let now = 1000
  const harness = deferredPlatform({ host: route.CN_HOST, probedAt: 0 })
  const selector = route.createRouteSelector(harness.platform, () => now)
  const pending = selector.probe()

  assert.equal(harness.requests.length, 2)
  assert.deepEqual(harness.requests.map((item) => [item.options.method, item.options.url]), [
    ['HEAD', 'https://voicedrop.cn/'],
    ['HEAD', 'https://jianshuo.dev/voicedrop/']
  ])
  assert.ok(harness.requests.every((item) => item.options.timeout === route.PROBE_TIMEOUT_MS))
  assert.ok(harness.requests.every((item) => item.options.header['Cache-Control'] === 'no-cache'))

  now = 1800
  harness.requests[0].options.success({ statusCode: 200 })
  now = 1200
  harness.requests[1].options.success({ statusCode: 204 })
  const result = await pending

  assert.deepEqual(result, { host: route.CF_HOST, switched: true, cnMs: 800, cfMs: 200 })
  assert.equal(selector.currentHost(), route.CF_HOST)
  assert.deepEqual(harness.writes, [{
    key: route.STORAGE_KEY,
    value: { host: route.CF_HOST, probedAt: 1200 }
  }])
})

test('concurrent probes share one flight and foreground probes are throttled for 30 minutes', async () => {
  let now = 1000
  const harness = deferredPlatform({ host: route.CN_HOST, probedAt: 900 })
  const selector = route.createRouteSelector(harness.platform, () => now)

  assert.equal(await selector.probeIfDue(), null)
  assert.equal(harness.requests.length, 0)

  const first = selector.probe()
  const second = selector.probe()
  assert.equal(first, second)
  assert.equal(harness.requests.length, 2)
  harness.requests[0].options.fail({ errMsg: 'offline' })
  harness.requests[1].options.success({ statusCode: 200 })
  await first

  now += route.PROBE_INTERVAL_MS
  assert.equal(await selector.probeIfDue(), null)
  now += 1
  const due = selector.probeIfDue()
  assert.equal(harness.requests.length, 4)
  harness.requests[2].options.success({ statusCode: 200 })
  harness.requests[3].options.success({ statusCode: 200 })
  await due
})

test('probe aborts both request tasks at six seconds and ignores late callbacks', async () => {
  const harness = deferredPlatform({ host: route.CF_HOST, probedAt: 0 })
  const timers = []
  const scheduler = {
    setTimeout(callback, delay) { timers.push({ callback, delay, cleared: false }); return timers.length - 1 },
    clearTimeout(id) { timers[id].cleared = true }
  }
  const selector = route.createRouteSelector(harness.platform, () => 7000, scheduler)
  const pending = selector.probe()

  assert.deepEqual(timers.map((timer) => timer.delay), [6000, 6000])
  timers[0].callback()
  timers[1].callback()
  const result = await pending
  assert.equal(harness.requests.every((item) => item.aborted), true)
  assert.equal(result.host, route.CF_HOST)
  assert.equal(result.cnMs, null)
  assert.equal(result.cfMs, null)

  harness.requests[0].options.success({ statusCode: 200 })
  harness.requests[1].options.success({ statusCode: 200 })
  assert.equal(selector.currentHost(), route.CF_HOST)
  assert.equal(harness.writes.length, 1)
})
