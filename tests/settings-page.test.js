const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

function freshSettingsPage(settingsOverrides, wxOverrides) {
  let page
  const settings = Object.assign({
    loadStyle: async () => ({ style: '', name: '', styles: [] }),
    loadConfig: async () => ({}),
    loadWechat: async () => ({}),
    saveConfig: async () => true,
    saveName: async () => true
  }, settingsOverrides || {})
  const usage = {
    balance: async () => ({ suanli: 0 }),
    articleCapacity: (value) => Math.floor(value / 10)
  }
  const auth = {
    anonId: () => 'anon-123456'
  }
  const prefs = {
    followUpEnabled: () => true,
    setFollowUpEnabled: () => {}
  }

  global.Page = (definition) => {
    page = definition
  }
  global.wx = Object.assign({
    showToast: () => {},
    navigateTo: () => {}
  }, wxOverrides || {})

  delete require.cache[require.resolve('../pages/settings/index')]
  delete require.cache[require.resolve('../services/settings')]
  delete require.cache[require.resolve('../services/usage')]
  delete require.cache[require.resolve('../services/auth')]
  delete require.cache[require.resolve('../utils/prefs')]
  delete require.cache[require.resolve('../utils/app-version')]
  require.cache[require.resolve('../services/settings')] = { exports: settings }
  require.cache[require.resolve('../services/usage')] = { exports: usage }
  require.cache[require.resolve('../services/auth')] = { exports: auth }
  require.cache[require.resolve('../utils/prefs')] = { exports: prefs }
  require('../pages/settings/index')
  return page
}

function pageContext(page, initialData) {
  return {
    data: Object.assign({}, page.data, initialData || {}),
    setData(update) {
      Object.assign(this.data, update)
    }
  }
}

test('settings page hides follow-up toggle', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/settings/index.wxml'), 'utf8')

  assert.doesNotMatch(wxml, /成文后追问/)
  assert.doesNotMatch(wxml, /AI 追问一两个细节/)
  assert.doesNotMatch(wxml, /toggleFollowUp/)
})

test('settings page exposes Android-style profile name editor', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/settings/index.wxml'), 'utf8')

  assert.match(wxml, /bindtap="openNameEditor"[\s\S]*名字/)
  assert.match(wxml, /class="name-card-icon"[\s\S]*class="name-card-avatar"[\s\S]*class="name-card-lines"/)
  assert.doesNotMatch(wxml, /<text class="menu-icon-text">人<\/text>/)
  assert.match(wxml, /文章署名，以及挖文章时对你的称呼/)
  assert.match(wxml, /\{\{profileName \|\| ''\}\}/)
  assert.match(wxml, /wx:if="\{\{nameEditorOpen\}\}"/)
  assert.match(wxml, /bindtap="saveName"[\s\S]*完成/)
})

test('settings page links to prompt customization', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/settings/index.wxml'), 'utf8')
  assert.match(wxml, /data-url="\/pages\/instruction-settings\/index"/)
  assert.match(wxml, />提示词</)
  assert.match(wxml, /自定义长按菜单里的每个动作/)
})

test('settings page uses Remix Icon instead of platform glyphs', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/settings/index.wxml'), 'utf8')
  const expectedIcons = [
    'ri-user-line',
    'ri-flashlight-line',
    'ri-quill-pen-line',
    'ri-magic-line',
    'ri-wechat-line',
    'ri-team-line',
    'ri-information-line',
    'ri-arrow-right-s-line'
  ]

  expectedIcons.forEach((icon) => assert.match(wxml, new RegExp(`\\b${icon}\\b`)))
  assert.doesNotMatch(wxml, /[✓⚡✎✦➤☻ℹ›]/)
})

test('profile name editor lifts above the keyboard while focused', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/settings/index.wxml'), 'utf8')

  assert.match(wxml, /class="dialog-overlay"[^>]+style="padding-bottom: \{\{nameKeyboardHeight \? nameKeyboardHeight \+ 44 : 44\}\}px;"/)
  assert.match(wxml, /bindkeyboardheightchange="onNameKeyboardHeightChange"/)
  assert.match(wxml, /adjust-position="\{\{false\}\}"/)
})

test('settings page loads current profile name from style endpoint', async () => {
  const page = freshSettingsPage({
    loadStyle: async () => ({ style: '短句', name: '王小明', styles: [] })
  })
  const ctx = pageContext(page)

  await page.load.call(ctx)

  assert.equal(ctx.data.profileName, '王小明')
  assert.equal(ctx.data.nameInput, '王小明')
})

test('settings about entry shows the current release version', async () => {
  const page = freshSettingsPage({}, {
    getAccountInfoSync: () => ({
      miniProgram: { envVersion: 'release', version: '1.2.3' }
    })
  })
  const ctx = pageContext(page)

  await page.load.call(ctx)

  assert.equal(ctx.data.appVersion, '1.2.3')
  const wxml = fs.readFileSync(path.join(root, 'pages/settings/index.wxml'), 'utf8')
  assert.match(wxml, />当前版本\s+\{\{appVersion\}\}</)
})

test('settings page trims and limits profile name before saving', async () => {
  const saves = []
  const toasts = []
  const longName = '  这是一段超过二十个字的用户名字用于测试截断  '
  const expectedName = longName.trim().slice(0, 20)
  const page = freshSettingsPage({
    saveName: async (name) => {
      saves.push(name)
      return true
    }
  }, {
    showToast: (toast) => toasts.push(toast)
  })
  const ctx = pageContext(page, {
    nameEditorOpen: true,
    nameInput: longName
  })

  await page.saveName.call(ctx)

  assert.deepEqual(saves, [expectedName])
  assert.equal(ctx.data.profileName, expectedName)
  assert.equal(ctx.data.nameInput, expectedName)
  assert.equal(ctx.data.nameEditorOpen, false)
  assert.equal(ctx.data.nameSaving, false)
  assert.deepEqual(toasts, [{ title: '名字已保存', icon: 'success' }])
})

test('settings page stores keyboard height for the name editor overlay', () => {
  const page = freshSettingsPage()
  const ctx = pageContext(page)

  page.onNameKeyboardHeightChange.call(ctx, { detail: { height: 312 } })
  assert.equal(ctx.data.nameKeyboardHeight, 312)

  page.onNameKeyboardHeightChange.call(ctx, { detail: { height: 0 } })
  assert.equal(ctx.data.nameKeyboardHeight, 0)

  page.onNameKeyboardHeightChange.call(ctx, { detail: { height: -20 } })
  assert.equal(ctx.data.nameKeyboardHeight, 0)
})
