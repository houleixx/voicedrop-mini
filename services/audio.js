const api = require('./api')
const auth = require('./auth')
const recording = require('../utils/recording')
const http = require('./request')

function recorder() {
  return wx.getRecorderManager()
}

function start() {
  recorder().start({
    duration: 60 * 60 * 1000,
    sampleRate: 44100,
    numberOfChannels: 1,
    encodeBitRate: 96000,
    format: 'aac'
  })
}

function startPcmFrames() {
  recorder().start({
    duration: 10 * 60 * 1000,
    sampleRate: 16000,
    numberOfChannels: 1,
    format: 'PCM',
    frameSize: 4
  })
}

function stop() {
  recorder().stop()
}

function uploadFile(filePath, name, contentType) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success: (file) => {
        wx.request({
          method: 'PUT',
          url: `${api.filesBase()}/upload/${api.path(name)}`,
          data: file.data,
          header: http.authHeader(auth.bearer(), { 'content-type': contentType || 'audio/mp4' }),
          success: async (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              await triggerMine()
              resolve(true)
            } else {
              reject(new Error(`upload HTTP ${res.statusCode}`))
            }
          },
          fail: reject
        })
      },
      fail: reject
    })
  })
}

async function uploadTags(name, tags) {
  const plan = tagsSidecarUpload(name, tags)
  if (!plan.tags.length) return true
  const res = await http.putJson(`${api.filesBase()}/upload/${api.path(plan.key)}`, auth.bearer(), plan.tags)
  return res.statusCode >= 200 && res.statusCode < 300
}

function tagsSidecarUpload(name, tags) {
  const clean = (tags || []).map((tag) => String(tag || '').trim()).filter(Boolean)
  return {
    key: recording.tagsKey(recording.stemOf(name)),
    tags: clean
  }
}

function triggerMine() {
  return new Promise((resolve) => {
    wx.request({
      method: 'POST',
      url: `${api.filesBase()}/mine`,
      header: http.authHeader(auth.bearer()),
      success: () => resolve(true),
      fail: () => resolve(false)
    })
  })
}

function nameForSession(startedAt, seconds, place) {
  return recording.makeName(startedAt, seconds, place)
}

module.exports = {
  recorder,
  start,
  startPcmFrames,
  stop,
  uploadFile,
  uploadTags,
  tagsSidecarUpload,
  triggerMine,
  nameForSession
}
