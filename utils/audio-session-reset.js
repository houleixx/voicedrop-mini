function writeAscii(bytes, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    bytes[offset + index] = text.charCodeAt(index)
  }
}

function silentWav(durationMs) {
  const sampleRate = 8000
  const channels = 1
  const bitsPerSample = 16
  const samples = Math.max(1, Math.round(sampleRate * Math.max(1, Number(durationMs) || 50) / 1000))
  const dataLength = samples * channels * bitsPerSample / 8
  const buffer = new ArrayBuffer(44 + dataLength)
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  writeAscii(bytes, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeAscii(bytes, 8, 'WAVE')
  writeAscii(bytes, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * bitsPerSample / 8, true)
  view.setUint16(32, channels * bitsPerSample / 8, true)
  view.setUint16(34, bitsPerSample, true)
  writeAscii(bytes, 36, 'data')
  view.setUint32(40, dataLength, true)
  return buffer
}

function resetAfterRecording(wxApi, runtime) {
  const api = wxApi || (typeof wx === 'undefined' ? null : wx)
  const clock = runtime || {}
  const setDelay = clock.setTimeout || setTimeout
  const clearDelay = clock.clearTimeout || clearTimeout
  if (!api || !api.env || !api.env.USER_DATA_PATH || !api.getFileSystemManager || !api.createInnerAudioContext) {
    return Promise.resolve(false)
  }

  const path = `${api.env.USER_DATA_PATH}/voicedrop-audio-session-reset.wav`
  try {
    api.getFileSystemManager().writeFileSync(path, silentWav(50))
  } catch (_) {
    return Promise.resolve(false)
  }

  if (api.setInnerAudioOption) {
    try {
      api.setInnerAudioOption({ speakerOn: false, mixWithOther: true, fail() {} })
    } catch (_) {
    }
  }

  let player
  try {
    player = api.createInnerAudioContext()
    player.volume = 0
    player.loop = false
    player.obeyMuteSwitch = true
    player.src = path
  } catch (_) {
    if (player && player.destroy) player.destroy()
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const done = () => {
      if (settled) return
      settled = true
      if (timer) clearDelay(timer)
      try { if (player.destroy) player.destroy() } catch (_) {}
      resolve(true)
    }
    if (player.onEnded) player.onEnded(done)
    if (player.onError) player.onError(done)
    timer = setDelay(done, 300)
    try {
      player.play()
    } catch (_) {
      done()
    }
  })
}

function preparePlayback(wxApi) {
  const api = wxApi || (typeof wx === 'undefined' ? null : wx)
  if (!api || !api.setInnerAudioOption) return false
  try {
    api.setInnerAudioOption({ speakerOn: true, mixWithOther: false, fail() {} })
    return true
  } catch (_) {
    return false
  }
}

module.exports = {
  silentWav,
  resetAfterRecording,
  preparePlayback
}
