const audio = require('./audio')
const library = require('./library')
const photoMarkerRepair = require('./photo-marker-repair')
const pendingReplies = require('../utils/pending-replies')

const STORAGE_KEY = 'vd.pendingRecordingUploads.v1'
let drainPromise = null
let generation = 0

function pending() {
  try {
    if (!wx.getStorageSync) return []
    const value = wx.getStorageSync(STORAGE_KEY)
    return Array.isArray(value) ? value.filter(validItem) : []
  } catch (_) {
    return []
  }
}

function persist(items) {
  if (!wx.setStorageSync) throw new Error('录音续传存储不可用')
  wx.setStorageSync(STORAGE_KEY, items)
}

function validItem(item) {
  return Boolean(item && item.name && item.audioPath && Array.isArray(item.photos))
}

function copyFile(source, target) {
  if (!source || source === target) return Promise.resolve(target)
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager()
    const readAndWrite = (previousError) => {
      if (!fs.readFile || !fs.writeFile) {
        reject(previousError || new Error('录音照片无法持久化'))
        return
      }
      fs.readFile({
        filePath: source,
        success: (result) => fs.writeFile({
          filePath: target,
          data: result.data,
          success: () => resolve(target),
          fail: reject
        }),
        fail: (error) => reject(error || previousError)
      })
    }
    const saveTemp = (previousError) => {
      const saveFile = fs.saveFile ? fs.saveFile.bind(fs) : wx.saveFile
      if (!saveFile) {
        readAndWrite(previousError)
        return
      }
      saveFile({
        tempFilePath: source,
        filePath: target,
        success: (result) => resolve(result.savedFilePath || result.tempFilePath || target),
        fail: (error) => readAndWrite(error || previousError)
      })
    }
    if (!fs.copyFile) {
      saveTemp()
      return
    }
    fs.copyFile({
      srcPath: source,
      destPath: target,
      success: () => resolve(target),
      fail: saveTemp
    })
  })
}

function stablePhotoPath(itemName, photo, index) {
  const token = String(photo.key || `${itemName}-${index}`)
    .replace(/[^0-9a-z]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-96)
  return `${wx.env.USER_DATA_PATH}/voicedrop-pending-photo-${token || index}.jpg`
}

async function stage(input) {
  const existing = pending().find((item) => item.name === input.name)
  if (existing) return existing
  const photos = []
  for (let index = 0; index < (input.photos || []).length; index += 1) {
    const photo = input.photos[index]
    const target = stablePhotoPath(input.name, photo, index)
    try {
      const stablePath = await copyFile(photo.path, target)
      photos.push({ key: photo.key, path: stablePath, cleanup: true })
    } catch (_) {
      // Keep the temporary path for the immediate attempt. If it disappears before
      // retry, the audio remains gated instead of generating an article without it.
      photos.push({ key: photo.key, path: photo.path, cleanup: false })
    }
  }
  const item = {
    name: input.name,
    audioPath: input.audioPath,
    contentType: input.contentType || 'audio/wav',
    photos,
    tag: input.tag || '',
    replyTo: input.replyTo || null
  }
  const items = pending()
  items.push(item)
  persist(items)
  return item
}

async function upload(name) {
  const uploadGeneration = generation
  const item = pending().find((candidate) => candidate.name === name)
  if (!item) return false
  if (item.photos.length) {
    photoMarkerRepair.remember(item.name, item.photos.map((photo) => photo.key))
  }
  if (uploadGeneration !== generation) return false
  // Every component is already persisted. Start them together: the server now
  // backfills a photo marker when that photo reaches it after the audio/article.
  // Keep this plan until every component is confirmed, so an interrupted mini
  // program run can resume only the unfinished work later.
  const photosTask = uploadPhotos(item, uploadGeneration)
  const audioTask = uploadAudio(item, uploadGeneration)
  const tagsTask = uploadTags(item, uploadGeneration)
  await Promise.all([photosTask, audioTask, tagsTask])
  if (item.replyTo) pendingReplies.put(item.name, item.replyTo)
  persist(pending().filter((candidate) => candidate.name !== item.name))
  await cleanupItem(item)
  return true
}

async function uploadPhotos(item, uploadGeneration) {
  const failed = []
  const queue = item.photos.filter((photo) => !photo.uploaded).slice()
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const photo = queue.shift()
      if (uploadGeneration !== generation) return
      try {
        await library.uploadPhoto(photo.path, photo.key)
        if (uploadGeneration !== generation) return
        photo.uploaded = true
        persistPendingItem(item)
      } catch (_) {
        failed.push(photo.key)
      }
    }
  })
  await Promise.all(workers)
  if (failed.length) {
    const error = new Error(`photo upload failed: ${failed.join(',')}`)
    error.photoUpload = true
    throw error
  }
}

async function uploadAudio(item, uploadGeneration) {
  if (item.audioUploaded) return
  await audio.uploadFile(item.audioPath, item.name, item.contentType)
  if (uploadGeneration !== generation) return
  item.audioUploaded = true
  persistPendingItem(item)
}

async function uploadTags(item, uploadGeneration) {
  if (!item.tag || item.tagsUploaded) return
  const uploaded = await audio.uploadTags(item.name, [item.tag])
  if (uploadGeneration !== generation) return
  if (!uploaded) throw new Error('tag upload failed')
  item.tagsUploaded = true
  persistPendingItem(item)
}

function persistPendingItem(item) {
  const items = pending()
  const index = items.findIndex((candidate) => candidate.name === item.name)
  if (index < 0) return
  items[index] = item
  persist(items)
}

async function clearAll() {
  generation += 1
  const items = pending()
  persist([])
  await Promise.all(items.map(cleanupItem))
}

function cleanupPath(filePath) {
  return new Promise((resolve) => {
    const fs = wx.getFileSystemManager()
    if (!fs.unlink) {
      resolve()
      return
    }
    fs.unlink({ filePath, success: resolve, fail: resolve })
  })
}

async function cleanupItem(item) {
  const paths = [item.audioPath]
  item.photos.forEach((photo) => {
    if (photo.cleanup) paths.push(photo.path)
  })
  await Promise.all(paths.map(cleanupPath))
}

function drain() {
  if (drainPromise) return drainPromise
  drainPromise = (async () => {
    let uploaded = 0
    for (const item of pending()) {
      try {
        if (await upload(item.name)) uploaded += 1
      } catch (_) {
        // Preserve this item and continue with unrelated recordings.
      }
    }
    return uploaded
  })().finally(() => { drainPromise = null })
  return drainPromise
}

module.exports = {
  STORAGE_KEY,
  pending,
  stage,
  upload,
  drain,
  clearAll
}
