function shouldCancel(startY, currentY, cancelDistance) {
  return Number(startY) - Number(currentY) >= Number(cancelDistance)
}

function shouldAbortOnEnd(actionCanceled, draggedToCancel) {
  return Boolean(draggedToCancel)
}

function createTranscript() {
  let finalText = ''
  let partialText = ''
  const listeners = []

  function notify() {
    const text = bestText()
    if (!text) return
    while (listeners.length) {
      listeners.shift()(text)
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
    notify()
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

  return {
    clear,
    accept,
    bestText,
    bubbleText,
    waitForBestText
  }
}

function commandStatus(state) {
  const commandTalking = Boolean(state && state.commandTalking)
  const commandCanceled = Boolean(state && state.commandCanceled)
  const commandReply = String(state && state.commandReply || '').trim()
  const transcriptText = String(state && state.transcriptText || '').trim()
  const commandQueue = state && state.commandQueue || []
  if (commandTalking) {
    if (commandCanceled) return { text: '松手取消', ok: false }
    return { text: transcriptText || commandReply, ok: true }
  }
  if (commandQueue.length) {
    const last = commandQueue[commandQueue.length - 1] || {}
    return { text: String(last.text || '').trim(), ok: true }
  }
  if (/^(已连接|正在恢复|连接断开|正在执行|指令已完成|已完成)$/.test(commandReply)) {
    return { text: '', ok: true }
  }
  return { text: commandReply, ok: state && state.commandReplyOk !== false }
}

module.exports = {
  shouldCancel,
  shouldAbortOnEnd,
  createTranscript,
  commandStatus
}
