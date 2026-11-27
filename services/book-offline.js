const http = require('./request')

const activeDownloads = new Map()
const downloadListeners = new Set()

function downloadProgress(slug) {
  return activeDownloads.get(slug) ?? -1
}

function notifyDownloadChanged(slug) {
  const progress = downloadProgress(slug)
  for (const listener of downloadListeners) listener(slug, progress)
}

function downloadState(slug) {
  return activeDownloads.has(slug) ? 'downloading' : get(slug) ? 'downloaded' : ''
}

function downloadStates(slugs) {
  if (!slugs.length) return []
  const fs = fsForBook()
  if (fs && typeof fs.readdirSync !== 'function') return slugs.map(downloadState)
  let directories = new Set()
  if (fs) {
    try { directories = new Set(fs.readdirSync(offlineBooksRoot())) } catch (_) {}
  }
  return slugs.map((slug) => {
    if (activeDownloads.has(slug)) return 'downloading'
    if (!directories.has(slug) && !directories.has(slug + '.previous')) return ''
    return get(slug) ? 'downloaded' : ''
  })
}

function subscribeDownloads(listener) {
  downloadListeners.add(listener)
  return () => downloadListeners.delete(listener)
}
const slugPattern = /^[A-Za-z0-9_-]+$/

function safeSegment(value) {
  return typeof value === 'string' && value !== '' && value !== '.' && value !== '..' &&
    !/[\\/:?#%\u0000-\u001f\u007f]/.test(value)
}

function safePath(value) {
  return typeof value === 'string' && value.split('/').every(safeSegment)
}

function parseFileList(data, slug) {
  if (!data || data.slug !== slug || !Array.isArray(data.files) || !Array.isArray(data.audio)) {
    throw new Error('Invalid book file list')
  }
  const paths = new Set()
  for (const item of data.files) {
    if (!item || !safePath(item.path) || item.path === 'audio' || item.path.startsWith('audio/') ||
        item.path === 'manifest.json' || paths.has(item.path) || !Number.isSafeInteger(item.size) || item.size < 0) {
      throw new Error('Invalid book file')
    }
    paths.add(item.path)
  }
  if (!paths.has('index.html') || !data.audio.every(safeSegment)) throw new Error('Incomplete book file list')
  return data
}

function fsForBook() {
  return typeof wx !== 'undefined' && typeof wx.getFileSystemManager === 'function' &&
    wx.env && wx.env.USER_DATA_PATH ? wx.getFileSystemManager() : null
}

function exists(fs, path) {
  try { fs.accessSync(path); return true } catch (_) { return false }
}

function removeDir(fs, path) {
  if (exists(fs, path)) fs.rmdirSync(path, true)
}

function offlineBooksRoot() {
  return `${wx.env.USER_DATA_PATH}/offline-books`
}

function rootFor(slug) {
  return `${offlineBooksRoot()}/${slug}`
}

function readManifest(fs, root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, 'utf8'))
    return exists(fs, `${root}/index.html`) ? { ...manifest, root } : null
  } catch (_) { return null }
}

function get(slug) {
  const fs = fsForBook()
  if (!fs || !slugPattern.test(slug)) return null
  const root = rootFor(slug)
  return readManifest(fs, root) || readManifest(fs, root + '.previous')
}

function remove(slug) {
  const fs = fsForBook()
  if (!fs || !slugPattern.test(slug) || activeDownloads.has(slug)) throw new Error('Cannot delete book')
  const root = rootFor(slug)
  removeDir(fs, root + '.previous')
  removeDir(fs, root)
  notifyDownloadChanged(slug)
}

function fetchFile(url, filePath) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url, filePath, timeout: 120000, header: { 'X-VD-Platform': 'miniapp' },
      success: resolve, fail: reject
    })
  })
}

async function mirror(fs, url, destination, minimum, expected = -1) {
  const parent = destination.slice(0, destination.lastIndexOf('/'))
  if (!exists(fs, parent)) fs.mkdirSync(parent, true)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchFile(url, destination)
      if (response.statusCode === 200) {
        const size = fs.statSync(destination).size
        if (size >= minimum && (expected < 0 || size === expected)) return true
      }
      if (response.statusCode === 404) break
    } catch (_) {}
    if (exists(fs, destination)) fs.unlinkSync(destination)
  }
  if (exists(fs, destination)) fs.unlinkSync(destination)
  return false
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}

