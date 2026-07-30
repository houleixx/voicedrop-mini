const test = require('node:test')
const assert = require('node:assert/strict')

function freshLibraryWithWx(routes, wxOverrides) {
  const storage = {}
  const requests = []
  const uploads = []
  const downloads = []
  global.wx = Object.assign({
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    getFileSystemManager: () => ({
      readFile: ({ success }) => success({ data: new ArrayBuffer(4) })
    }),
    request: (options) => {
      requests.push(options)
      const hit = routes.find((route) => options.url.endsWith(route.path) && (!route.method || route.method === (options.method || 'GET')))
      if (!hit) {
        options.success({ statusCode: 404, data: {} })
        return
      }
      options.success({ statusCode: hit.statusCode || 200, data: hit.data })
    },
    uploadFile: (options) => {
      uploads.push(options)
      const hit = routes.find((route) => options.url.endsWith(route.path))
      if (!hit) {
        options.success({ statusCode: 404, data: '{}' })
        return
      }
      options.success({ statusCode: hit.statusCode || 200, data: JSON.stringify(hit.data || {}) })
    },
    downloadFile: (options) => {
      downloads.push(options)
      const hit = routes.find((route) => options.url.endsWith(route.path))
      if (!hit) {
        options.success({ statusCode: 404, tempFilePath: '' })
        return
      }
      options.success({ statusCode: hit.statusCode || 200, tempFilePath: hit.tempFilePath || '/tmp/downloaded.jpg' })
    }
  }, wxOverrides || {})
  ;[
    '../services/library',
    '../services/request',
    '../services/auth'
  ].forEach((id) => {
    delete require.cache[require.resolve(id)]
  })
  const library = require('../services/library')
  library.__requests = requests
  library.__uploads = uploads
  library.__downloads = downloads
  return library
}

test('library list prefers the lightweight recordings index', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  const library = freshLibraryWithWx([
    {
      path: '/recordings',
      data: {
        recordings: [{
          name: `${stem}.m4a`,
          uploaded: '2026-06-18T06:31:00Z',
          hasArticles: false,
          isEmpty: true,
          blocked: false,
          hasTags: false
        }]
      }
    }
  ])

  const records = await library.list()

  assert.equal(records.length, 1)
  assert.equal(records[0].isEmpty, true)
  assert.equal(records[0].statusLabel, '无语音')
  assert.equal(library.__requests[0].url, 'https://voicedrop.cn/files/api/recordings')
  assert.equal(library.__requests.some((request) => request.url.endsWith('/list')), false)
})

test('account deletion posts to the authenticated backend endpoint', async () => {
  const library = freshLibraryWithWx([
    { path: '/account/delete', method: 'POST', data: { ok: true } }
  ])

  assert.equal(await library.deleteAccount(), true)
  assert.equal(library.__requests[0].method, 'POST')
  assert.equal(library.__requests[0].url, 'https://voicedrop.cn/files/api/account/delete')
  assert.match(library.__requests[0].header.Authorization, /^Bearer anon_/)
})

test('library list falls back to the legacy full list when the recordings index is unavailable', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  const library = freshLibraryWithWx([
    { path: '/recordings', statusCode: 404, data: {} },
    {
      path: '/list',
      data: { files: [{ name: `${stem}.m4a`, uploaded: '2026-06-18T06:31:00Z' }] }
    }
  ])

  const records = await library.list()

  assert.equal(records.length, 1)
  assert.deepEqual(
    library.__requests.slice(0, 2).map((request) => request.url),
    ['https://voicedrop.cn/files/api/recordings', 'https://voicedrop.cn/files/api/list']
  )
})

test('library restores the last successful recordings snapshot without a network request', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  const storage = {}
  const overrides = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] }
  }
  const first = freshLibraryWithWx([{
    path: '/recordings',
    data: {
      recordings: [{
        name: `${stem}.m4a`,
        uploaded: '2026-06-18T06:31:00Z',
        hasArticles: true,
        isEmpty: false,
        blocked: false,
        hasTags: true
      }]
    }
  }], overrides)

  await first.list()

  const recreated = freshLibraryWithWx([], overrides)
  const cached = recreated.cachedRecordings()
  assert.equal(cached.length, 1)
  assert.equal(cached[0].stem, stem)
  assert.equal(cached[0].hasArticles, true)
  assert.equal(cached[0].hasTags, true)
  assert.equal(recreated.__requests.length, 0)
})

