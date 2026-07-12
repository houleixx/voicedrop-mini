// Volc ASR real-time dictation session
// Ported from Android VolcASRProtocol.java
// Reference: VoiceDrop Android VolcASRProtocol.java

const api = require('./api')
const auth = require('./auth')
const http = require('./request')

// Manual UTF-8 encoder (TextEncoder not available in WeChat Mini Programs)
function utf8Encode(str) {
  const bytes = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 0x80) {
      bytes.push(c)
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    } else {
      // Surrogate pair
      i++
      c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff))
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f)
      )
    }
  }
  return new Uint8Array(bytes)
}

// Manual UTF-8 decoder (TextDecoder not available in WeChat Mini Programs)
function utf8Decode(bytes) {
  let str = ''
  let i = 0
  while (i < bytes.length) {
    const b1 = bytes[i++]
    if (b1 < 0x80) {
      str += String.fromCharCode(b1)
    } else if (b1 < 0xe0) {
      str += String.fromCharCode(((b1 & 0x1f) << 6) | (bytes[i++] & 0x3f))
    } else if (b1 < 0xf0) {
      str += String.fromCharCode(((b1 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f))
    } else {
      const c = ((b1 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
      str += String.fromCharCode(0xd800 + ((c - 0x10000) >> 10), 0xdc00 + ((c - 0x10000) & 0x3ff))
    }
  }
  return str
}

// Message types
const FULL_CLIENT = 0x1
const AUDIO_ONLY = 0x2
const FULL_SERVER = 0x9
const ERROR_RESPONSE = 0xf

// Sequence flags
const POSITIVE_SEQUENCE = 0x1
const NEGATIVE_SEQUENCE = 0x3

// Serialization / compression
const JSON_SERIALIZATION = 0x1
const NO_SERIALIZATION = 0x0
const GZIP_COMPRESSION = 0x1
const NO_COMPRESSION = 0x0

function jsonEscape(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\b/g, '\\b')
    .replace(/\f/g, '\\f')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

function gzip(data) {
  if (typeof pako !== 'undefined' && pako.gzip) {
    return pako.gzip(data)
  }
  // Fallback: send uncompressed
  return data
}

function gunzip(data) {
  if (typeof pako !== 'undefined' && pako.ungzip) {
    try {
      return pako.ungzip(data)
    } catch (e) {
      return data
    }
  }
  return data
}

function buildFrame(messageType, flags, serialization, compression, sequence, payload) {
  const headerSize = 12
  // Ensure payload is a Uint8Array (frameBuffer from onFrameRecorded is ArrayBuffer)
  const payloadBytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
  const buffer = new ArrayBuffer(headerSize + payloadBytes.length)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // Byte 0: magic
  bytes[0] = 0x11
  // Byte 1: (messageType << 4) | flags
  bytes[1] = ((messageType << 4) | flags) & 0xff
  // Byte 2: (serialization << 4) | compression
  bytes[2] = ((serialization << 4) | compression) & 0xff
  // Byte 3: reserved
  bytes[3] = 0
  // Bytes 4-7: sequence (big-endian int32)
  view.setInt32(4, sequence, false)
  // Bytes 8-11: payload length (big-endian int32)
  view.setInt32(8, payloadBytes.length, false)
  // Payload
  bytes.set(payloadBytes, headerSize)

  return buffer
}

function buildFullClientPayload(userId, sampleRate) {
  const payload = JSON.stringify({
    user: { uid: jsonEscape(userId) },
    audio: { format: 'pcm', rate: sampleRate, bits: 16, channel: 1, codec: 'raw' },
    request: { model_name: 'bigmodel', enable_punc: true, enable_itn: true, show_utterances: true }
  })
  const jsonBytes = utf8Encode(payload)
  // Send uncompressed (NO_COMPRESSION = 0x0)
  return buildFrame(FULL_CLIENT, POSITIVE_SEQUENCE, JSON_SERIALIZATION, NO_COMPRESSION, 1, jsonBytes)
}

function buildAudioPayload(pcmBytes, sequence, isLast) {
  const seq = isLast ? -Math.abs(sequence) : Math.abs(sequence)
  const flags = isLast ? NEGATIVE_SEQUENCE : POSITIVE_SEQUENCE
  // Send uncompressed (NO_COMPRESSION = 0x0)
  return buildFrame(AUDIO_ONLY, flags, NO_SERIALIZATION, NO_COMPRESSION, seq, pcmBytes)
}

function parseServerMessage(buffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 8) return { text: '', isFinal: true, isError: true, errorCode: null, errorMessage: 'ASR response too short' }

  const messageType = (bytes[1] >> 4) & 0x0f
  const flags = bytes[1] & 0x0f
  const serialization = (bytes[2] >> 4) & 0x0f
  const compression = bytes[2] & 0x0f

  let offset = 4
  if ((flags & 0x01) !== 0 || (flags & 0x02) !== 0) offset += 4

  if (messageType === ERROR_RESPONSE) {
    if (bytes.length < offset + 8) return { text: '', isFinal: true, isError: true, errorCode: null, errorMessage: 'ASR error response too short' }
    const view = new DataView(buffer)
    const code = view.getUint32(offset)
    const size = view.getInt32(offset + 4)
    const body = bytes.slice(offset + 8, offset + 8 + Math.max(0, size))
    return { text: '', isFinal: true, isError: true, errorCode: code, errorMessage: `ASR error ${code}` }
  }

  if (messageType !== FULL_SERVER || bytes.length < offset + 4) {
    return { text: '', isFinal: (flags & 0x02) !== 0, isError: false, errorCode: null, errorMessage: null }
  }

  const view = new DataView(buffer)
  const size = view.getInt32(offset)
  const body = bytes.slice(offset + 4, offset + 4 + Math.max(0, size))

  if (serialization !== JSON_SERIALIZATION) {
    return { text: '', isFinal: (flags & 0x02) !== 0, isError: false, errorCode: null, errorMessage: null }
  }

  try {
    const text = utf8Decode(body)
    const obj = JSON.parse(text)
    const result = obj && obj.result
    let asrText = ''
    if (result) {
      asrText = result.text || ''
      if (!asrText && result.utterances) {
        asrText = result.utterances.map(u => u.text || '').join('')
      }
    }
    return { text: asrText, isFinal: (flags & 0x02) !== 0, isError: false, errorCode: null, errorMessage: null }
  } catch (e) {
    return { text: '', isFinal: (flags & 0x02) !== 0, isError: false, errorCode: null, errorMessage: null }
  }
}

function createSession(handlers) {
  let socket = null
  let closed = false
  let socketOpen = false
  let ready = false
  let sequence = 0
  let sampleRate = 16000
  const pendingAudio = []
  const maxPendingAudioFrames = 80

  function socketReadyStateOpen() {
    return socket && (typeof socket.readyState !== 'number' || socket.readyState === 1)
  }

  function safeSend(data) {
    if (!socket || closed || !socketOpen || !socketReadyStateOpen()) return false
    let failed = false
    try {
      socket.send({
        data,
        fail: () => {
          failed = true
        }
      })
      return !failed
    } catch (e) {
      return false
    }
  }

  function flushPendingAudio() {
    if (!ready) return
    while (pendingAudio.length && ready) {
      const item = pendingAudio.shift()
      sendAudio(item.pcmBytes, item.isLast)
    }
  }

  function queueAudio(pcmBytes, isLast) {
    pendingAudio.push({ pcmBytes, isLast: !!isLast })
    while (pendingAudio.length > maxPendingAudioFrames) pendingAudio.shift()
  }

  function connect() {
    if (closed || socket) return
    // ASR WebSocket uses the same auth as other API calls
    // In WeChat Mini Programs, the WebSocket needs proper auth header
    const headers = {}
    const token = auth.bearer()
    if (token) headers.Authorization = `Bearer ${token}`
    // Add platform header for server-side routing
    headers['X-VD-Platform'] = 'miniapp'

    socket = wx.connectSocket({
      url: `${api.agentWs()}/asr`,
      header: headers
    })

    socket.onOpen(() => {
      socketOpen = true
      let attempts = 0
      const retryDelays = [80, 160, 320, 640, 1000, 1500, 2000]
      const sendConfig = () => {
        if (closed || !socket) return
        // Use same userId as Android for compatibility
        const configFrame = buildFullClientPayload('voicedrop-android-edit', sampleRate)
        if (safeSend(configFrame)) {
          ready = true
          if (handlers.onState) handlers.onState('正在听写…')
          flushPendingAudio()
          return
        }
        attempts++
        if (attempts <= retryDelays.length) {
          setTimeout(sendConfig, retryDelays[attempts - 1])
        } else {
          if (handlers.onError) handlers.onError('ASR 连接失败')
        }
      }
      sendConfig()
    })

    socket.onMessage((message) => {
      const parsed = parseServerMessage(message.data)
      if (parsed.isError) {
        if (handlers.onError) handlers.onError(parsed.errorMessage || `ASR 错误 ${parsed.errorCode}`)
        return
      }
      if (parsed.text && handlers.onText) {
        handlers.onText(parsed.text, parsed.isFinal)
      }
      if (parsed.isFinal && handlers.onState) {
        handlers.onState('听写完成')
      }
    })

    socket.onError((error) => {
      socket = null
      socketOpen = false
      ready = false
      if (!closed && handlers.onError) handlers.onError('听写连接断开')
    })

    socket.onClose(() => {
      socket = null
      socketOpen = false
      ready = false
    })
  }

  function sendAudio(pcmBytes, isLast) {
    if (!socket || closed) return
    if (!ready) {
      queueAudio(pcmBytes, isLast)
      return
    }
    // Audio frames start from sequence 2 (config frame = 1)
    sequence = Math.max(2, sequence + 1)
    const frame = buildAudioPayload(pcmBytes, sequence, !!isLast)
    if (!safeSend(frame)) {
      ready = false
      queueAudio(pcmBytes, isLast)
    }
  }

  function finish() {
    if (!socket || closed) return
    // Send empty final frame
    sendAudio(new Uint8Array(0), true)
  }

  function close() {
    closed = true
    socketOpen = false
    ready = false
    pendingAudio.length = 0
    if (socket) socket.close({ code: 1000, reason: 'bye' })
    socket = null
  }

  return { connect, sendAudio, finish, close }
}

module.exports = {
  buildFullClientPayload,
  buildAudioPayload,
  parseServerMessage,
  createSession
}
