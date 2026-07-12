const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')

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

test('miniapp UI uses Remix Icon font without bundled icon image references', () => {
  const appWxss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
  assert.match(appWxss, /@import\s+['"]\.\/styles\/remixicon\.wxss['"]/)

  const files = walk(root).filter((file) => /\.(wxml|wxss)$/.test(file))
  const offenders = files
    .map((file) => {
      const text = fs.readFileSync(file, 'utf8')
      const iconRefs = text.match(/\/images\/icons\/[^"'\s]+/g) || []
      return iconRefs.length ? path.relative(root, file) : null
    })
    .filter(Boolean)

  assert.deepEqual(offenders, [])
})

test('components that render Remix Icon classes import the icon font stylesheet', () => {
  const componentWxmlFiles = walk(path.join(root, 'components'))
    .filter((file) => file.endsWith('.wxml'))

  const offenders = componentWxmlFiles
    .map((file) => {
      const wxml = fs.readFileSync(file, 'utf8')
      if (!/\bri-[a-z0-9-]+/.test(wxml)) return null

      const wxssPath = file.replace(/\.wxml$/, '.wxss')
      const wxss = fs.existsSync(wxssPath) ? fs.readFileSync(wxssPath, 'utf8') : ''
      return /@import\s+['"]\.\.\/\.\.\/styles\/remixicon\.wxss['"]/.test(wxss)
        ? null
        : path.relative(root, wxssPath)
    })
    .filter(Boolean)

  assert.deepEqual(offenders, [])
})

test('pages that render Remix Icon classes import the icon font stylesheet', () => {
  const pageWxmlFiles = walk(path.join(root, 'pages'))
    .filter((file) => file.endsWith('.wxml'))

  const offenders = pageWxmlFiles
    .map((file) => {
      const wxml = fs.readFileSync(file, 'utf8')
      if (!/\bri-[a-z0-9-]+/.test(wxml)) return null

      const wxssPath = file.replace(/\.wxml$/, '.wxss')
      const wxss = fs.existsSync(wxssPath) ? fs.readFileSync(wxssPath, 'utf8') : ''
      return /@import\s+['"]\.\.\/\.\.\/styles\/remixicon\.wxss['"]/.test(wxss)
        ? null
        : path.relative(root, wxssPath)
    })
    .filter(Boolean)

  assert.deepEqual(offenders, [])
})

test('home header uses icon font settings gear and chevron for back navigation', () => {
  const homeTabs = fs.readFileSync(path.join(root, 'components/home-tabs/index.wxml'), 'utf8')
  const homeTabsCss = fs.readFileSync(path.join(root, 'components/home-tabs/index.wxss'), 'utf8')
  const pageHeader = fs.readFileSync(path.join(root, 'components/page-header/index.wxml'), 'utf8')
  const pageHeaderCss = fs.readFileSync(path.join(root, 'components/page-header/index.wxss'), 'utf8')

  assert.match(homeTabs, /class="settings-icon settings-icon-gear"><\/text>/)
  assert.doesNotMatch(homeTabs, /\/images\/icons\/settings\.png/)
  assert.match(homeTabsCss, /font-family:\s*'remixicon'\s*!important;/)
  assert.match(homeTabsCss, /\.settings-icon-gear::before\s*\{[^}]*content:\s*"\\f0e8";/s)
  assert.match(pageHeader, /class="header-back-icon header-back-icon-arrow"><\/text>/)
  assert.doesNotMatch(pageHeader, /ri-arrow-left-line/)
  assert.doesNotMatch(pageHeader, /ri-arrow-left-s-line/)
  assert.doesNotMatch(pageHeader, /&#xea60;/)
  assert.match(pageHeaderCss, /font-family:\s*'remixicon'\s*!important;/)
  assert.match(pageHeaderCss, /\.header-back-icon-arrow::before\s*\{[^}]*content:\s*"\\ea64";/s)
})

test('all back buttons use Remix Icon font glyphs', () => {
  const files = walk(root).filter((file) => file.endsWith('.wxml'))
  const offenders = files
    .map((file) => {
      const text = fs.readFileSync(file, 'utf8')
      if (text.includes('/images/icons/back.png')) return path.relative(root, file)

      const backControls = text.match(/<[^>]+aria-label="返回"[\s\S]*?<\/(?:view|button)>/g) || []
      const hasImageBack = backControls.some((control) => /<image\b/.test(control))
      const missingFontBack = backControls.some((control) => !/(ri-arrow-left-s-line|header-back-icon-arrow)/.test(control))
      return hasImageBack || missingFontBack ? path.relative(root, file) : null
    })
    .filter(Boolean)

  assert.deepEqual(offenders, [])
})

test('settings pages that host page-header import the icon font stylesheet', () => {
  const pageHeaderHosts = [
    'pages/settings/index',
    'pages/wechat-settings/index'
  ]

  const offenders = pageHeaderHosts
    .map((page) => {
      const wxml = fs.readFileSync(path.join(root, `${page}.wxml`), 'utf8')
      const wxss = fs.readFileSync(path.join(root, `${page}.wxss`), 'utf8')
      if (!/<page-header\b/.test(wxml)) return null
      return /@import\s+['"]\.\.\/\.\.\/styles\/remixicon\.wxss['"]/.test(wxss) ? null : `${page}.wxss`
    })
    .filter(Boolean)

  assert.deepEqual(offenders, [])
})