test('library publishes recording rows before enriching title and tags', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  const library = freshLibraryWithWx([
    {
      path: '/list',
      data: {
        files: [
          { name: `${stem}.m4a`, uploaded: '2026-06-18T06:31:00Z' },
          { name: `articles/${stem}.json`, uploaded: '2026-06-18T06:32:00Z' }
        ]
      }
    },
    {
      path: `/articles/${stem}`,
      data: {
        articles: [{ title: '重新录一个音频', body: '正文' }],
        tags: ['work', 'idea']
      }
    }
  ])

  const records = await library.list()

  assert.equal(records.length, 1)
  assert.equal(records[0].rowTitle, '周四·下午')
  assert.equal(library.__requests.some((request) => request.url.endsWith(`/articles/${stem}`)), false)

  await library.enrichArticleMeta(records)

  assert.equal(records[0].rowTitle, '重新录一个音频')
  assert.deepEqual(records[0].tags, ['work', 'idea'])
})

test('library list exposes the first article photo used by the recording like Android', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  const library = freshLibraryWithWx([
    {
      path: '/list',
      data: {
        files: [
          { name: `${stem}.m4a`, uploaded: '2026-06-18T06:31:00Z', articleTitle: '列表标题', tags: ['已有标签'] },
          { name: `articles/${stem}.json`, uploaded: '2026-06-18T06:32:00Z' }
        ]
      }
    },
    {
      path: `/articles/${stem}`,
      data: {
        photos: ['photos/session/first.jpg', 'photos/session/second.jpg'],
        articles: [
          { title: '无图版本', body: '正文' },
          { title: '有图版本', body: '开头\n[[photo:2]]\n结尾' }
        ]
      }
    }
  ])

  const records = await library.list()
  await library.enrichArticleMeta(records)

  assert.equal(records[0].coverPhotoKey, 'photos/session/second.jpg')
})

test('library list does not keep stale tag cache after tags are removed', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  let docReads = 0
  const listData = {
    files: [
      { name: `${stem}.m4a`, uploaded: '2026-06-18T06:31:00Z' },
      { name: `articles/${stem}.json`, uploaded: '2026-06-18T06:32:00Z' }
    ]
  }
  const library = freshLibraryWithWx([], {
    request: (options) => {
      if (options.url.endsWith('/list')) {
        options.success({ statusCode: 200, data: listData })
        return
      }
      if (options.url.endsWith(`/articles/${stem}`)) {
        docReads += 1
        options.success({
          statusCode: 200,
          data: {
            articles: [{ title: docReads === 1 ? '第一次' : '第二次', body: '正文' }],
            tags: docReads === 1 ? ['work'] : []
          }
        })
        return
      }
      options.success({ statusCode: 404, data: {} })
    }
  })

  const first = await library.list()
  await library.enrichArticleMeta(first)
  library.invalidateArticleCaches([stem])
  const second = await library.list()
  await library.enrichArticleMeta(second)

  assert.deepEqual(first[0].tags, ['work'])
  assert.deepEqual(second[0].tags, [])
})

test('library keeps the last known title visible while an empty-stem snapshot revalidates all metadata', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  let docReads = 0
  const library = freshLibraryWithWx([], {
    request: (options) => {
      if (options.url.endsWith('/recordings')) {
        options.success({
          statusCode: 200,
          data: {
            recordings: [{
              name: `${stem}.m4a`,
              uploaded: '2026-06-18T06:31:00Z',
              hasArticles: true
            }]
          }
        })
        return
      }
      if (options.url.endsWith(`/articles/${stem}`)) {
        docReads += 1
        options.success({
          statusCode: 200,
          data: {
            articles: [{
              title: docReads === 1 ? '刷新前标题' : '刷新后标题',
              body: '正文'
            }],
            tags: []
          }
        })
        return
      }
      options.success({ statusCode: 404, data: {} })
    }
  })

  const first = await library.list()
  await library.enrichArticleMeta(first)
  library.invalidateArticleCaches([])

  const refreshing = await library.list()
  assert.equal(refreshing[0].rowTitle, '刷新前标题')

  await library.enrichArticleMeta(refreshing)
  assert.equal(refreshing[0].rowTitle, '刷新后标题')
  assert.equal(docReads, 2)
})

test('library persists stale metadata without losing its visible title across service recreation', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  const storage = {}
  let docReads = 0
  const overrides = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    request: (options) => {
      if (options.url.endsWith('/recordings')) {
        options.success({
          statusCode: 200,
          data: { recordings: [{ name: `${stem}.m4a`, hasArticles: true }] }
        })
        return
      }
      if (options.url.endsWith(`/articles/${stem}`)) {
        docReads += 1
        options.success({
          statusCode: 200,
          data: {
            articles: [{ title: docReads === 1 ? '重启前标题' : '重启后标题', body: '正文' }],
            tags: []
          }
        })
        return
      }
      options.success({ statusCode: 404, data: {} })
    }
  }

  const firstLibrary = freshLibraryWithWx([], overrides)
  const first = await firstLibrary.list()
  await firstLibrary.enrichArticleMeta(first)
  firstLibrary.invalidateArticleCaches([])

  const recreatedLibrary = freshLibraryWithWx([], overrides)
  const refreshing = await recreatedLibrary.list()
  assert.equal(refreshing[0].rowTitle, '重启前标题')

  await recreatedLibrary.enrichArticleMeta(refreshing)
  assert.equal(refreshing[0].rowTitle, '重启后标题')
  assert.equal(docReads, 2)
})

