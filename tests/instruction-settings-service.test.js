const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('runtime source no longer requests removed ui-config endpoints', () => {
  const root = path.join(__dirname, '..')
  for (const relative of ['services/ui-config.js', 'services/instruction-settings.js', 'services/prompt-store.js', 'pages/detail/index.js', 'pages/instruction-settings/index.js', 'pages/instruction-edit/index.js']) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8')
    assert.doesNotMatch(source, /\/agent\/ui-config|\/ui-config\/custom/, relative)
  }
})

test('compatibility services delegate to PromptStore', () => {
  const settings = fs.readFileSync(path.join(__dirname, '../services/instruction-settings.js'), 'utf8')
  const config = fs.readFileSync(path.join(__dirname, '../services/ui-config.js'), 'utf8')
  assert.match(settings, /require\('\.\/prompt-store'\)/)
  assert.match(config, /require\('\.\/prompt-store'\)/)
})
