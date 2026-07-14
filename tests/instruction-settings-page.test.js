const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function context(page, initial) {
  return Object.assign({}, page, {
    data: Object.assign({}, page.data, initial || {}),
    setData(update) { Object.assign(this.data, update) }
  })
}

function freshPage(name, serviceOverrides, wxOverrides, uiOverrides) {
  let page
  const service = Object.assign({ items: () => [], refresh: async () => ({ ok: true }), replace: async () => ({ ok: true }), remove: async () => ({ ok: true }), add: async () => ({ ok: true }), restoreDefaults: async () => ({ ok: true }), shareStates: async () => ({ ok: true, byItem: {} }), setSharing: async () => ({ ok: true }) }, serviceOverrides)
  global.Page = (definition) => { page = definition }
  global.wx = Object.assign({ navigateTo() {}, navigateBack() {} }, wxOverrides)
  for (const id of [`../pages/${name}/index`, '../services/prompt-store']) {
    try { delete require.cache[require.resolve(id)] } catch (_) {}
  }
  require.cache[require.resolve('../services/prompt-store')] = { exports: service }
  require(`../pages/${name}/index`)
  return page
}

const items = [
  { id: 'g', type: 'group', label: '图片风格', origin: 'system', children: [
    { id: 'a', type: 'action', label: '卡通', origin: 'system', prompt: '默认', appliesTo: ['image'] },
    { id: 'b', type: 'action', label: '透明水彩', origin: 'custom', prompt: '我的提示词', appliesTo: ['image'], forkedFrom: 'sys_watercolor' }
  ] },
  { id: 'c', type: 'action', label: '简洁', origin: 'user', prompt: '默认', appliesTo: ['text'] }
]

test('prompt pages reserve space below the fixed custom header', () => {
  const root = path.join(__dirname, '..')
  const listCss = fs.readFileSync(path.join(root, 'pages/instruction-settings/index.wxss'), 'utf8')
  const editCss = fs.readFileSync(path.join(root, 'pages/instruction-edit/index.wxss'), 'utf8')
  assert.match(listCss, /\.prompt-page\s*\{[^}]*padding-top:\s*232rpx/s)
  assert.match(editCss, /\.edit-page\s*\{[^}]*padding-top:\s*232rpx/s)
})

test('prompt pages use the shared screen horizontal gutter without adding a second inset', () => {
  const root = path.join(__dirname, '..')
  const listCss = fs.readFileSync(path.join(root, 'pages/instruction-settings/index.wxss'), 'utf8')
  const editCss = fs.readFileSync(path.join(root, 'pages/instruction-edit/index.wxss'), 'utf8')
  assert.match(listCss, /\.prompt-page\s*\{[^}]*padding:\s*24rpx\s+0\s+80rpx/s)
  assert.match(editCss, /\.edit-page\s*\{[^}]*padding:\s*0\s+0\s+80rpx/s)
})

test('prompt list maps nested system, forked, and user rows', async () => {
  const page = freshPage('instruction-settings', { items: () => items, refresh: async () => ({ ok: true }) })
  const ctx = context(page)
  await page.loadItems.call(ctx)
  assert.deepEqual(ctx.data.rows.map((row) => row.originLabel), ['系统', '系统', '派生', '自建'])
  assert.equal(ctx.data.rows[2].depth, 1)
  assert.equal(ctx.data.loading, false)
})

test('prompt list keeps cached rows on load failure and encodes edit ids', async () => {
  const navigations = []
  const page = freshPage('instruction-settings', { items: () => items, refresh: async () => ({ ok: false, error: 'load_failed' }) }, { navigateTo: ({ url }) => navigations.push(url) })
  const ctx = context(page)
  await page.loadItems.call(ctx)
  assert.equal(ctx.data.error, '加载失败，正在显示上次内容')
  assert.equal(ctx.data.rows.length, 4)
  page.openItem.call(ctx, { currentTarget: { dataset: { id: 'a/b c' } } })
  assert.equal(navigations[0], '/pages/instruction-edit/index?id=a%2Fb%20c')
})

test('prompt editor forks a system node and saves once', async () => {
  const replacements = []
  const backs = []
  const page = freshPage('instruction-edit', {
    items: () => items,
    shareStates: async () => ({ ok: true, byItem: {} }),
    replace: async (...args) => { replacements.push(args); return { ok: true } }
  }, { navigateBack: () => backs.push(true) })
  const ctx = context(page, { itemId: 'a' })
  await page.loadItem.call(ctx)
  page.onNameInput.call(ctx, { detail: { value: '动画卡通' } })
  await page.save.call(ctx)
  assert.equal(replacements[0][0], 'a')
  assert.equal(replacements[0][1].origin, 'custom')
  assert.equal(replacements[0][1].forkedFrom, 'a')
  assert.equal(backs.length, 1)
})

test('prompt editor toggles sharing, copies values, and builds share copy', async () => {
  const toggles = []
  const clipboards = []
  const page = freshPage('instruction-edit', {
    items: () => items,
    shareStates: async () => ({ ok: true, byItem: { b: { code: '1234567', sharing: true } } }),
    setSharing: async (...args) => { toggles.push(args); return { ok: true, code: '7654321', sharing: true } }
  }, { setClipboardData: ({ data }) => clipboards.push(data) })
  const ctx = context(page, { itemId: 'b' })
  await page.loadItem.call(ctx)
  await page.toggleSharing.call(ctx, { detail: { value: true } })
  assert.deepEqual(toggles, [['b', true]])
  assert.equal(ctx.data.shareCode, '7654321')
  assert.equal(ctx.data.sharing, true)
  page.copyShareCode.call(ctx)
  page.copyShareLink.call(ctx)
  assert.deepEqual(clipboards, ['7654321', 'https://voicedrop.cn/7654321'])
  const payload = page.onShareAppMessage.call(ctx)
  assert.match(payload.title, /透明水彩/)
  assert.match(payload.title, /7654321/)
  assert.match(payload.title, /voicedrop\.cn\/7654321/)
})

test('prompt editor keeps sharing state and shows a friendly cap error', async () => {
  const page = freshPage('instruction-edit', {
    items: () => items,
    shareStates: async () => ({ ok: true, byItem: { b: { code: '1234567', sharing: true } } }),
    setSharing: async () => ({ ok: false, error: 'daily_cap' })
  })
  const ctx = context(page, { itemId: 'b' })
  await page.loadItem.call(ctx)
  await page.toggleSharing.call(ctx, { detail: { value: false } })
  assert.equal(ctx.data.sharing, true)
  assert.equal(ctx.data.shareError, '今天生成分享码的次数已达上限，明天再试')
})

test('prompt editor matches the iOS header and sharing layout', () => {
  const root = path.join(__dirname, '..')
  const wxml = fs.readFileSync(path.join(root, 'pages/instruction-edit/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/instruction-edit/index.wxss'), 'utf8')
  assert.match(wxml, /<page-header title="\{\{pageTitle\}\}"\s*\/>/)
  assert.match(wxml, /class="default-note"[\s\S]*class="save-button"[^>]*bindtap="save"/)
  assert.doesNotMatch(wxml, /slot="right"[\s\S]*bindtap="save"/)
  assert.match(css, /\.save-button\s*\{[^}]*width:\s*100%/s)
  assert.doesNotMatch(css.match(/\.save-button\s*\{[^}]*\}/s)[0], /position:\s*(fixed|sticky)/)
  assert.match(wxml, /分享这条提示词/)
  assert.match(wxml, /open-type="share"/)
  assert.match(wxml, /分享的始终是已保存的版本/)
})
