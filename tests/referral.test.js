const test = require('node:test')
const assert = require('node:assert/strict')

global.wx = global.wx || {}
const referral = require('../services/referral')

test('extracts mini program invite attribution from query and scene', () => {
  assert.equal(referral.codeFromLaunch({ query: { inviteCode: 'AbC123xy' } }), 'AbC123xy')
  assert.equal(referral.codeFromLaunch({ query: { scene: encodeURIComponent('inviteCode=ZXCVBN') } }), 'ZXCVBN')
  assert.equal(referral.codeFromLaunch({ query: { scene: 'QWERTY' } }), 'QWERTY')
  assert.equal(referral.codeFromLaunch({ query: { inviteCode: '../bad' } }), '')
})

test('mini program hides the outgoing invite feature while keeping incoming attribution', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.join(__dirname, '..')
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  const settings = fs.readFileSync(path.join(root, 'pages/settings/index.wxml'), 'utf8')
  const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8')
  assert.equal(app.pages.includes('pages/invite/index'), false)
  assert.doesNotMatch(settings, /邀请好友|\/pages\/invite\/index/)
  assert.match(appSource, /handleReferral\(options\)/)
})
