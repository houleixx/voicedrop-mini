const nacl = require('tweetnacl')
const { gcm } = require('@noble/ciphers/aes')
const { hkdf } = require('@noble/hashes/hkdf')
const { sha256 } = require('@noble/hashes/sha256')

module.exports = { nacl, gcm, hkdf, sha256 }
