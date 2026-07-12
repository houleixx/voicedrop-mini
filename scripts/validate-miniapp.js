const fs = require('fs')
const path = require('path')

const root = process.cwd()
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const errors = []
const pageSet = new Set(app.pages || [])

function exists(rel) {
  return fs.existsSync(path.join(root, rel))
}

for (const page of pageSet) {
  for (const ext of ['js', 'json', 'wxml', 'wxss']) {
    if (!exists(`${page}.${ext}`)) errors.push(`Missing ${page}.${ext}`)
  }
  const configPath = `${page}.json`
  if (exists(configPath)) validateUsingComponents(configPath)
}

for (const item of (app.tabBar && app.tabBar.list) || []) {
  if (!pageSet.has(item.pagePath)) errors.push(`tabBar page not listed in pages: ${item.pagePath}`)
}

const files = walk(root).filter((file) => /\.(js|wxml)$/.test(file))
const routePattern = /\/pages\/[A-Za-z0-9_-]+\/index(?:\?[^'"`"\s<>]*)?/g
const requiredShares = new Set([
  'pages/recordings/index',
  'pages/detail/index',
  'pages/community/index',
  'pages/community-detail/index'
])
const sharePages = new Set()
const timelinePages = new Set()
const builtinRequires = new Set(['node:test', 'node:assert/strict', 'fs', 'path'])
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  if (text.includes('onShareAppMessage')) {
    const rel = path.relative(root, file).replace(/\.js$/, '')
    sharePages.add(rel)
  }
  if (text.includes('onShareTimeline')) {
    const rel = path.relative(root, file).replace(/\.js$/, '')
    timelinePages.add(rel)
  }
  const matches = text.match(routePattern) || []
  for (const match of matches) {
    const page = match.replace(/^\//, '').split('?')[0]
    if (!pageSet.has(page)) {
      errors.push(`${path.relative(root, file)} references unknown page ${match}`)
    }
  }
  if (file.endsWith('.js')) validateRequires(file, text)
  if (file.endsWith('.wxml')) validateWxml(file, text)
}

for (const page of requiredShares) {
  if (!sharePages.has(page)) errors.push(`Missing onShareAppMessage in ${page}.js`)
  if (!timelinePages.has(page)) errors.push(`Missing onShareTimeline in ${page}.js`)
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log('Miniapp static OK')

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function validateRequires(file, text) {
  const relFile = path.relative(root, file)
  const pattern = /require\(['"]([^'"]+)['"]\)/g
  let match
  while ((match = pattern.exec(text))) {
    const spec = match[1]
    if (builtinRequires.has(spec) || !spec.startsWith('.')) continue
    const resolved = path.resolve(path.dirname(file), spec)
    const candidates = [
      resolved,
      `${resolved}.js`,
      `${resolved}.json`,
      path.join(resolved, 'index.js')
    ]
    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      errors.push(`${relFile} requires missing module ${spec}`)
    }
  }
}

function validateUsingComponents(configPath) {
  const config = JSON.parse(fs.readFileSync(path.join(root, configPath), 'utf8'))
  for (const [name, spec] of Object.entries(config.usingComponents || {})) {
    const base = spec.startsWith('/')
      ? path.join(root, spec.slice(1))
      : path.resolve(path.dirname(path.join(root, configPath)), spec)
    for (const ext of ['js', 'json', 'wxml', 'wxss']) {
      if (!fs.existsSync(`${base}.${ext}`)) errors.push(`${configPath} component ${name} missing ${spec}.${ext}`)
    }
    const jsonPath = `${base}.json`
    if (fs.existsSync(jsonPath)) {
      const componentConfig = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      if (componentConfig.component !== true) errors.push(`${configPath} component ${name} is not declared with component: true`)
    }
  }
}

function validateWxml(file, text) {
  const relFile = path.relative(root, file)
  const badElseFor = /<[^>]+\bwx:else\b[^>]+\bwx:for\b|<[^>]+\bwx:for\b[^>]+\bwx:else\b/g
  if (badElseFor.test(text)) {
    errors.push(`${relFile} uses wx:else and wx:for on the same node; wrap wx:for in <block wx:else>`)
  }
}
