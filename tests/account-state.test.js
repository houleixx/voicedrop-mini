const test = require('node:test')
const assert = require('node:assert/strict')

const accountState = require('../services/account-state')

test('account changes clear every pending cross-account operation but keep scoped caches', () => {
  const storage = {
    'voicedrop.commandqueue.default': 'queue',
    'voicedrop.commandcontrols.default': 'controls',
    'voicedrop.commandconfirms.default': 'confirms',
    'voicedrop.editqueue.VoiceDrop-a': 'edits',
    'voicedrop.library.meta.v1.old-account': 'scoped-cache'
  }
  const api = {
    getStorageInfoSync: () => ({ keys: Object.keys(storage) }),
    removeStorageSync: (key) => { delete storage[key] }
  }

  accountState.clearPendingAccountState(api)

  assert.deepEqual(storage, {
    'voicedrop.library.meta.v1.old-account': 'scoped-cache'
  })
})

test('account identity changes only when the bearer changes', () => {
  assert.equal(accountState.identityChanged('anon_old', 'anon_new'), true)
  assert.equal(accountState.identityChanged('anon_same', 'anon_same'), false)
})

test('account deletion clears all local storage before a fresh identity is created', () => {
  const storage = {
    'voicedrop.auth.anon': 'anon_old',
    'voicedrop.prompts.cache.v1.old': 'prompts',
    'voicedrop.library.meta.v1.old': 'library'
  }
  const api = {
    clearStorageSync: () => {
      Object.keys(storage).forEach((key) => { delete storage[key] })
    }
  }

  accountState.clearDeletedAccountState(api)

  assert.deepEqual(storage, {})
})
