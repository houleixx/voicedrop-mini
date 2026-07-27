const test = require('node:test')
const assert = require('node:assert/strict')

function loadRepair(options = {}) {
  const storage = options.storage || {}
  const calls = { fetches: [], saves: [], placements: [], invalidations: [] }
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = value }
  }
  const library = {
    async fetchDoc(stem) {
      calls.fetches.push(stem)
      if (options.fetchError) throw options.fetchError
      return options.doc || null
    },
    async saveArticles(stem, articles) {
      calls.saves.push({ stem, articles })
      if (options.saveError) throw options.saveError
      return { articles }
    },
    invalidateArticleCaches(stems) {
      calls.invalidations.push(stems)
    }
  }
  const articleEdit = {
    async positionPhotos(stem, photoKeys) {
      calls.placements.push({ stem, photoKeys })
      if (options.positionResult) return options.positionResult
      if (options.positionedDoc) return { status: 'updated', doc: options.positionedDoc }
      return { status: 'failed', doc: null }
    }
  }
  const ids = ['../services/photo-marker-repair', '../services/library', '../services/article-edit']
  ids.forEach((id) => { delete require.cache[require.resolve(id)] })
  require.cache[require.resolve('../services/library')] = { exports: library }
  require.cache[require.resolve('../services/article-edit')] = { exports: articleEdit }
  const repair = require('../services/photo-marker-repair')
  return { repair, storage, calls }
}

test('photo marker repair appends only missing recording photos to the last article', () => {
  const h = loadRepair()
  const photos = ['photos/session/1-abc.jpg', 'photos/session/2-def.jpg']
  const articles = [
    { title: '第一篇', body: `第一篇正文\n\n[[photo:${photos[0]}]]`, style: 2 },
    { title: '第二篇', body: '第二篇正文', style: 3 }
  ]

  const result = h.repair.ensurePhotoMarkers(articles, photos)

  assert.equal(result.changed, true)
  assert.equal(result.articles[0].body, articles[0].body)
  assert.equal(result.articles[1].body, `第二篇正文\n\n[[photo:${photos[1]}]]`)
  assert.equal(result.articles[1].style, 3)
})

test('ready generated articles are repaired through the existing versioned save API', async () => {
  const name = 'VoiceDrop-2026-07-27-090000-0m8s-Mon-Morning.m4a'
  const stem = name.slice(0, -4)
  const key = 'photos/2026-07-27-090000/3-abc.jpg'
  const h = loadRepair({
    doc: { articles: [{ title: '现场记录', body: '只有文字，没有图片。', style: 1 }] }
  })
  h.repair.remember(name, [key])

  const repaired = await h.repair.repairReady([{ stem, hasArticles: true }])

  assert.equal(repaired, 1)
  assert.deepEqual(h.calls.fetches, [stem])
  assert.equal(h.calls.saves.length, 1)
  assert.equal(h.calls.saves[0].articles[0].body, `只有文字，没有图片。\n\n[[photo:${key}]]`)
  assert.deepEqual(h.repair.pending(), [])
})

test('missing generated photo markers skip AI positioning and append to the final article', async () => {
  const name = 'VoiceDrop-2026-07-27-090000-0m8s-Mon-Morning.m4a'
  const stem = name.slice(0, -4)
  const key = 'photos/2026-07-27-090000/3-abc.jpg'
  const h = loadRepair({
    doc: {
      articles: [
        { title: '现场记录', body: '先介绍会场。\n\n然后讨论展品。' },
        { title: '总结', body: '活动结束。' }
      ]
    },
    positionedDoc: {
      articles: [{ title: '现场记录', body: `先介绍会场。\n\n[[photo:${key}]]\n\n然后讨论展品。` }]
    }
  })
  h.repair.remember(name, [key])

  const repaired = await h.repair.repairReady([{ stem, hasArticles: true }])

  assert.equal(repaired, 1)
  assert.deepEqual(h.calls.placements, [])
  assert.equal(h.calls.saves.length, 1)
  assert.equal(h.calls.saves[0].articles[0].body, '先介绍会场。\n\n然后讨论展品。')
  assert.equal(h.calls.saves[0].articles[1].body, `活动结束。\n\n[[photo:${key}]]`)
  assert.deepEqual(h.calls.invalidations, [])
  assert.deepEqual(h.repair.pending(), [])
})

test('marker repair waits for generation and retains its plan after a save failure', async () => {
  const name = 'VoiceDrop-2026-07-27-090000-0m8s-Mon-Morning.m4a'
  const stem = name.slice(0, -4)
  const key = 'photos/2026-07-27-090000/3-abc.jpg'
  const h = loadRepair({
    doc: { articles: [{ title: 'A', body: '正文' }] },
    saveError: new Error('offline')
  })
  h.repair.remember(name, [key])

  assert.equal(await h.repair.repairReady([{ stem, hasArticles: false }]), 0)
  assert.deepEqual(h.calls.fetches, [])
  assert.equal(await h.repair.repairReady([{ stem, hasArticles: true }]), 0)
  assert.equal(h.repair.pending().length, 1)
})
