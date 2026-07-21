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
  assert.equal(library.__requests[0].url, 'https://jianshuo.dev/files/api/recordings')
  assert.equal(library.__requests.some((request) => request.url.endsWith('/list')), false)
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
    ['https://jianshuo.dev/files/api/recordings', 'https://jianshuo.dev/files/api/list']
  )
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
    'https://jianshuo.dev/files/api/photo/users/anon-1/photos/a%20b.jpg'
  )
  assert.equal(
    library.photoUrl('photos/community.jpg', 'users/author-2/'),
    'https://jianshuo.dev/files/api/photo/users/author-2/photos/community.jpg'
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

test('library falls back to the API host when the photo CDN domain is unavailable', async () => {
  const downloads = []
  const library = freshLibraryWithWx([], {
    downloadFile: (options) => {
      downloads.push(options.url)
      if (options.url.startsWith('https://voicedrop.cn/')) {
        options.fail({ errMsg: 'downloadFile:fail url not in domain list' })
        return
      }
      options.success({ statusCode: 200, tempFilePath: 'wxfile://fallback.jpg' })
    }
  })

  const tempPath = await library.downloadPhotoTemp('photos/a.jpg', 'users/anon-1/')

  assert.equal(tempPath, 'wxfile://fallback.jpg')
  assert.deepEqual(downloads, [
    'https://voicedrop.cn/files/api/photo/users/anon-1/photos/a.jpg',
    'https://jianshuo.dev/files/api/photo/users/anon-1/photos/a.jpg'
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
