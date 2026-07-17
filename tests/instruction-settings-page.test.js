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
  const service = Object.assign({ items: () => [], refresh: async () => ({ ok: true }), replace: async () => ({ ok: true }), remove: async () => ({ ok: true }), add: async () => ({ ok: true }), restoreDefaults: async () => ({ ok: true }), shareStates: async () => ({ ok: true, byItem: {} }), setSharing: async () => ({ ok: true }), preview: async () => ({ ok: true, data: { label: '共享提示词' } }), importCode: async () => ({ ok: true }) }, serviceOverrides)
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

test('prompt list starts with groups collapsed and expands children directly below a group', async () => {
  const page = freshPage('instruction-settings', { items: () => items, refresh: async () => ({ ok: true }) })
  const ctx = context(page)
  await page.loadItems.call(ctx)
  assert.deepEqual(ctx.data.rows.map((row) => row.id), ['g', 'c'])
  page.toggleGroup.call(ctx, { currentTarget: { dataset: { id: 'g', type: 'group' } } })
  assert.deepEqual(ctx.data.rows.map((row) => row.id), ['g', 'a', 'b', 'c'])
  assert.equal(ctx.data.rows[1].depth, 1)
  assert.equal(ctx.data.rows[1].appliesLabel, '仅图片')
  assert.equal(ctx.data.rows[2].originLabel, '已自定义')
  assert.equal(ctx.data.loading, false)
})

test('prompt list keeps cached rows on load failure and encodes edit ids', async () => {
  const navigations = []
  const page = freshPage('instruction-settings', { items: () => items, refresh: async () => ({ ok: false, error: 'load_failed' }) }, { navigateTo: ({ url }) => navigations.push(url) })
  const ctx = context(page)
  await page.loadItems.call(ctx)
  assert.equal(ctx.data.error, '加载失败，正在显示上次内容')
  assert.equal(ctx.data.rows.length, 2)
  page.openItem.call(ctx, { currentTarget: { dataset: { id: 'a/b c' } } })
  assert.equal(navigations[0], '/pages/instruction-edit/index?id=a%2Fb%20c')
})

test('plus button opens the new menu and choosing an action closes it before navigation', () => {
  const navigations = []
  const page = freshPage('instruction-settings', {}, { navigateTo: ({ url }) => navigations.push(url) })
  const ctx = context(page)
  page.openNewMenu.call(ctx)
  assert.equal(ctx.data.newMenuVisible, true)
  page.createPrompt.call(ctx)
  assert.equal(ctx.data.newMenuVisible, false)
  assert.equal(navigations[0], '/pages/prompt-new/index?type=action')
})

test('new group opens an inline naming dialog and creates the group from that dialog', async () => {
  const added = []
  const page = freshPage('instruction-settings', {
    items: () => items,
    add: async (...args) => { added.push(args); return { ok: true } }
  }, { showToast() {} })
  const ctx = context(page, { newMenuVisible: true })
  page.createGroup.call(ctx)
  assert.equal(ctx.data.newMenuVisible, true)
  assert.equal(ctx.data.groupDialogVisible, true)
  page.onGroupNameInput.call(ctx, { detail: { value: '  我的分组  ' } })
  await page.confirmCreateGroup.call(ctx)
  assert.equal(added.length, 1)
  assert.equal(added[0][0].type, 'group')
  assert.equal(added[0][0].label, '我的分组')
  assert.deepEqual(added[0][0].children, [])
  assert.equal(added[0][1], null)
  assert.equal(ctx.data.newMenuVisible, false)
  assert.equal(ctx.data.groupDialogVisible, false)
})

test('prompt list opens the magic-code importer as a bottom sheet', () => {
  const page = freshPage('instruction-settings')
  const ctx = context(page)
  page.openImport.call(ctx)
  assert.equal(ctx.data.importVisible, true)
  page.closeImport.call(ctx)
  assert.equal(ctx.data.importVisible, false)
})

test('left swipe on an action reveals delete without opening or deleting it', () => {
  const navigations = []
  let removed = 0
  const page = freshPage('instruction-settings', { items: () => items, remove: async () => { removed += 1; return { ok: true } } }, { navigateTo: ({ url }) => navigations.push(url) })
  const ctx = context(page)
  const target = { currentTarget: { dataset: { id: 'a', type: 'action' } } }
  page.rowTouchStart.call(ctx, Object.assign({ touches: [{ pageX: 120, pageY: 20 }] }, target))
  page.rowTouchEnd.call(ctx, Object.assign({ changedTouches: [{ pageX: 20, pageY: 22 }] }, target))
  assert.equal(ctx.data.swipedRowId, 'a')
  assert.equal(ctx.data.swipeOffset, -72)
  page.handleRowTap.call(ctx, target)
  assert.deepEqual(navigations, [])
  assert.equal(removed, 0)
  assert.equal(ctx.data.swipedRowId, 'a')
})