test('library persists complete article metadata and skips doc requests on a new service instance', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  const storage = {}
  const overrides = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value }
  }
  const routes = [
    {
      path: '/recordings',
      data: { recordings: [{ name: `${stem}.m4a`, hasArticles: true, isEmpty: false }] }
    },
    {
      path: `/articles/${stem}`,
      data: { articles: [{ title: '磁盘缓存标题', body: '正文' }], tags: [] }
    }
  ]

  const firstLibrary = freshLibraryWithWx(routes, overrides)
  const first = await firstLibrary.list()
  await firstLibrary.enrichArticleMeta(first)
  const secondLibrary = freshLibraryWithWx(routes, overrides)
  const second = await secondLibrary.list()

  assert.equal(second[0].rowTitle, '磁盘缓存标题')
  assert.equal(secondLibrary.__requests.filter((request) => request.url.endsWith(`/articles/${stem}`)).length, 0)
})

test('library article enrichment warms an identity-scoped detail snapshot', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  const storage = {}
  const overrides = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] }
  }
  const routes = [
    {
      path: '/recordings',
      data: { recordings: [{ name: `${stem}.m4a`, hasArticles: true, isEmpty: false }] }
    },
    {
      path: `/articles/${stem}`,
      data: { articles: [{ title: '预热详情', body: '缓存正文' }], tags: [] }
    }
  ]

  const firstLibrary = freshLibraryWithWx(routes, overrides)
  const records = await firstLibrary.list()
  await firstLibrary.enrichArticleMeta(records)

  const recreatedLibrary = freshLibraryWithWx([], overrides)
  const cached = recreatedLibrary.cachedDoc(stem)
  assert.equal(cached.articles[0].title, '预热详情')
  assert.equal(cached.articles[0].body, '缓存正文')
})

test('library coalesces concurrent requests for the same article document', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  const pending = []
  const library = freshLibraryWithWx([], {
    request: (options) => pending.push(options)
  })

  const first = library.fetchDoc(stem)
  const second = library.fetchDoc(stem)

  assert.equal(pending.length, 1)
  pending[0].success({
    statusCode: 200,
    data: { articles: [{ title: '合并请求', body: '正文' }] }
  })
  const [left, right] = await Promise.all([first, second])
  assert.equal(left.articles[0].title, '合并请求')
  assert.equal(right.articles[0].title, '合并请求')
})

test('library ignores a stale article response after that stem is invalidated', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  const pending = []
  const library = freshLibraryWithWx([], {
    request: (options) => pending.push(options)
  })

  const stale = library.fetchDoc(stem)
  library.invalidateArticleCaches([stem])
  const fresh = library.fetchDoc(stem)
  assert.equal(pending.length, 2)

  pending[0].success({
    statusCode: 200,
    data: { articles: [{ title: '旧内容', body: '旧正文' }] }
  })
  pending[1].success({
    statusCode: 200,
    data: { articles: [{ title: '新内容', body: '新正文' }] }
  })

  assert.equal(await stale, null)
  assert.equal((await fresh).articles[0].title, '新内容')
  assert.equal(library.cachedDoc(stem).articles[0].title, '新内容')
})

test('library bounds persistent article snapshots and evicts the oldest entries', () => {
  const storage = {}
  const library = freshLibraryWithWx([], {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] }
  })

  for (let index = 0; index < 45; index += 1) {
    library.cacheDoc(`VoiceDrop-cache-${index}`, {
      articles: [{ title: `文章${index}`, body: '正文' }]
    })
  }

  const docKeys = Object.keys(storage)
    .filter((key) => key.startsWith('voicedrop.library.doc.v1.'))
  assert.equal(docKeys.length, 40)
  assert.equal(library.cachedDoc('VoiceDrop-cache-0'), null)
  assert.equal(library.cachedDoc('VoiceDrop-cache-44').articles[0].title, '文章44')
})

