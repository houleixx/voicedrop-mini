const OUTPUT_RATE = 24000

function createPlayer(handlers, injected) {
  const callbacks = handlers || {}
  const wxApi = (injected && injected.wx) || (typeof wx !== 'undefined' ? wx : {})
  let context = null
  let nextStart = 0
  let generation = 0
  const sources = new Set()

  function ensureContext() {
    if (context) return context
    if (!wxApi.createWebAudioContext) {
      throw new Error('当前微信版本不支持 AI 语音播放')
    }
    context = wxApi.createWebAudioContext()
    nextStart = context.currentTime
    return context
  }

  function resetPlayback() {
    generation += 1
    sources.forEach((source) => {
      try {
        source.stop()
      } catch (_) {}
    })
    sources.clear()
    const oldContext = context
    context = null
    nextStart = 0
    if (oldContext) {
      try {
        const closing = oldContext.close()
        if (closing && typeof closing.catch === 'function') closing.catch(() => {})
      } catch (_) {}
    }
  }

  function fail(error) {
    resetPlayback()
    if (callbacks.onError) {
      try {
        callbacks.onError(error && error.message ? error.message : 'AI 语音播放失败')
      } catch (_) {}
    }
    return false
  }

  function enqueue(input) {
    try {
      const ctx = ensureContext()
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0)
      if (bytes.byteLength < 2) return false
      const count = Math.floor(bytes.byteLength / 2)
      const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2)
      const buffer = ctx.createBuffer(1, count, OUTPUT_RATE)
      const channel = buffer.getChannelData(0)
      for (let index = 0; index < count; index += 1) {
        channel[index] = view.getInt16(index * 2, true) / 32768
      }
      const source = ctx.createBufferSource()
      const sourceGeneration = generation
      sources.add(source)
      source.buffer = buffer
      source.onended = () => {
        if (sourceGeneration !== generation) return
        sources.delete(source)
        if (!sources.size && callbacks.onDrain) callbacks.onDrain()
      }
      source.connect(ctx.destination)
      const when = Math.max(ctx.currentTime, nextStart)
      source.start(when)
      nextStart = when + count / OUTPUT_RATE
      return true
    } catch (error) {
      return fail(error)
    }
  }

  function prepare() {
    try {
      const ctx = ensureContext()
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        const resuming = ctx.resume()
        if (resuming && typeof resuming.catch === 'function') resuming.catch((error) => fail(error))
      }
      return true
    } catch (error) {
      return fail(error)
    }
  }

  function stop() {
    resetPlayback()
  }

  return { prepare, enqueue, stop, isIdle: () => sources.size === 0 }
}

module.exports = { createPlayer, OUTPUT_RATE }