async function download(slug, rootUrl, progress) {
  const fs = fsForBook()
  if (!fs || !slugPattern.test(slug) || activeDownloads.has(slug)) throw new Error('Cannot start download')
  activeDownloads.set(slug, 0)
  const root = rootFor(slug)
  const staging = root + '.downloading'
  const previous = root + '.previous'
  try {
    notifyDownloadChanged(slug)
    removeDir(fs, staging)
    fs.mkdirSync(staging, true)
    const response = await http.get(rootUrl + '?format=files', '', { timeout: 30000 })
    if (response.statusCode !== 200) throw new Error('Book list unavailable')
    const list = parseFileList(response.data, slug)
    // The native reader uses chapter HTML and images. A standalone MP4 can be
    // played by the video component, while the web animation requires scripts.
    const files = list.files.filter(({ path }) => !path.startsWith('video/') || /\.mp4$/i.test(path))
    const total = Math.max(1, files.length + list.audio.length)
    let completed = 0
    const reportFileComplete = () => {
      const percent = Math.floor(++completed * 99 / total)
      if (percent === downloadProgress(slug)) return
      activeDownloads.set(slug, percent)
      notifyDownloadChanged(slug)
      progress(percent)
    }
    const saved = []
    const missingFiles = []
    for (const item of files) {
      const html = /\.html?$/i.test(item.path)
      if (await mirror(fs, rootUrl + encodePath(item.path), `${staging}/${item.path}`, 1, html ? -1 : item.size)) {
        saved.push(item.path)
      } else if (html && !item.path.includes('/')) {
        throw new Error('Missing book page')
      } else {
        missingFiles.push(item.path)
      }
      reportFileComplete()
    }
    const audioRoot = rootUrl.slice(0, rootUrl.lastIndexOf(`/${slug}/`)) + `/audiobook/${slug}/`
    const audio = []
    for (const stem of list.audio) {
      if (await mirror(fs, audioRoot + encodeURIComponent(stem), `${staging}/audio/${stem}.mp3`, 20000)) audio.push(stem)
      reportFileComplete()
    }
    const manifest = {
      files: saved, missingFiles, audio, audioExpected: list.audio, missingAudio: list.audio.length - audio.length,
      hasAnimation: list.files.some(({ path }) => path === 'video/index.html'),
      video: saved.find((path) => /^video\/[^/]+\.mp4$/i.test(path)) || ''
    }
    fs.writeFileSync(`${staging}/manifest.json`, JSON.stringify(manifest), 'utf8')
    if (exists(fs, root)) {
      removeDir(fs, previous)
      fs.renameSync(root, previous)
    }
    fs.renameSync(staging, root)
    try { removeDir(fs, previous) } catch (_) {}
    return { ...manifest, root }
  } finally {
    try { removeDir(fs, staging) } finally {
      activeDownloads.delete(slug)
      notifyDownloadChanged(slug)
    }
  }
}

function plainTitle(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) =>
    ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' })[entity]).trim()
}

function chapterPaths(files) {
  const rank = (path) => path === 'index.html' ? 0 : path === 'intro.html' ? 1 : 2
  return files.filter((path) => !path.includes('/') && /\.html?$/i.test(path))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }))
}

function chapterTitle(path) {
  const stem = path.replace(/\.html?$/i, '')
  return stem === 'index' ? '目录' : stem === 'intro' ? '导读' : /^\d+$/.test(stem) ? `第 ${Number(stem)} 章` : stem
}

function chapters(book) {
  return chapterPaths(book.files).map((path) => ({ path, title: chapterTitle(path) }))
}

