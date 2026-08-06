const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const blockedKey = 'vd.blockedAuthors'

function freshBlockedUsers(initialAuthors) {
  const storage = {}
  if (initialAuthors) storage[blockedKey] = initialAuthors.slice()
  const toasts = []
  const app = { globalData: {} }
  let page

  global.getApp = () => app
  global.Page = (definition) => { page = definition }
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value },
    showToast: (toast) => toasts.push(toast)
  }
  ;['../pages/blocked-users/index', '../utils/block-store'].forEach((id) => {
    delete require.cache[require.resolve(id)]
  })
  require('../pages/blocked-users/index')
  const ctx = Object.assign({}, page, {
    data: Object.assign({}, page.data),
    setData(update) { Object.assign(this.data, update) }
  })
  return { page, ctx, storage, toasts, app }
}

test('blocked-user page loads sorted local authors', () => {
  const h = freshBlockedUsers(['Bob', 'Alice'])

  h.page.onShow.call(h.ctx)

  assert.deepEqual(h.ctx.data.blockedAuthors, ['Alice', 'Bob'])
})

test('blocked-user page unblocks an author and refreshes the list', () => {
  const h = freshBlockedUsers(['Alice', 'Bob'])

  h.page.onShow.call(h.ctx)
  h.page.unblock.call(h.ctx, { currentTarget: { dataset: { author: 'Alice' } } })

  assert.deepEqual(h.ctx.data.blockedAuthors, ['Bob'])
  assert.deepEqual(h.storage[blockedKey], ['Bob'])
  assert.deepEqual(h.toasts, [{ title: '已取消屏蔽' }])
  assert.equal(h.app.globalData.communityFeedDirty, true)
})

test('blocked-user page keeps an explicit empty state', () => {
  const h = freshBlockedUsers()
  const markup = fs.readFileSync(path.join(root, 'pages/blocked-users/index.wxml'), 'utf8')

  h.page.onShow.call(h.ctx)

  assert.deepEqual(h.ctx.data.blockedAuthors, [])
  assert.match(markup, /wx:if="\{\{blockedAuthors\.length === 0\}\}"[\s\S]*没有已屏蔽的作者/)
})
