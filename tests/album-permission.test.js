const test = require('node:test')
const assert = require('node:assert/strict')

const albumPermission = require('../utils/album-permission')

test('album permission continues without prompting when write access is granted', async () => {
  let authorized = false
  const wxApi = {
    getSetting({ success }) { success({ authSetting: { 'scope.writePhotosAlbum': true } }) },
    authorize() { authorized = true }
  }
  assert.equal(await albumPermission.ensure(wxApi), true)
  assert.equal(authorized, false)
})

test('album permission requests write access before saving an image', async () => {
  let scope = ''
  const wxApi = {
    getSetting({ success }) { success({ authSetting: {} }) },
    authorize(options) { scope = options.scope; options.success() }
  }
  assert.equal(await albumPermission.ensure(wxApi), true)
  assert.equal(scope, 'scope.writePhotosAlbum')
})

test('album permission offers settings after a previous denial', async () => {
  const calls = []
  const wxApi = {
    getSetting({ success }) { success({ authSetting: { 'scope.writePhotosAlbum': false } }) },
    authorize({ fail }) { fail() },
    showModal({ success }) { calls.push('modal'); success({ confirm: true }) },
    openSetting({ success }) { calls.push('settings'); success({ authSetting: { 'scope.writePhotosAlbum': true } }) }
  }
  assert.equal(await albumPermission.ensure(wxApi), true)
  assert.deepEqual(calls, ['modal', 'settings'])
})
