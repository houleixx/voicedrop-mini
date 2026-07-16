const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function loadPage(store, wxOverrides = {}) {
  let page
  global.Page = (definition) => { page = definition }
  global.wx = Object.assign({ showToast() {}, navigateBack() {} }, wxOverrides)
  delete require.cache[require.resolve('../pages/prompt-import/index')]
  require.cache[require.resolve('../services/prompt-store')] = { exports: store }
  require('../pages/prompt-import/index')
  return page
}

function context(page, initial) {
  return Object.assign({}, page, { data: Object.assign({}, page.data, initial), setData(update) { Object.assign(this.data, update) } })
}

test('import page extracts pasted links, rejects eight digits, previews, and imports', async () => {
  const calls = []
  const page = loadPage({
    preview: async (code) => { calls.push(['preview', code]); return { ok: true, data: { label: '共享', prompt: 'P' } } },
    importCode: async (code) => { calls.push(['import', code]); return { ok: true } }
  })
  const ctx = context(page, { code: '12' })
  assert.equal(page.onCodeInput.call(ctx, { detail: { value: '12345678' } }), '12')
  assert.equal(page.onCodeInput.call(ctx, { detail: { value: 'https://voicedrop.cn/7654321' } }), '7654321')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls[0], ['preview', '7654321'])
  await page.confirmImport.call(ctx)
  assert.deepEqual(calls[1], ['import', '7654321'])
})

test('import page preserves code and exposes preview failure', async () => {
  const page = loadPage({ preview: async () => ({ ok: false, error: 'not_found' }), importCode: async () => ({ ok: false }) })
  const ctx = context(page, { code: '1234567' })
  await page.loadPreview.call(ctx, '1234567')
  assert.equal(ctx.data.code, '1234567')
  assert.equal(ctx.data.error, '分享码无效或已停止分享')
})

test('independent import page uses the shared primary action and sends header back to home', () => {
  const root = path.join(__dirname, '..')
  const wxml = fs.readFileSync(path.join(root, 'pages/prompt-import/index.wxml'), 'utf8')
  assert.match(wxml, /<page-header[^>]*backToHome/)
  assert.match(wxml, /class="primary import-button"/)
})

test('page header relaunches home only when backToHome is enabled', () => {
  let component
  const calls = []
  global.Component = (definition) => { component = definition }
  global.wx = {
    reLaunch: ({ url }) => calls.push(['reLaunch', url]),
    navigateBack: ({ delta }) => calls.push(['navigateBack', delta])
  }
  delete require.cache[require.resolve('../components/page-header/index')]
  require('../components/page-header/index')

  component.methods.goBack.call({ data: { backToHome: true } })
  component.methods.goBack.call({ data: { backToHome: false } })
  assert.deepEqual(calls, [
    ['reLaunch', '/pages/recordings/index'],
    ['navigateBack', 1]
  ])
})
