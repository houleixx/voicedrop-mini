const api = require('./api')
const auth = require('./auth')
const http = require('./request')
const recording = require('../utils/recording')
const shareRouter = require('../utils/share-router')

const SILENT_M4A_BASE64 = 'AAAAHGZ0eXBNNEEgAAACAE00QSBpc29taXNvMgAAAAhmcmVlAAAAXW1kYXTeAgBMYXZjNjIuMjguMTAxAAIwQA4BGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHAAADP21vb3YAAABsbXZoZAAAAAAAAAAAAAAAAAAAA+gAAAPoAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAJpdHJhawAAAFx0a2hkAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAPoAAAAAAAAAAAAAAABAQAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAJGVkdHMAAAAcZWxzdAAAAAAAAAABAAAD6AAABAAAAQAAAAAB4W1kaWEAAAAgbWRoZAAAAAAAAAAAAAAAAAAAPoAAAEKAVcQAAAAAAC1oZGxyAAAAAAAAAABzb3VuAAAAAAAAAAAAAAAAU291bmRIYW5kbGVyAAAAAYxtaW5mAAAAEHNtaGQAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAVBzdGJsAAAAanN0c2QAAAAAAAAAAQAAAFptcDRhAAAAAAAAAAEAAAAAAAAAAAABABAAAAAAPoAAAAAAADZlc2RzAAAAAAOAgIAlAAEABICAgBdAFQAAAAAAfQAAAAJ/BYCAgAUUCFblAAaAgIABAgAAACBzdHRzAAAAAAAAAAIAAAAQAAAEAAAAAAEAAAKAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAARAAAAAQAAAFhzdHN6AAAAAAAAAAAAAAARAAAAFQAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAUc3RjbwAAAAAAAAABAAAALAAAABpzZ3BkAQAAAHJvbGwAAAACAAAAAf//AAAAHHNiZ3AAAAAAcm9sbAAAAAEAAAARAAAAAQAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjIuMTIuMTAx'

async function collectStyle(type, title, text, source) {
  const res = await http.postJson(`${api.filesBase()}/style/collect`, auth.bearer(), collectStyleBody(type, title, text, source))
  return res.statusCode >= 200 && res.statusCode < 300
}

function collectStyleBody(type, title, text, source) {
  return { type, title, text, source }
}

function titleForText(text, fallback) {
  return shareRouter.firstLineTitle(text, fallback)
}

async function fetchDataset() {
  const res = await http.get(`${api.filesBase()}/style/dataset`, auth.bearer())
  return res.statusCode >= 200 && res.statusCode < 300 && res.data ? (res.data.items || []) : []
}

async function deleteDataset() {
  const res = await http.del(`${api.filesBase()}/style/dataset`, auth.bearer())
  return res.statusCode >= 200 && res.statusCode < 300
}

async function triggerMine() {
  const res = await http.postJson(`${api.agentBase()}/mine/trigger`, auth.bearer(), {})
  return res.statusCode >= 200 && res.statusCode < 300
}

async function triggerStyleExtract(clearAfter) {
  const name = styleExtractTaskName(clearAfter, new Date())
  const uploaded = await uploadSilentTask(name)
  if (!uploaded) return false
  return triggerMine()
}

function imageArticlePlan(count, now) {
  const date = now || new Date()
  const audioName = recording.makeName(date, 0)
  const parsed = recording.parseStem(recording.stemOf(audioName))
  const sessionTs = parsed ? parsed.sessionTs : ''
  const photoKeys = []
  for (let i = 0; i < Math.max(0, Number(count) || 0); i += 1) {
    photoKeys.push(recording.photoKey(sessionTs, i))
  }
  return { audioName, sessionTs, photoKeys }
}

function audioArticlePlan(durationSeconds, now) {
  return { audioName: recording.makeName(now || new Date(), durationSeconds || 0) }
}

async function generateFromImages(paths) {
  const clean = (paths || []).filter(Boolean)
  if (!clean.length) return false
  const plan = imageArticlePlan(clean.length, new Date())
  for (let i = 0; i < clean.length; i += 1) {
    const ok = await uploadImage(clean[i], plan.photoKeys[i])
    if (!ok) return false
  }
  const uploaded = await uploadSilentTask(plan.audioName)
  if (!uploaded) return false
  return triggerMine()
}

async function generateFromAudio(filePath, durationSeconds) {
  if (!filePath) return false
  const plan = audioArticlePlan(durationSeconds, new Date())
  const uploaded = await uploadAudio(filePath, plan.audioName)
  if (!uploaded) return false
  return triggerMine()
}

function uploadAudio(filePath, name) {
  return new Promise((resolve) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success: (file) => {
        wx.request({
          method: 'PUT',
          url: `${api.filesBase()}/upload/${api.path(name)}`,
          data: file.data,
          header: http.authHeader(auth.bearer(), { 'content-type': 'audio/mp4' }),
          success: (res) => resolve(res.statusCode >= 200 && res.statusCode < 300),
          fail: () => resolve(false)
        })
      },
      fail: () => resolve(false)
    })
  })
}

function uploadImage(filePath, key) {
  return new Promise((resolve) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success: (file) => {
        wx.request({
          method: 'PUT',
          url: `${api.filesBase()}/upload/${api.path(key)}`,
          data: file.data,
          header: http.authHeader(auth.bearer(), { 'content-type': 'image/jpeg' }),
          success: (res) => resolve(res.statusCode >= 200 && res.statusCode < 300),
          fail: () => resolve(false)
        })
      },
      fail: () => resolve(false)
    })
  })
}

function uploadSilentTask(name) {
  return new Promise((resolve) => {
    wx.request({
      method: 'PUT',
      url: `${api.filesBase()}/upload/${api.path(name)}`,
      data: silentAudioData(),
      header: http.authHeader(auth.bearer(), { 'content-type': 'audio/mp4' }),
      success: (res) => resolve(res.statusCode >= 200 && res.statusCode < 300),
      fail: () => resolve(false)
    })
  })
}

function silentAudioData() {
  if (typeof wx !== 'undefined' && wx.base64ToArrayBuffer) return wx.base64ToArrayBuffer(SILENT_M4A_BASE64)
  if (typeof Buffer !== 'undefined') return Buffer.from(SILENT_M4A_BASE64, 'base64')
  return SILENT_M4A_BASE64
}

function styleExtractTaskName(clearAfter, now) {
  const base = recording.makeName(now || new Date(), 0).replace(/\.m4a$/, '')
  return `${base}-${clearAfter ? 'TaskStyleExtract' : 'TaskStyleExtractKeep'}.m4a`
}

module.exports = {
  collectStyle,
  collectStyleBody,
  titleForText,
  fetchDataset,
  deleteDataset,
  triggerMine,
  triggerStyleExtract,
  generateFromImages,
  generateFromAudio,
  imageArticlePlan,
  audioArticlePlan,
  silentAudioData,
  styleExtractTaskName
}
