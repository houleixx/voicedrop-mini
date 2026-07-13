const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')

function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  return match ? match[1] : ''
}

test('record button floats only on the recordings tab', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/recordings/index.wxss'), 'utf8')
  const dock = ruleBody(css, '.record-dock')
  const scroll = ruleBody(css, '.scroll-content')
  const inner = ruleBody(css, '.scroll-inner')
  const innerWithDock = ruleBody(css, '.scroll-inner.with-record-dock')

  assert.match(wxml, /<view\s+wx:if="\{\{activeTab === 'recordings'\}\}"\s+class="record-dock">/)
  assert.match(wxml, /class="scroll-inner \{\{activeTab === 'recordings' \? 'with-record-dock' : ''\}\}"/)
  assert.match(scroll, /bottom:\s*0;/)
  assert.match(inner, /padding:\s*0\s+32rpx\s+48rpx;/)
  assert.match(innerWithDock, /padding-bottom:\s*230rpx;/)
  assert.match(dock, /position:\s*fixed;/)
  assert.match(dock, /bottom:\s*42rpx;/)
  assert.match(dock, /pointer-events:\s*none;/)
})

test('record button status shows active command feedback above the button', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')

  assert.match(wxml, /wx:if="\{\{commandStatusText\}\}"/)
  assert.match(wxml, /\{\{commandStatusText\}\}/)
  assert.doesNotMatch(wxml, /wx:if="\{\{commandTalking && commandReply\}\}"/)
  assert.doesNotMatch(wxml, /bindtap="onMicTap"/)
  assert.doesNotMatch(wxml, /bindlongpress="onMicLongPress"/)
  assert.match(wxml, /bindtouchcancel="onMicTouchCancel"/)
  assert.match(js, /commandStatusText:\s*''/)
  assert.match(js, /refreshCommandStatus\(/)
  assert.match(js, /this\.commandSession\.connect\(\)/)
  assert.match(js, /waitForBestText\(3000\)/)
  assert.match(js, /this\.commandSession\.confirm\(id\)/)
  assert.match(js, /LONG_PRESS_MS:\s*350/)
  assert.match(js, /this\._micLongPressTimer = setTimeout/)
  assert.match(js, /this\._micTouchEndedBeforeCommandStart/)
  assert.match(js, /this\._skipRecorderStopCount/)
  assert.match(js, /active\.type === 'asr'/)
  assert.match(js, /active\.type !== 'recordings'/)
  assert.match(js, /app\.globalData\.activeRecorderSession = \{ type: 'asr', id: sessionId \}/)
  assert.match(js, /this\._activeAsrSessionId !== sessionId/)
  assert.doesNotMatch(js, /onMicTap\(\)/)
  assert.doesNotMatch(js, /onMicLongPress\(\)/)
  assert.doesNotMatch(js, /this\.commandTranscript\.accept\(text, isFinal\)/)
  assert.doesNotMatch(js, /title:\s*'确认图库指令'/)
  assert.doesNotMatch(js, /confirmText:\s*'执行'/)
  assert.doesNotMatch(js, /图库指令/)
})

test('recording tags are rendered in the top home tabs instead of a secondary tab row', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')

  assert.match(wxml, /<home-tabs current="\{\{currentHomeTab\}\}" tabs="\{\{homeTabs\}\}"/)
  assert.doesNotMatch(wxml, /class="tag-tabs"/)
  assert.doesNotMatch(wxml, /wx:for="\{\{homeTags\}\}"/)
  assert.match(js, /homeTabsFor\(homeTags\)/)
  assert.match(js, /key: `tag:\$\{tag\}`/)
  assert.match(js, /if \(key\.startsWith\('tag:'\)\)/)
  assert.match(js, /const currentHomeTab = this\.data\.activeTab === 'community'[\s\S]*\(selectedTag \? `tag:\$\{selectedTag\}` : 'recordings'\)/)
  assert.match(js, /return tags\.includes\(selected\) \? selected : ''/)
})

test('both home microphone paths require audio consent before WeChat permission', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/recordings/index.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
  const config = JSON.parse(fs.readFileSync(path.join(root, 'pages/recordings/index.json'), 'utf8'))

  assert.equal(config.usingComponents['audio-consent-dialog'], '/components/audio-consent-dialog/index')
  assert.match(wxml, /<audio-consent-dialog id="audio-consent-dialog"/)
  assert.match(js, /requestAudioConsent\(\)\s*\{[\s\S]*selectComponent\('#audio-consent-dialog'\)[\s\S]*\.request\(\)/)
  assert.match(js, /async startRecord\(\)\s*\{[\s\S]*if \(!await this\.requestAudioConsent\(\)\) return[\s\S]*wx\.authorize/)
  assert.match(js, /async _startLibraryCommandTalk\(\)\s*\{[\s\S]*if \(!await this\.requestAudioConsent\(\)\)[\s\S]*wx\.authorize/)
})

test('home voice command rechecks finger state after consent', () => {
  const js = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
  const method = js.match(/async _startLibraryCommandTalk\(\)\s*\{([\s\S]*?)\n  \},\n\n  _beginAsrSession/)

  assert.ok(method)
  const body = method[1]
  const consentIndex = body.indexOf('await this.requestAudioConsent()')
  const releaseIndex = body.indexOf('this._micTouchEndedBeforeCommandStart', consentIndex)
  const authorizeIndex = body.indexOf('wx.authorize', consentIndex)
  assert.ok(consentIndex >= 0)
  assert.ok(releaseIndex > consentIndex)
  assert.ok(authorizeIndex > releaseIndex)
})
