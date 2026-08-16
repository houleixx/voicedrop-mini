const books = require('../../services/books')

const POLL_MS = 6000

function decoded(value) {
  try { return decodeURIComponent(String(value || '')) } catch (_) { return String(value || '') }
}

Page({
  data: {
    slug: '', title: '', thread: [], loading: true, denied: '', error: '', input: '',
    sending: false, running: false, canSend: false, scrollIntoView: ''
  },

  onLoad(options) {
    this._active = true
    this._unloaded = false
    this.setData({ slug: decoded(options.slug), title: decoded(options.title) || '未命名' })
    this.loadHistory()
  },

  onShow() {
    this._active = true
    if (this.data.running) this.schedulePoll()
  },

  onHide() {
    this._active = false
    this.clearPoll()
  },

  onUnload() {
    this._active = false
    this._unloaded = true
    this._historyRequestId = (this._historyRequestId || 0) + 1
    this.clearPoll()
  },

  clearPoll() {
    if (!this._pollTimer) return
    clearTimeout(this._pollTimer)
    this._pollTimer = null
  },

  schedulePoll() {
    this.clearPoll()
    if (!this._active || !this.data.running) return
    this._pollTimer = setTimeout(async () => {
      this._pollTimer = null
      await this.loadHistory({ polling: true })
      if (this.data.running) this.schedulePoll()
    }, POLL_MS)
  },

  async loadHistory(options) {
    const requestId = (this._historyRequestId || 0) + 1
    this._historyRequestId = requestId
    if (!(options && options.polling)) this.setData({ loading: this.data.thread.length === 0, error: '' })
    let response
    try {
      response = await books.history(this.data.slug)
    } catch (_) {
      if (this._historyRequestId !== requestId) return
      if (this.data.thread.length === 0) this.setData({ error: books.reviseMessage(0), loading: false })
      return
    }
    if (this._historyRequestId !== requestId) return
    const statusCode = Number(response && response.statusCode) || 0
    if (statusCode === 200) {
      const history = books.normalizeThread(response.data)
      this.setData({
        thread: history.thread, running: history.running, loading: false, denied: '', error: ''
      })
      this.updateSubmit()
      this.scrollToBottom()
      if (history.running) this.schedulePoll()
      else this.clearPoll()
      return
    }
    if ([401, 403, 404].includes(statusCode)) {
      this.setData({ denied: books.reviseMessage(statusCode, response.data), loading: false, running: false })
      this.clearPoll()
    } else if (this.data.thread.length === 0) {
      this.setData({ error: books.reviseMessage(statusCode, response.data), loading: false })
    }
    this.updateSubmit()
  },

  onInput(event) {
    this.setData({ input: String(event.detail.value || '').slice(0, 4000), error: '' })
    this.updateSubmit()
  },

  updateSubmit() {
    this.setData({
      canSend: Boolean(String(this.data.input || '').trim()) && !this.data.sending &&
        !this.data.running && !this.data.denied
    })
  },

  scrollToBottom() {
    this.setData({ scrollIntoView: '' })
    const run = () => this._active && this.setData({ scrollIntoView: 'thread-bottom' })
    if (typeof wx.nextTick === 'function') wx.nextTick(run)
    else run()
  },

  async send() {
    const instruction = String(this.data.input || '').trim()
    if (!instruction || this.data.sending || this.data.running || this.data.denied) return
    this.setData({ sending: true, error: '' })
    this.updateSubmit()
    let response
    try { response = await books.revise(this.data.slug, instruction) } catch (_) {}
    if (this._unloaded) return
    const statusCode = Number(response && response.statusCode) || 0
    if (statusCode === 202) {
      const ts = Number(response.data && response.data.ts) || Date.now()
      const optimistic = books.normalizeThread({
        thread: [{ ts, kind: 'revise', instruction, status: 'running' }]
      }).thread[0]
      this.setData({
        input: '', sending: false, running: true, error: '', thread: this.data.thread.concat(optimistic)
      })
      this.updateSubmit()
      this.scrollToBottom()
      this.schedulePoll()
      return
    }
    const error = books.reviseMessage(statusCode, response && response.data)
    this.setData({ sending: false, error })
    this.updateSubmit()
    if (statusCode === 409) {
      await this.loadHistory({ polling: true })
      this.setData({ error })
    }
  }
})
