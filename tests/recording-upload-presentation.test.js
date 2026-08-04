const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const recording = require('../utils/recording')

test('queued recording is presented as an uploading row until the server indexes it', () => {
  const source = [{ audioName: 'VoiceDrop-2026-07-26-120000-0m5s-Sun-Noon.m4a' }]
  const pending = [{ name: 'VoiceDrop-2026-07-27-120000-0m8s-Mon-Noon.m4a', tag: '工作' }]
  const knownNames = new Set(source.map((item) => item.audioName))
  const rows = pending
    .filter((item) => !knownNames.has(item.name))
    .map((item) => {
      const row = recording.fromRemoteFile({ name: item.name })
      row.uploading = true
      row.tags = item.tag ? [item.tag] : []
      row.statusLabel = recording.statusLabel(row)
      return row
    })

  assert.equal(rows.length, 1)
  assert.equal(rows[0].statusLabel, '正在上传')
  assert.deepEqual(rows[0].tags, ['工作'])
})

test('recordings page merges pending uploads before filtering and rendering rows', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'pages/recordings/index.js'), 'utf8')

  assert.match(source, /withPendingRecordingUploads\(records\)/)
  assert.match(source, /const records = this\.withPendingRecordingUploads\(await library\.list\(\)\)/)
  assert.match(source, /record\.uploading = true/)
  assert.match(source, /record\.localUpload = true/)
  assert.match(source, /onShow\(\)\s*\{\s*this\.showPendingRecordingUploads\(\)/)
  assert.match(source, /showPendingRecordingUploads\(\)/)
})