test('library evicts an old article and retries when storage quota rejects a new snapshot', () => {
  const storage = {}
  const docPrefix = 'voicedrop.library.doc.v1.'
  const library = freshLibraryWithWx([], {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => {
      const docCount = Object.keys(storage).filter((item) => item.startsWith(docPrefix)).length
      if (key.startsWith(docPrefix) && !storage[key] && docCount >= 2) {
        throw new Error('storage quota exceeded')
      }
      storage[key] = value
    },
    removeStorageSync: (key) => { delete storage[key] }
  })

  library.cacheDoc('VoiceDrop-quota-1', { articles: [{ title: '一', body: '正文' }] })
  library.cacheDoc('VoiceDrop-quota-2', { articles: [{ title: '二', body: '正文' }] })
  library.cacheDoc('VoiceDrop-quota-3', { articles: [{ title: '三', body: '正文' }] })

  assert.equal(library.cachedDoc('VoiceDrop-quota-1'), null)
  assert.equal(library.cachedDoc('VoiceDrop-quota-3').articles[0].title, '三')
  assert.equal(Object.keys(storage).filter((key) => key.startsWith(docPrefix)).length, 2)
})

test('library replaces the detail snapshot after a direct article save', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  const storage = {}
  const current = {
    schema: 3,
    articles: [{ title: '修改前', body: '旧正文', style: 2 }],
    tags: ['work']
  }
  const library = freshLibraryWithWx([], {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    request: (options) => {
      if (options.url.endsWith(`/articles/${stem}`) && (options.method || 'GET') === 'GET') {
        options.success({ statusCode: 200, data: current })
        return
      }
      if (options.url.endsWith(`/articles/${stem}`) && options.method === 'PUT') {
        options.success({ statusCode: 200, data: { ok: true } })
        return
      }
      options.success({ statusCode: 404, data: {} })
    }
  })

  await library.fetchDoc(stem)
  await library.saveArticles(stem, [{ title: '修改后', body: '新正文', style: 2 }])

  const cached = library.cachedDoc(stem)
  assert.equal(cached.articles[0].title, '修改后')
  assert.equal(cached.articles[0].body, '新正文')
  assert.deepEqual(cached.tags, ['work'])
})

test('library bounds cold-cache article enrichment to five concurrent requests', async () => {
  const stems = Array.from({ length: 9 }, (_, index) =>
    `VoiceDrop-2026-06-${String(index + 1).padStart(2, '0')}-143052-0m33s-Thu-Afternoon`)
  let active = 0
  let peak = 0
  const library = freshLibraryWithWx([], {
    request: (options) => {
      if (options.url.endsWith('/recordings')) {
        options.success({
          statusCode: 200,
          data: { recordings: stems.map((stem) => ({ name: `${stem}.m4a`, hasArticles: true })) }
        })
        return
      }
      active += 1
      peak = Math.max(peak, active)
      setTimeout(() => {
        active -= 1
        options.success({ statusCode: 200, data: { articles: [{ title: '标题', body: '正文' }], tags: [] } })
      }, 2)
    }
  })

  const records = await library.list()
  await library.enrichArticleMeta(records)

  assert.equal(records.length, 9)
  assert.equal(peak, 5)
})

test('library fetches community article docs by article key like Android', async () => {
  const library = freshLibraryWithWx([
    {
      path: '/articles/articles/VoiceDrop-a',
      data: {
        articles: [{ title: '社区正文', body: '内容' }]
      }
    }
  ])

  const doc = await library.fetchDocByArticleKey('articles/VoiceDrop-a.json')

  assert.equal(doc.articles[0].title, '社区正文')
  assert.equal(doc.articles[0].body, '内容')
})

test('library builds Android-compatible scoped photo urls', async () => {
  const library = freshLibraryWithWx([
    {
      path: '/whoami',
      data: {
        scope: 'users/anon-1'
      }
    }
  ])

  const scope = await library.ownerScope()

  assert.equal(scope, 'users/anon-1/')
  assert.equal(
    library.photoUrl('photos/a b.jpg', scope),
    'https://voicedrop.cn/files/api/photo/users/anon-1/photos/a%20b.jpg'
  )
  assert.equal(
    library.photoUrl('photos/community.jpg', 'users/author-2/'),
    'https://voicedrop.cn/files/api/photo/users/author-2/photos/community.jpg'
  )
})

test('library can query the anonymous scope while a WeChat session is active', async () => {
  const values = {
    'voicedrop.auth.anon': `anon_${'a'.repeat(64)}`,
    'voicedrop.auth.session': 'aaaaaaaa.bbbbbbbb.cccccccc'
  }
  const library = freshLibraryWithWx([
    { path: '/whoami', data: { scope: 'users/anon-current/' } }
  ], {
    getStorageSync: (key) => values[key] || '',
    setStorageSync: (key, value) => { values[key] = value }
  })

  const scope = await library.ownerScope({ anonymous: true })

  assert.equal(scope, 'users/anon-current/')
  assert.equal(library.__requests[0].header.Authorization, `Bearer anon_${'a'.repeat(64)}`)
})

