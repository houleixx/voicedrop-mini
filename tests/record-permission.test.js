const test = require('node:test')
const assert = require('node:assert/strict')

const recordPermission = require('../utils/record-permission')

test('record permission continues immediately when scope.record is granted', async () => {
  let authorized = false
  const wxApi = {
    getSetting({ success }) {
      success({ authSetting: { 'scope.record': true } })
    },
    authorize() {
      authorized = true
    }
  }

  assert.equal(await recordPermission.ensure(wxApi), true)
  assert.equal(authorized, false)
})

test('record permission requests scope.record when it has not been decided', async () => {
  let requestedScope = ''
  const wxApi = {
    getSetting({ success }) {
      success({ authSetting: {} })
    },
    authorize({ scope, success }) {
      requestedScope = scope
      success()
    }
  }

  assert.equal(await recordPermission.ensure(wxApi), true)
  assert.equal(requestedScope, 'scope.record')
})

test('record permission opens settings after denial and continues only when granted there', async () => {
  const calls = []
  const wxApi = {
    getSetting({ success }) {
      success({ authSetting: { 'scope.record': false } })
    },
    authorize({ fail }) {
      fail({ errMsg: 'authorize:fail auth deny' })
    },
    showModal({ title, confirmText, success }) {
      calls.push(['modal', title, confirmText])
      success({ confirm: true })
    },
    openSetting({ success }) {
      calls.push(['settings'])
      success({ authSetting: { 'scope.record': true } })
    }
  }

  assert.equal(await recordPermission.ensure(wxApi), true)
  assert.deepEqual(calls, [
    ['modal', '需要录音权限', '去设置'],
    ['settings']
  ])
})

test('record permission fails closed when platform authorization APIs fail', async () => {
  let modalShown = false
  const wxApi = {
    getSetting({ fail }) {
      fail({ errMsg: 'getSetting:fail' })
    },
    authorize({ fail }) {
      fail({ errMsg: 'authorize:fail' })
    },
    showModal({ success }) {
      modalShown = true
      success({ cancel: true })
    }
  }

  assert.equal(await recordPermission.ensure(wxApi), false)
  assert.equal(modalShown, true)
})