test('groups cannot reveal or invoke prompt deletion', async () => {
  let modalShown = 0
  let removed = 0
  const page = freshPage('instruction-settings', { items: () => items, remove: async () => { removed += 1; return { ok: true } } }, {
    showModal: () => { modalShown += 1 }
  })
  const ctx = context(page)
  const target = { currentTarget: { dataset: { id: 'g', type: 'group' } } }
  page.rowTouchStart.call(ctx, Object.assign({ touches: [{ pageX: 120, pageY: 20 }] }, target))
  page.rowTouchEnd.call(ctx, Object.assign({ changedTouches: [{ pageX: 20, pageY: 22 }] }, target))
  await page.deleteItem.call(ctx, target)
  assert.equal(ctx.data.swipedRowId, '')
  assert.equal(modalShown, 0)
  assert.equal(removed, 0)
})

test('delete button confirms the action label before removing it', async () => {
  const modals = []
  const removed = []
  const loading = []
  let hidden = 0
  const page = freshPage('instruction-settings', { items: () => items, remove: async (id) => { removed.push(id); return { ok: true } } }, {
    showModal: (options) => { modals.push(options); options.success({ confirm: true }) },
    showLoading: (options) => loading.push(options),
    hideLoading: () => { hidden += 1 }
  })
  const ctx = context(page, { swipedRowId: 'a', swipeOffset: -72 })
  await page.deleteItem.call(ctx, { currentTarget: { dataset: { id: 'a', type: 'action' } } })
  assert.match(modals[0].content, /卡通/)
  assert.match(modals[0].content, /无法恢复/)
  assert.deepEqual(removed, ['a'])
  assert.deepEqual(loading, [{ title: '删除中', mask: true }])
  assert.equal(hidden, 1)
  assert.equal(ctx.data.swipedRowId, '')
})

test('prompt deletion hides loading and reports failure when the store throws', async () => {
  let hidden = 0
  const page = freshPage('instruction-settings', { items: () => items, remove: async () => { throw new Error('offline') } }, {
    showModal: ({ success }) => success({ confirm: true }),
    showLoading() {},
    hideLoading: () => { hidden += 1 }
  })
  const ctx = context(page, { swipedRowId: 'a', swipeOffset: -72 })
  await page.deleteItem.call(ctx, { currentTarget: { dataset: { id: 'a', type: 'action' } } })
  assert.equal(hidden, 1)
  assert.equal(ctx.data.mutating, false)
  assert.equal(ctx.data.error, '删除失败，请重试')
})

test('finishing prompt reorder shows a masked loading indicator until the network commit succeeds', async () => {
  const loading = []
  let hidden = 0
  const page = freshPage('instruction-settings', { items: () => items }, {
    showLoading: (options) => loading.push(options),
    hideLoading: () => { hidden += 1 }
  })
  const ctx = context(page, { reordering: true })
  ctx.dragController = { commit: async () => ({ ok: true }) }
  await page.finishReorder.call(ctx)
  assert.deepEqual(loading, [{ title: '保存中', mask: true }])
  assert.equal(hidden, 1)
  assert.equal(ctx.data.reordering, false)
})

test('finishing prompt reorder hides loading and keeps sorting available when the network commit throws', async () => {
  let hidden = 0
  const page = freshPage('instruction-settings', { items: () => items }, {
    showLoading() {},
    hideLoading: () => { hidden += 1 }
  })
  const ctx = context(page, { reordering: true })
  ctx.dragController = { commit: async () => { throw new Error('offline') } }
  await page.finishReorder.call(ctx)
  assert.equal(hidden, 1)
  assert.equal(ctx.data.mutating, false)
  assert.equal(ctx.data.reordering, true)
  assert.equal(ctx.data.error, '保存失败，请重试')
})