test('library refreshes its cached owner scope after the anonymous account token changes', async () => {
  const values = { 'voicedrop.auth.anon': `anon_${'a'.repeat(64)}` }
  let reads = 0
  const library = freshLibraryWithWx([], {
    getStorageSync: (key) => values[key] || '',
    setStorageSync: (key, value) => { values[key] = value },
    request: (options) => {
      reads += 1
      options.success({ statusCode: 200, data: { scope: reads === 1 ? 'users/anon-current/' : 'users/anon-next/' } })
    }
  })

  assert.equal(await library.ownerScope(), 'users/anon-current/')
  values['voicedrop.auth.anon'] = `anon_${'b'.repeat(64)}`
  assert.equal(await library.ownerScope(), 'users/anon-next/')
  assert.equal(reads, 2)
})

test('library persists downloaded audio and reuses it after service recreation', async () => {
  const storage = {}
  const savedFiles = new Set()
  let downloadCount = 0
  let saveCount = 0
  const overrides = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    downloadFile: ({ success }) => {
      downloadCount += 1
      success({ statusCode: 200, tempFilePath: `wxfile://temporary-audio-${downloadCount}.m4a` })
    },
    getFileSystemManager: () => ({
      accessSync: (filePath) => {
        if (!savedFiles.has(filePath)) throw new Error('missing saved file')
      },
      saveFile: ({ success }) => {
        const filePath = `wxfile://saved-audio-${++saveCount}.m4a`
        savedFiles.add(filePath)
        success({ savedFilePath: filePath })
      },
      unlinkSync: (filePath) => savedFiles.delete(filePath)
    })
  }

  const first = freshLibraryWithWx([], overrides)
  assert.equal(await first.downloadAudioFile('VoiceDrop-a.m4a'), 'wxfile://saved-audio-1.m4a')
  const recreated = freshLibraryWithWx([], overrides)
  assert.equal(await recreated.downloadAudioFile('VoiceDrop-a.m4a'), 'wxfile://saved-audio-1.m4a')
  assert.equal(downloadCount, 1)
})

test('library coalesces audio downloads and keeps only the eight most recent files', async () => {
  const storage = {}
  const savedFiles = new Set()
  const removed = []
  const pending = []
  let saveCount = 0
  const overrides = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    downloadFile: (options) => pending.push(options),
    getFileSystemManager: () => ({
      accessSync: (filePath) => {
        if (!savedFiles.has(filePath)) throw new Error('missing saved file')
      },
      saveFile: ({ success }) => {
        const filePath = `wxfile://saved-audio-${++saveCount}.m4a`
        savedFiles.add(filePath)
        success({ savedFilePath: filePath })
      },
      unlinkSync: (filePath) => {
        removed.push(filePath)
        savedFiles.delete(filePath)
      }
    })
  }
  const library = freshLibraryWithWx([], overrides)

  const first = library.downloadAudioFile('VoiceDrop-0.m4a')
  const duplicate = library.downloadAudioFile('VoiceDrop-0.m4a')
  assert.equal(pending.length, 1)
  pending.shift().success({ statusCode: 200, tempFilePath: 'wxfile://temporary-0.m4a' })
  assert.equal(await first, 'wxfile://saved-audio-1.m4a')
  assert.equal(await duplicate, 'wxfile://saved-audio-1.m4a')

  for (let index = 1; index < 9; index += 1) {
    const loading = library.downloadAudioFile(`VoiceDrop-${index}.m4a`)
    pending.shift().success({ statusCode: 200, tempFilePath: `wxfile://temporary-${index}.m4a` })
    await loading
  }

  assert.equal(library.cachedAudioPath('VoiceDrop-0.m4a'), '')
  assert.equal(library.cachedAudioPath('VoiceDrop-8.m4a'), 'wxfile://saved-audio-9.m4a')
  assert.deepEqual(removed, ['wxfile://saved-audio-1.m4a'])
})

test('library removes persistent audio and list snapshots after deleting a recording', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  const audioName = `${stem}.m4a`
  const storage = {}
  const removed = []
  const library = freshLibraryWithWx([], {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    request: (options) => options.success({ statusCode: 204, data: {} }),
    downloadFile: ({ success }) => success({ statusCode: 200, tempFilePath: 'wxfile://temporary-audio.m4a' }),
    getFileSystemManager: () => ({
      accessSync: () => {},
      saveFile: ({ success }) => success({ savedFilePath: 'wxfile://saved-audio.m4a' }),
      unlinkSync: (filePath) => removed.push(filePath)
    })
  })
  library.storeRecordingsSnapshot([{
    audioName,
    stem,
    uploaded: '2026-06-18T06:31:00Z',
    hasArticles: true
  }])
  await library.downloadAudioFile(audioName)

  assert.equal(await library.deleteRecording({ audioName, stem }), true)
  assert.equal(library.cachedAudioPath(audioName), '')
  assert.deepEqual(library.cachedRecordings(), [])
  assert.deepEqual(removed, ['wxfile://saved-audio.m4a'])
})

