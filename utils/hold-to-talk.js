function shouldCancel(startY, currentY, cancelDistance) {
  return Number(startY) - Number(currentY) >= Number(cancelDistance)
}

function shouldAbortOnEnd(actionCanceled, draggedToCancel) {
  return Boolean(draggedToCancel)
}

function stopRecorderAndWait(recorder, timeoutMs, delay, clearDelay) {
  if (!recorder || typeof recorder.stop !== 'function') return Promise.resolve()
  if (typeof recorder.onStop !== 'function') {
    try { recorder.stop() } catch (_) {}
    return Promise.resolve()
  }
  const setDelay = delay || setTimeout
  const clear = clearDelay || clearTimeout
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const done = () => {
      if (settled) return
      settled = true
      if (typeof recorder.offStop === 'function') recorder.offStop(done)
      if (timer) clear(timer)
      resolve()
    }
    recorder.onStop(done)
    timer = setDelay(done, Math.max(0, Number(timeoutMs) || 0))
    try {
      recorder.stop()
    } catch (_) {
      done()
    }
  })
}

function createTranscript() {
  let finalText = ''
  let partialText = ''
  const listeners = []
  const finalListeners = []

  function notify(isFinal) {
    const text = bestText()
    if (!text) return
    while (listeners.length) {
      listeners.shift()(text)
    }
    if (isFinal) {
      while (finalListeners.length) finalListeners.shift()(text)
    }
  }

  function clear() {
    finalText = ''
    partialText = ''
  }

  function accept(text, isFinal) {
    const trimmed = String(text || '').trim()
    if (!trimmed) return
    if (isFinal) {
      finalText = finalText ? `${finalText} ${trimmed}` : trimmed
      partialText = ''
    } else {
      partialText = trimmed
    }
    notify(Boolean(isFinal))
  }

  function bestText() {
    return finalText.trim() || partialText.trim()
  }

  function bubbleText() {
    return bestText() || '在听…'
  }

  function waitForBestText(timeoutMs, delay, clearDelay) {
    const current = bestText()
    if (current) return Promise.resolve(current)
    const setDelay = delay || setTimeout
    const clear = clearDelay || clearTimeout
    return new Promise((resolve) => {
      let timer = null
      const done = (text) => {
        if (timer) clear(timer)
        resolve(text || bestText())
      }
      listeners.push(done)
      timer = setDelay(() => {
        const index = listeners.indexOf(done)
        if (index >= 0) listeners.splice(index, 1)
        resolve(bestText())
      }, Math.max(0, Number(timeoutMs) || 0))
    })
  }

  function waitForFinalText(timeoutMs, delay, clearDelay) {
    const setDelay = delay || setTimeout
    const clear = clearDelay || clearTimeout
    return new Promise((resolve) => {
      let timer = null
      const done = (text) => {
        if (timer) clear(timer)
        resolve(text || bestText())
      }
      finalListeners.push(done)
      timer = setDelay(() => {
        const index = finalListeners.indexOf(done)
        if (index >= 0) finalListeners.splice(index, 1)
        resolve(bestText())
      }, Math.max(0, Number(timeoutMs) || 0))
    })
  }

  return {
    clear,
    accept,
    bestText,
    bubbleText,
    waitForBestText,
    waitForFinalText
  }
}

function commandStatus(state) {
  const commandTalking = Boolean(state && state.commandTalking)
  const commandCanceled = Boolean(state && state.commandCanceled)
  const commandReply = String(state && state.commandReply || '').trim()
  const transcriptText = String(state && state.transcriptText || '').trim()
  const commandQueue = state && state.commandQueue || []
  if (commandTalking) {
    if (commandCanceled) return { text: '松手取消', ok: false, kind: 'error' }
    return { text: transcriptText || commandReply, ok: true, kind: 'transcript' }
  }
  if (commandQueue.length) {
    const last = commandQueue[commandQueue.length - 1] || {}
    return { text: String(last.text || '').trim(), ok: true, kind: 'queue' }
  }
  if (/^(已连接|正在恢复|连接断开|正在执行|指令已完成|已完成)$/.test(commandReply)) {
    return { text: '', ok: true, kind: '' }
  }
  const ok = state && state.commandReplyOk !== false
  return { text: commandReply, ok, kind: commandReply ? (ok ? 'reply' : 'error') : '' }
}

module.exports = {
  shouldCancel,
  shouldAbortOnEnd,
  stopRecorderAndWait,
  createTranscript,
  commandStatus
}
