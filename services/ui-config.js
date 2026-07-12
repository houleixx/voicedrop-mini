const api = require('./api')
const auth = require('./auth')
const http = require('./request')
const uiConfig = require('../utils/ui-config')

async function refresh() {
  const res = await http.get(`${api.agentBase()}/ui-config`, auth.bearer())
  if (res.statusCode < 200 || res.statusCode >= 300) return uiConfig.cached()
  const doc = uiConfig.parseDoc(res.data)
  uiConfig.cache(doc)
  return doc
}

module.exports = {
  refresh,
  cached: uiConfig.cached
}
