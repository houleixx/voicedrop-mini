// Compatibility facade for older imports. PromptStore owns all runtime data and requests.
const promptStore = require('./prompt-store')

async function refresh() {
  await promptStore.refresh()
  return { text: promptStore.menu('text'), image: promptStore.menu('image') }
}

module.exports = { refresh, cached: () => ({ text: promptStore.menu('text'), image: promptStore.menu('image') }) }