test('prompt list markup contains the screenshot hierarchy and import copy', () => {
  const root = path.join(__dirname, '..')
  const wxml = fs.readFileSync(path.join(root, 'pages/instruction-settings/index.wxml'), 'utf8')
  const header = wxml.match(/<page-header[\s\S]*?<\/page-header>/)[0]
  assert.match(header, /title="\{\{reordering \? '' : '提示词'\}\}"/)
  assert.match(header, /hideBack="\{\{reordering\}\}"/)
  assert.match(header, /slot="left"[\s\S]*wx:if="\{\{reordering\}\}"[\s\S]*bindtap="cancelReorder"[\s\S]*>取消</)
  assert.doesNotMatch(header, />取消排序</)
  assert.match(header, /slot="right"[\s\S]*>完成</)
  assert.doesNotMatch(wxml.replace(header, ''), /bindtap="cancelReorder"/)
  assert.match(wxml, /slot="right"[\s\S]*class="add-button"/)
  assert.match(wxml, /输入魔法数字导入/)
  assert.match(wxml, /恢复默认提示词/)
  assert.match(wxml, /新建动作[\s\S]*新建分组/)
  assert.match(wxml, /class="import-sheet"/)
  assert.match(wxml, /class="group-dialog"[\s\S]*新建分组/)
  assert.match(wxml, /placeholder="分组名字"/)
  const importSheet = wxml.match(/<view class="import-sheet"[\s\S]*?<\/view>\s*<\/view>\s*<\/view>/)
  assert.ok(importSheet)
  assert.doesNotMatch(importSheet[0], /class="sheet-handle"/)
  assert.match(wxml, /safeRightAction/)
  assert.match(wxml, /bindtouchend="rowTouchEnd"/)
  assert.match(wxml, /bindtouchmove="rowTouchMove"/)
  assert.match(wxml, /class="prompt-delete"[\s\S]*wx:if="\{\{item\.type === 'action'\}\}"[\s\S]*catchtap="deleteItem"/)
  const script = fs.readFileSync(path.join(root, 'pages/instruction-settings/index.js'), 'utf8')
  assert.match(script, /rowTouchEnd\(event\)/)
  const sharedHeader = fs.readFileSync(path.join(root, 'components/page-header/index.wxml'), 'utf8')
  assert.match(sharedHeader, /wx:if="\{\{!hideBack\}\}"/)
  assert.match(sharedHeader, /slot name="left"/)
  assert.match(sharedHeader, /wx:if="\{\{title\}\}"/)
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
  assert.match(wxml, /<page-header title="\{\{pageTitle\}\}" \/>/)
  assert.doesNotMatch(wxml, /titleAlign="left"/)
  assert.doesNotMatch(wxml, /slot="right"/)
  assert.match(wxml, /class="bottom-save[^\"]*"[\s\S]*bindtap="save"/)
  assert.match(wxml, /菜单里的名字/)
  assert.match(wxml, /class="apply-option/)
  assert.match(css, /\.bottom-save\s*\{[^}]*border-radius/s)
  assert.match(css, /\.bottom-save\s*\{[^}]*width:\s*320rpx;/s)
  assert.match(css, /\.bottom-save\s*\{[^}]*margin:\s*42rpx\s+auto\s+0/s)
  assert.match(wxml, /分享这条提示词/)
  assert.match(wxml, /open-type="share"/)
  assert.match(wxml, /分享的始终是已保存的版本/)
  assert.match(wxml, /wx:if="\{\{sharing && shareCode\}\}"/)
  assert.match(wxml, /ri-file-copy-line[\s\S]*复制数字/)
  assert.match(wxml, /ri-link[\s\S]*复制链接/)
  assert.match(wxml, /ri-share-box-line[\s\S]*分享…/)
  assert.match(css, /\.share-actions\s*\{[^}]*display:\s*flex/s)
  assert.match(css, /\.share-action\s*\{[^}]*background:\s*#f8e1d8/s)
})

test('prompt add button matches the home settings shortcut size in the capsule-safe slot', () => {
  const root = path.join(__dirname, '..')
  const css = fs.readFileSync(path.join(root, 'pages/instruction-settings/index.wxss'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'pages/instruction-settings/index.wxml'), 'utf8')
  const add = css.match(/\.add-button\s*\{([^}]*)\}/)
  assert.ok(add)
  assert.match(add[1], /width:\s*32px;/)
  assert.match(add[1], /height:\s*32px;/)
  assert.match(add[1], /border-radius:\s*8px;/)
  assert.match(wxml, /class="add-symbol">\+<\/text>/)
  assert.match(css, /\.add-symbol\s*\{[^}]*line-height:\s*32px;/s)
  assert.match(css, /\.add-symbol\s*\{[^}]*transform:\s*translateY\(-1px\);?/s)
})

test('new prompt uses the name, prompt, and two-card apply layout with a bottom save button', () => {
  const root = path.join(__dirname, '..')
  const wxml = fs.readFileSync(path.join(root, 'pages/prompt-new/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/prompt-new/index.wxss'), 'utf8')
  assert.match(wxml, /菜单里的名字/)
  assert.match(wxml, /class="field prompt-field"/)
  assert.match(wxml, /class="apply-option[^"]*"[\s\S]*文字/)
  assert.match(wxml, /class="apply-option[^"]*"[\s\S]*图片/)
  assert.match(wxml, /class="bottom-save[^"]*"[\s\S]*bindtap="save"/)
  assert.match(css, /\.apply-options\s*\{[^}]*display:\s*flex/s)
  assert.match(css, /\.apply-option\.selected\s*\{[^}]*border/s)
  assert.match(css, /\.bottom-save\s*\{[^}]*width:\s*320rpx;/s)
})

test('new prompt selects both text and image by default', () => {
  const page = freshPage('prompt-new')
  const ctx = context(page)
  page.onLoad.call(ctx, {})
  assert.equal(ctx.data.text, true)
  assert.equal(ctx.data.image, true)
})

test('new prompt persists through the prompt store and returns after a successful save', async () => {
  const added = []
  const backs = []
  const page = freshPage('prompt-new', {
    add: async (...args) => { added.push(args); return { ok: true } }
  }, { navigateBack: () => backs.push(true) })
  const ctx = context(page, { label: '图文润色', prompt: '优化这段内容', text: true, image: true })
  await page.save.call(ctx)
  assert.equal(added.length, 1)
  assert.equal(added[0][0].label, '图文润色')
  assert.deepEqual(added[0][0].appliesTo, ['text', 'image'])
  assert.equal(added[0][1], null)
  assert.deepEqual(backs, [true])
})
