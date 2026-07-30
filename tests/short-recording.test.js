const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const recordPage = fs.readFileSync(path.join(root, 'pages/record/index.js'), 'utf8')
const recordingsPage = fs.readFileSync(path.join(root, 'pages/recordings/index.js'), 'utf8')
const communityDetailPage = fs.readFileSync(path.join(root, 'pages/community-detail/index.js'), 'utf8')

test('all recording entry points reject short audio before persistence or upload', () => {
  assert.ok(recordPage.indexOf('recordingQuality.isTooShort(durationSeconds)') <
    recordPage.indexOf('this.finalizePcmFile(res.tempFilePath'))
  assert.ok(recordingsPage.indexOf('recordingQuality.isTooShort(durationSeconds)') <
    recordingsPage.indexOf('await audio.uploadFile(res.tempFilePath, name)'))
  assert.ok(communityDetailPage.indexOf('recordingQuality.isTooShort(durationSeconds)') <
    communityDetailPage.indexOf('await audio.uploadFile(res.tempFilePath, name)'))
})

test('normal and community recording flows show the shared too-short explanation', () => {
  assert.match(recordPage, /title: '录音太短'[\s\S]*时间太短，不足以产生文章，这条录音不会上传。/)
  assert.match(recordingsPage, /title: '录音太短'[\s\S]*时间太短，不足以产生文章，这条录音不会上传。/)
  assert.match(communityDetailPage, /时间太短，不足以产生文章/)
})
