function parse(raw) {
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (error) {
    return null
  }
}

function status(raw) {
  const obj = parse(raw)
  if (!obj || obj.type !== 'status_update' || !obj.stem || !obj.status) return null
  return { stem: obj.stem, status: obj.status }
}

function update(raw) {
  const obj = parse(raw)
  if (!obj || obj.type !== 'updated') return null
  const doc = obj.doc || obj.article
  return doc ? { docJson: typeof doc === 'string' ? doc : JSON.stringify(doc) } : null
}

function linkRequest(raw) {
  const obj = parse(raw)
  if (!obj || obj.type !== 'link_request' || !obj.pairingId || !obj.code || !obj.pubkey) return null
  return { pairingId: obj.pairingId, code: obj.code, pubkey: obj.pubkey }
}

function linkRelease(raw) {
  const obj = parse(raw)
  if (!obj || obj.type !== 'link_release' || !obj.pairingId) return null
  return { pairingId: obj.pairingId }
}

module.exports = {
  status,
  update,
  linkRequest,
  linkRelease
}