test('library coalesces concurrent downloads for the same article photo', async () => {
  const pending = []
  const library = freshLibraryWithWx([], {
    downloadFile: (options) => pending.push(options)
  })

  const first = library.downloadPhotoTemp('photos/a.jpg', 'users/anon-1/')
  const second = library.downloadPhotoTemp('photos/a.jpg', 'users/anon-1/')

  assert.equal(pending.length, 1)
  pending[0].success({ statusCode: 200, tempFilePath: 'wxfile://photo-a.jpg' })
  assert.equal(await first, 'wxfile://photo-a.jpg')
  assert.equal(await second, 'wxfile://photo-a.jpg')
})

test('library downloads public scoped photos from the photo CDN without a user token', async () => {
  const library = freshLibraryWithWx([
    {
      path: '/photo/users/anon-1/photos/a.jpg',
      tempFilePath: 'wxfile://photo-a.jpg'
    }
  ])

  const tempPath = await library.downloadPhotoTemp('photos/a.jpg', 'users/anon-1/')

  assert.equal(tempPath, 'wxfile://photo-a.jpg')
  assert.equal(library.__downloads.length, 1)
  assert.equal(library.__downloads[0].url, 'https://voicedrop.cn/files/api/photo/users/anon-1/photos/a.jpg')
  assert.equal(library.__downloads[0].header['X-VD-Platform'], 'miniapp')
  assert.equal(library.__downloads[0].header.Authorization, undefined)
})

test('library prefers a 512px edge thumbnail for card-sized photos and falls back to the original', async () => {
  const library = freshLibraryWithWx([
    { path: '/cdn-cgi/image/width=512,quality=60/files/api/photo/users/anon-1/photos/a.jpg', statusCode: 404 },
    { path: '/photo/users/anon-1/photos/a.jpg', tempFilePath: 'wxfile://original-a.jpg' }
  ])

  const tempPath = await library.downloadPhotoTemp('photos/a.jpg', 'users/anon-1/', { preferThumb: true })

  assert.equal(tempPath, 'wxfile://original-a.jpg')
  assert.equal(library.__downloads[0].url, 'https://jianshuo.dev/cdn-cgi/image/width=512,quality=60/files/api/photo/users/anon-1/photos/a.jpg')
  assert.equal(library.__downloads[1].url, 'https://voicedrop.cn/files/api/photo/users/anon-1/photos/a.jpg')
})

test('library persists a downloaded article photo and reuses it after recreation', async () => {
  const storage = {}
  const savedFiles = new Set()
  let saveCount = 0
  const overrides = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    getFileSystemManager: () => ({
      accessSync: (path) => {
        if (!savedFiles.has(path)) throw new Error('missing')
      },
      saveFile: ({ success }) => {
        const path = `wxfile://saved-photo-${++saveCount}.jpg`
        savedFiles.add(path)
        success({ savedFilePath: path })
      },
      unlinkSync: (path) => savedFiles.delete(path)
    })
  }
  const first = freshLibraryWithWx([
    { path: '/photo/users/anon-1/photos/a.jpg', tempFilePath: 'wxfile://temporary-a.jpg' }
  ], overrides)

  assert.equal(await first.downloadPhotoTemp('photos/a.jpg', 'users/anon-1/'), 'wxfile://saved-photo-1.jpg')
  assert.equal(first.__downloads.length, 1)

  const recreated = freshLibraryWithWx([], overrides)
  assert.equal(await recreated.downloadPhotoTemp('photos/a.jpg', 'users/anon-1/'), 'wxfile://saved-photo-1.jpg')
  assert.equal(recreated.__downloads.length, 0)
})

