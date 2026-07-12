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
  const service = Object.assign({ load: async () => ({ ok: true, items: [] }), save: async () => ({ ok: true }), setSharing: async () => ({ ok: true }) }, serviceOverrides)
  const uiService = Object.assign({ refresh: async () => ({}) }, uiOverrides)
  global.Page = (definition) => { page = definition }
  global.wx = Object.assign({ navigateTo() {}, navigateBack() {} }, wxOverrides)
  for (const id of [`../pages/${name}/index`, '../services/instruction-settings', '../services/ui-config']) {
    try { delete require.cache[require.resolve(id)] } catch (_) {}
  }
  require.cache[require.resolve('../services/instruction-settings')] = { exports: service }
  require.cache[require.resolve('../services/ui-config')] = { exports: uiService }
  require(`../pages/${name}/index`)
  return page
}

const items = [
  { id: 'a', label: '图片风格 · 卡通', defaultName: '卡通', defaultText: '默认', effective: '默认', effectiveLabel: '卡通', customized: false, hidden: false },
  { id: 'b', label: '图片风格 · 水彩', defaultName: '水彩', defaultText: '默认', override: '我的提示词', customLabel: '透明水彩', effective: '我的提示词', effectiveLabel: '透明水彩', customized: true, hidden: false, shareCode: '1234567', sharing: true },
  { id: 'c', label: '改写这段 · 简洁', defaultName: '简洁', defaultText: '默认', effective: '默认', effectiveLabel: '简洁', customized: false, hidden: true }
]

test('prompt pages reserve space below the fixed custom header', () => {
  const root = path.join(__dirname, '..')
  const listCss = fs.readFileSync(path.join(root, 'pages/instruction-settings/index.wxss'), 'utf8')
  const editCss = fs.readFileSync(path.join(root, 'pages/instruction-edit/index.wxss'), 'utf8')
  assert.match(listCss, /\.prompt-page\s*\{[^}]*padding-top:\s*232rpx/s)
  assert.match(editCss, /\.edit-page\s*\{[^}]*padding-top:\s*232rpx/s)
})

test('prompt list maps default, customized, and hidden states', async () => {
  const page = freshPage('instruction-settings', { load: async () => ({ ok: true, items }) })
  const ctx = context(page)
  await page.loadItems.call(ctx)
  assert.deepEqual(ctx.data.rows.map((row) => row.status), ['', '已自定义', '已从菜单隐藏'])
  assert.equal(ctx.data.rows[1].title, '图片风格 · 透明水彩')
  assert.equal(ctx.data.loading, false)
})

test('prompt list exposes load failure and encodes edit ids', async () => {
  const navigations = []
  const page = freshPage('instruction-settings', { load: async () => ({ ok: false, items: [] }) }, { navigateTo: ({ url }) => navigations.push(url) })
  const ctx = context(page)
  await page.loadItems.call(ctx)
  assert.equal(ctx.data.error, '加载失败')
  page.openItem.call(ctx, { currentTarget: { dataset: { id: 'a/b c' } } })
  assert.equal(navigations[0], '/pages/instruction-edit/index?id=a%2Fb%20c')
})

test('prompt editor loads drafts, restores defaults, and saves once', async () => {
  const saves = []
  const backs = []
  const page = freshPage('instruction-edit', {
    load: async () => ({ ok: true, items }),
    save: async (...args) => { saves.push(args); return { ok: true } }
  }, { navigateBack: () => backs.push(true) })
  const ctx = context(page, { itemId: 'b' })
  await page.loadItem.call(ctx)
  assert.equal(ctx.data.nameDraft, '透明水彩')
  assert.equal(ctx.data.instructionDraft, '我的提示词')
  assert.equal(ctx.data.pageTitle, '图片风格 · 水彩')
  assert.equal(ctx.data.shareCode, '1234567')
  assert.equal(ctx.data.sharing, true)
  page.restoreDefault.call(ctx)
  assert.equal(ctx.data.nameDraft, '')
  assert.equal(ctx.data.instructionDraft, '')
  await page.save.call(ctx)
  assert.deepEqual(saves, [['b', '', '', false]])
  assert.equal(backs.length, 1)
})

test('prompt editor toggles sharing, copies values, and builds share copy', async () => {
  const toggles = []
  const clipboards = []
  const page = freshPage('instruction-edit', {
    load: async () => ({ ok: true, items }),
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
    load: async () => ({ ok: true, items }),
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