function bookImage(source, book, url) {
  const publicPath = url.replace(/^https:\/\/[^/]+/, '')
  let path = source.trim().split(/[?#]/)[0]
  if (path.startsWith('https://voicedrop.cn/books/') || path.startsWith('https://jianshuo.dev/voicedrop/books/')) {
    path = path.replace(/^https:\/\/[^/]+/, '')
  }
  if (path.startsWith('/')) {
    const shortRoot = publicPath.replace(/^\/voicedrop/, '')
    if (path.startsWith(publicPath)) path = path.slice(publicPath.length)
    else {
      const shortPath = path.replace(/^\/voicedrop/, '')
      if (!shortPath.startsWith(shortRoot)) return ''
      path = shortPath.slice(shortRoot.length)
    }
  }
  try { path = decodeURIComponent(path.replace(/^(\.\/)+/, '')) } catch (_) { return '' }
  if (!safePath(path)) return null
  if (book.files.includes(path)) return { image: book.root ? `${book.root}/${path}` : url + encodePath(path) }
  if (book.root && (book.missingFiles || []).includes(path)) return { missingImage: true }
  return null
}

const articleTypography = {
  h1: 'font-family:serif;font-weight:600;font-size:1.62em;line-height:1.35;margin:.65em 0 .45em',
  strong: 'font-weight:600;color:#6f4933',
  figcaption: 'text-align:center;color:#897d6e;font-size:.8em;margin:.4em 0 1.1em',
  p: 'margin:0 0 1em;line-height:1.8',
  h2: 'font-family:serif;font-size:1.42em;line-height:1.4;margin:1.5em 0 .5em',
  h3: 'font-family:serif;font-size:1.15em;margin:1.3em 0 .45em',
  ul: 'padding-left:1.6em;margin:0 0 1em',
  ol: 'padding-left:1.6em;margin:0 0 1em',
  blockquote: 'border-left:3px solid #a68e72;background:#f3eadc;padding:.7em 1em;margin:1em 0',
  pre: 'background:#f3eadc;padding:.7em;white-space:pre-wrap;overflow-wrap:anywhere',
  table: 'width:100%;border-collapse:collapse;margin:1em 0',
  th: 'border:1px solid #e0d8cc;padding:.4em;background:#f3eadc',
  td: 'border:1px solid #e0d8cc;padding:.4em'
}

function styleArticle(fragment) {
  return fragment.replace(/<(p|h1|h2|h3|ul|ol|strong|figcaption|blockquote|pre|table|th|td)(?=[\s>])([^>]*)>/gi,
    (tag, name, attrs) => /\bstyle\s*=/i.test(attrs) ? tag :
      `<${name}${attrs} style="${articleTypography[name.toLowerCase()]}">`)
}

function contentBlocks(html, book, url, path) {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|audio|video|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const article = stripped.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
  const body = stripped.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
  let source = article ? article[1] : body ? body[1] : stripped
  if (path === 'index.html') {
    const toc = source.search(/<div\s+class=["']toc["'][^>]*>/i)
    if (toc >= 0) source = source.slice(0, toc)
  }
  const blocks = []
  let from = 0
  const images = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi
  let match
  const addText = (value) => {
    const text = value.replace(/<a\b[^>]*>/gi, '<span>').replace(/<\/a\s*>/gi, '</span>')
    if (text.trim()) blocks.push({ text: path ? styleArticle(text) : text })
  }
  while ((match = images.exec(source))) {
    const image = bookImage(match[1] || match[2] || match[3], book, url)
    addText(source.slice(from, match.index))
    if (image) blocks.push(image)
    from = images.lastIndex
  }
  addText(source.slice(from))
  return blocks
}

function pagePresentation(html, book, path, url) {
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  const title = heading ? plainTitle(heading[1]) : ''
  const matchClass = (name) => {
    const pattern = new RegExp('<(?:span|p)[^>]*class=["\']' + name + '["\'][^>]*>([\\s\\S]*?)<\\/(?:span|p)>', 'i')
    const match = pattern.exec(html)
    return match ? plainTitle(match[1]) : ''
  }
  if (path === 'index.html' && /<div\s+class=["']toc["']/.test(html) && title) {
    const intro = /<a[^>]*class=["']introcard["'][^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/i.exec(html)
    const tint = /--tint\s*:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\s*(?=[;}])/i.exec(html)
    const rows = []
    const links = /<a class=["']row done["'] href=["']([^"']+)["'][^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>(?:<p>([\s\S]*?)<\/p>)?[\s\S]*?<\/a>/gi
    let row
    while ((row = links.exec(html))) {
      if (safePath(row[1])) rows.push({ path: row[1], title: plainTitle(row[2]), brief: plainTitle(row[3] || '') })
    }
    return { title, blocks: [], index: { title, subtitle: matchClass('sub'), meta: matchClass('meta'),
      badge: matchClass('badge'), tint: tint ? tint[1] : '#f0e6d4', intro: intro ? plainTitle(intro[1]) : '', rows } }
  }
  return { title, blocks: contentBlocks(html, book, url, path), meta: matchClass('meta') }
}

function localPage(book, path, url) {
  if (!safePath(path) || !book.files.includes(path)) throw new Error('Invalid chapter')
  const html = fsForBook().readFileSync(`${book.root}/${path}`, 'utf8')
  return pagePresentation(html, book, path, url)
}

async function loadLocalPage(book, path, url) {
  if (!safePath(path) || !book.files.includes(path)) throw new Error('Invalid chapter')
  const fs = fsForBook()
  const html = await new Promise((resolve, reject) => {
    fs.readFile({
      filePath: `${book.root}/${path}`,
      encoding: 'utf8',
      success: ({ data }) => resolve(data),
      fail: reject
    })
  })
  return pagePresentation(html, book, path, url)
}

function readPage(book, path, url) {
  return localPage(book, path, url).blocks
}

module.exports = { get, remove, download, chapters, readPage, parseFileList, contentBlocks, localPage, loadLocalPage, pagePresentation, downloadState, downloadStates, downloadProgress, subscribeDownloads }