test('library replaces the persistent photo after a cache-busted image edit', async () => {
  const storage = {}
  const savedFiles = new Set()
  const removed = []
  let saveCount = 0
  const library = freshLibraryWithWx([], {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    downloadFile: ({ success }) => success({ statusCode: 200, tempFilePath: `wxfile://temporary-${saveCount + 1}.jpg` }),
    getFileSystemManager: () => ({
      accessSync: () => {},
      saveFile: ({ success }) => {
        const path = `wxfile://saved-${++saveCount}.jpg`
        savedFiles.add(path)
        success({ savedFilePath: path })
      },
      unlinkSync: (path) => {
        removed.push(path)
        savedFiles.delete(path)
      }
    })
  })

  assert.equal(await library.downloadPhotoTemp('photos/a.jpg', 'users/anon-1/'), 'wxfile://saved-1.jpg')
  assert.equal(
    await library.downloadPhotoTemp('photos/a.jpg', 'users/anon-1/', { cacheBust: Date.now() }),
    'wxfile://saved-2.jpg'
  )
  assert.deepEqual(removed, ['wxfile://saved-1.jpg'])
  assert.equal(library.cachedPhotoPath('photos/a.jpg', 'users/anon-1/'), 'wxfile://saved-2.jpg')
})

test('library removes cached image bytes when an article drops its photo marker', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  const storage = {}
  const removed = []
  const library = freshLibraryWithWx([
    { path: '/photo/users/anon-1/photos/a.jpg', tempFilePath: 'wxfile://temporary-a.jpg' }
  ], {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    getFileSystemManager: () => ({
      accessSync: () => {},
      saveFile: ({ success }) => success({ savedFilePath: 'wxfile://saved-a.jpg' }),
      unlinkSync: (path) => removed.push(path)
    })
  })

  await library.downloadPhotoTemp('photos/a.jpg', 'users/anon-1/')
  library.cacheDoc(stem, {
    owner: 'users/anon-1/',
    articles: [{ title: '有图', body: '正文\n[[photo:photos/a.jpg]]' }]
  })
  library.cacheDoc(stem, {
    owner: 'users/anon-1/',
    articles: [{ title: '无图', body: '正文' }]
  })

  assert.deepEqual(removed, ['wxfile://saved-a.jpg'])
  assert.equal(library.cachedPhotoPath('photos/a.jpg', 'users/anon-1/'), '')
})

test('library does not resurrect an image cache when deletion races its download', async () => {
  const stem = 'VoiceDrop-2026-06-18-143052-0m33s-Thu-Afternoon'
  const storage = {}
  const removed = []
  let finishSave
  const library = freshLibraryWithWx([], {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    downloadFile: ({ success }) => success({ statusCode: 200, tempFilePath: 'wxfile://temporary-a.jpg' }),
    getFileSystemManager: () => ({
      accessSync: () => {},
      saveFile: ({ success }) => { finishSave = success },
      unlinkSync: (path) => removed.push(path)
    })
  })
  library.cacheDoc(stem, {
    owner: 'users/anon-1/',
    articles: [{ title: '有图', body: '[[photo:photos/a.jpg]]' }]
  })
  const downloading = library.downloadPhotoTemp('photos/a.jpg', 'users/anon-1/')

  library.cacheDoc(stem, {
    owner: 'users/anon-1/',
    articles: [{ title: '已删除图片', body: '正文' }]
  })
  finishSave({ savedFilePath: 'wxfile://late-a.jpg' })
  await downloading

  assert.deepEqual(removed, ['wxfile://late-a.jpg'])
  assert.equal(library.cachedPhotoPath('photos/a.jpg', 'users/anon-1/'), '')
})

test('library does not fall back to the old photo domain when the new domain is unavailable', async () => {
  const downloads = []
  const library = freshLibraryWithWx([], {
    downloadFile: (options) => {
      downloads.push(options.url)
      options.fail({ errMsg: 'downloadFile:fail url not in domain list' })
    }
  })

  await assert.rejects(
    library.downloadPhotoTemp('photos/a.jpg', 'users/anon-1/'),
    (error) => error?.errMsg === 'downloadFile:fail url not in domain list'
  )

  assert.deepEqual(downloads, [
    'https://voicedrop.cn/files/api/photo/users/anon-1/photos/a.jpg'
  ])
})

test('library upload photo reports failing HTTP status', async () => {
  const library = freshLibraryWithWx([
    {
      path: '/upload/photos/too-large.jpg',
      statusCode: 413,
      data: {}
    }
  ])

  await assert.rejects(
    library.uploadPhoto('/tmp/photo.jpg', 'photos/too-large.jpg'),
    /HTTP 413/
  )
})

test('library uploads photos as raw JPEG bytes for files API', async () => {
  const library = freshLibraryWithWx([
    {
      path: '/upload/photos/2026-06-24-131500/30-abc.jpg',
      data: {}
    }
  ])

  const uploaded = await library.uploadPhoto('/tmp/photo.jpg', 'photos/2026-06-24-131500/30-abc.jpg')

  assert.equal(uploaded, true)
  assert.equal(library.__uploads.length, 0)
  assert.equal(library.__requests.length, 1)
  const req = library.__requests[0]
  assert.equal(req.method, 'PUT')
  assert.equal(req.header['content-type'], 'image/jpeg')
  assert.ok(req.data instanceof ArrayBuffer)
  assert.equal(req.header['X-VD-Platform'], 'miniapp')
  assert.match(req.header.Authorization, /^Bearer /)
})

