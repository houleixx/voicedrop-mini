const CN_HOST = 'voicedrop.cn'
const CF_HOST = 'jianshuo.dev'
const STORAGE_KEY = 'voicedrop.api.route.v1'
const PROBE_INTERVAL_MS = 30 * 60 * 1000
const PROBE_TIMEOUT_MS = 6000
const HYSTERESIS_MS = 150

function pickHost(incumbent, cnMs, cfMs) {
  const current = incumbent === CF_HOST ? CF_HOST : CN_HOST
  const cnAlive = Number.isFinite(cnMs)
  const cfAlive = Number.isFinite(cfMs)
  if (!cnAlive && !cfAlive) return current
  if (cnAlive && !cfAlive) return CN_HOST
  if (!cnAlive && cfAlive) return CF_HOST
  const incumbentMs = current === CN_HOST ? cnMs : cfMs
  const challengerMs = current === CN_HOST ? cfMs : cnMs
  return challengerMs + HYSTERESIS_MS < incumbentMs
    ? (current === CN_HOST ? CF_HOST : CN_HOST)
    : current
}

function createRouteSelector(platform, clock, timers) {
  const runtime = platform || {}
  const now = typeof clock === 'function' ? clock : Date.now
  const scheduler = timers || { setTimeout, clearTimeout }
  let persisted = {}
  try { persisted = runtime.getStorageSync && runtime.getStorageSync(STORAGE_KEY) || {} } catch (_) {}
  let current = persisted.host === CF_HOST ? CF_HOST : CN_HOST
  let probedAt = Number(persisted.probedAt) || 0
  let inFlight = null
  let generation = 0

  function save() {
    try {
      if (runtime.setStorageSync) runtime.setStorageSync(STORAGE_KEY, { host: current, probedAt })
    } catch (_) {}
  }

  function measure(url, probeGeneration) {
    return new Promise((resolve) => {
      let settled = false
      let task
      const startedAt = now()
      const finish = (milliseconds) => {
        if (settled) return
        settled = true
        scheduler.clearTimeout(timer)
        resolve(probeGeneration === generation ? milliseconds : null)
      }
      const timer = scheduler.setTimeout(() => {
        try { if (task && task.abort) task.abort() } catch (_) {}
        finish(null)
      }, PROBE_TIMEOUT_MS)
      try {
        task = runtime.request({
          method: 'HEAD',
          url,
          timeout: PROBE_TIMEOUT_MS,
          header: { 'Cache-Control': 'no-cache' },
          success: (response) => finish(response && response.statusCode >= 200 && response.statusCode < 300
            ? Math.max(0, now() - startedAt) : null),
          fail: () => finish(null)
        })
      } catch (_) {
        finish(null)
      }
    })
  }

  function probe() {
    if (inFlight) return inFlight
    const probeGeneration = ++generation
    const incumbent = current
    const pending = Promise.all([
      measure(`https://${CN_HOST}/`, probeGeneration),
      measure(`https://${CF_HOST}/voicedrop/`, probeGeneration)
    ]).then(([cnMs, cfMs]) => {
      if (probeGeneration !== generation) return null
      const host = pickHost(incumbent, cnMs, cfMs)
      const result = { host, switched: host !== incumbent, cnMs, cfMs }
      current = host
      probedAt = now()
      save()
      return result
    }).finally(() => {
      if (inFlight === pending) inFlight = null
    })
    inFlight = pending
    return pending
  }

  function probeIfDue(maxAgeMs) {
    const interval = Number.isFinite(maxAgeMs) ? maxAgeMs : PROBE_INTERVAL_MS
    if (now() - probedAt <= interval) return Promise.resolve(null)
    return probe()
  }

  return {
    currentHost: () => current,
    publicWebBase: () => current === CN_HOST
      ? `https://${CN_HOST}`
      : `https://${CF_HOST}/voicedrop`,
    probe,
    probeIfDue
  }
}

let singleton

function shared() {
  if (!singleton) singleton = createRouteSelector(typeof wx === 'undefined' ? {} : wx)
  return singleton
}

module.exports = {
  CN_HOST,
  CF_HOST,
  STORAGE_KEY,
  PROBE_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  HYSTERESIS_MS,
  pickHost,
  createRouteSelector,
  currentHost: () => shared().currentHost(),
  publicWebBase: () => shared().publicWebBase(),
  probe: () => shared().probe(),
  probeIfDue: () => shared().probeIfDue()
}
