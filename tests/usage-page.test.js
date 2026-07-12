const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

function freshUsagePage(usageOverrides, wxOverrides) {
  let page
  const usage = Object.assign({
    balance: async () => ({ suanli: 0, spent_suanli: 0 }),
    summary: async () => ({ granted: [], spent: [] }),
    ledger: async () => [],
    articleCapacity: (value) => Math.floor(value / 9)
  }, usageOverrides || {})

  global.Page = (definition) => {
    page = definition
  }
  global.wx = Object.assign({
    showToast: () => {}
  }, wxOverrides || {})

  delete require.cache[require.resolve('../pages/usage/index')]
  delete require.cache[require.resolve('../services/usage')]
  require.cache[require.resolve('../services/usage')] = { exports: usage }
  require('../pages/usage/index')
  return page
}

function pageContext(page) {
  return {
    data: Object.assign({}, page.data),
    setData(update) {
      Object.assign(this.data, update)
    }
  }
}

test('usage page renders summary sections without purchase UI', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/usage/index.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(root, 'pages/usage/index.js'), 'utf8')

  assert.match(wxml, /算力来源/)
  assert.match(wxml, /花费总结/)
  assert.match(wxml, /wx:if="\{\{hasSources\}\}"/)
  assert.match(wxml, /wx:if="\{\{hasSpendSummary\}\}"/)
  for (const hidden of ['包月', '¥19.9', '价格', '购买', '即将上线', 'comingSoon', 'subscription-card']) {
    assert.doesNotMatch(wxml, new RegExp(hidden))
    assert.doesNotMatch(js, new RegExp(hidden))
  }
})

test('usage page loads grant and spend summaries', async () => {
  const page = freshUsagePage({
    balance: async () => ({ suanli: 82, spent_suanli: 18 }),
    summary: async () => ({
      granted: [{ reason_code: 'signup', reason: '注册赠送', count: 1, suanli: 100 }],
      spent: [{ reason_code: 'article', reason: '生成文章', count: 2, suanli: 18 }]
    })
  })
  const ctx = pageContext(page)

  await page.load.call(ctx)

  assert.deepEqual(ctx.data.sources.map((row) => row.amountText), ['+100'])
  assert.deepEqual(ctx.data.spendSummary.map((row) => row.amountText), ['−18'])
  assert.equal(ctx.data.hasSources, true)
  assert.equal(ctx.data.hasSpendSummary, true)
})

test('usage page keeps balance and ledger when summary loading fails', async () => {
  const toasts = []
  const page = freshUsagePage({
    balance: async () => ({ suanli: 82, spent_suanli: 18 }),
    summary: async () => { throw new Error('summary unavailable') },
    ledger: async () => [{ id: 'entry-1', reason: '生成文章', suanli: -9 }]
  }, {
    showToast: (toast) => toasts.push(toast)
  })
  const ctx = pageContext(page)

  await page.load.call(ctx)

  assert.equal(ctx.data.balance.suanli, 82)
  assert.equal(ctx.data.balanceDisplay, '82')
  assert.equal(ctx.data.entries.length, 1)
  assert.deepEqual(ctx.data.sources, [])
  assert.deepEqual(ctx.data.spendSummary, [])
  assert.equal(ctx.data.hasSources, false)
  assert.equal(ctx.data.hasSpendSummary, false)
  assert.equal(toasts.some((toast) => toast.title === '加载失败'), false)
})