test('library uploads http temp photos as raw bytes, not multipart form data', async () => {
  const readPaths = []
  const library = freshLibraryWithWx([
    {
      path: '/upload/photos/2026-06-28-174245/0-ifx.jpg',
      data: {}
    }
  ], {
    getFileSystemManager: () => ({
      readFile: ({ filePath, success }) => {
        readPaths.push(filePath)
        success({ data: new ArrayBuffer(7) })
      },
      saveFile: () => {
        throw new Error('http temp upload should not require saveFile')
      }
    }),
    saveFile: () => {
      throw new Error('deprecated wx.saveFile should not be used')
    }
  })

  const uploaded = await library.uploadPhoto(
    'http://tmp/GOK7Km7PlOzN103a78f08606f2cfda1609885299a9b7.jpg',
    'photos/2026-06-28-174245/0-ifx.jpg'
  )

  assert.equal(uploaded, true)
  assert.deepEqual(readPaths, ['http://tmp/GOK7Km7PlOzN103a78f08606f2cfda1609885299a9b7.jpg'])
  assert.equal(library.__uploads.length, 0)
  assert.equal(library.__requests[0].header['content-type'], 'image/jpeg')
  assert.ok(library.__requests[0].data instanceof ArrayBuffer)
})

test('library falls back to raw PUT bytes when uploadFile is unavailable', async () => {
  const library = freshLibraryWithWx([
    {
      path: '/upload/photos/fallback.jpg',
      data: {}
    }
  ], {
    uploadFile: undefined
  })

  const uploaded = await library.uploadPhoto('/tmp/photo.jpg', 'photos/fallback.jpg')

  assert.equal(uploaded, true)
  assert.equal(library.__uploads.length, 0)
  const req = library.__requests[0]
  assert.equal(req.method, 'PUT')
  assert.equal(req.header['content-type'], 'image/jpeg')
  assert.ok(req.data instanceof ArrayBuffer)
})

test('library saves article docs with photo markers through versioned article API', async () => {
  const stem = 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon'
  const doc = {
    articles: [{ title: 'A', body: '正文\n\n[[photo:photos/2026-06-24-131500/30-abc.jpg]]' }]
  }
  const library = freshLibraryWithWx([
    {
      path: `/articles/${stem}`,
      data: { ok: true, head: 2 }
    },
    {
      path: `/articles/${stem}`,
      data: doc
    }
  ])

  await library.saveDoc(stem, doc)

  const put = library.__requests.find((item) => item.method === 'PUT' && item.url.endsWith(`/articles/${stem}`))
  assert.equal(put.header['content-type'], 'application/json')
  assert.deepEqual(put.data, doc)
})

test('library saveDoc returns submitted doc when post-save refetch is unavailable', async () => {
  const stem = 'VoiceDrop-2026-06-24-131500-0m30s-Wed-Afternoon'
  const doc = {
    articles: [{ title: 'A', body: '正文\n\n[[photo:photos/2026-06-24-131500/30-abc.jpg]]' }]
  }
  const library = freshLibraryWithWx([
    {
      path: `/articles/${stem}`,
      data: { ok: true, head: 2 }
    },
    {
      path: `/articles/${stem}`,
      statusCode: 503,
      data: {}
    }
  ])

  const saved = await library.saveDoc(stem, doc)

  assert.deepEqual(saved, doc)
})

test('library saveArticles preserves unknown top-level fields from the server', async () => {
  const stem = 'VoiceDrop-2026-07-15-120000-0m30s-Wed-Noon'
  const articles = [{ title: 'A', body: '精修后的正文', style: 4 }]
  const library = freshLibraryWithWx([
    {
      method: 'GET',
      path: `/articles/${stem}`,
      data: { id: 'doc-1', owner: 'users/anon/', futureField: { keep: true }, articles: [{ title: 'A', body: '旧正文', futureArticleField: '保留' }] }
    },
    {
      method: 'PUT',
      path: `/articles/${stem}`,
      data: { ok: true, head: 5 }
    }
  ])

  await library.saveArticles(stem, articles)

  const put = library.__requests.find((item) => item.method === 'PUT' && item.url.endsWith(`/articles/${stem}`))
  assert.deepEqual(put.data, {
    id: 'doc-1',
    owner: 'users/anon/',
    futureField: { keep: true },
    articles: [{ title: 'A', body: '精修后的正文', style: 4, futureArticleField: '保留' }]
  })
})
