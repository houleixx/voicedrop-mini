const PERIODS = {
  EarlyMorning: '清晨',
  Morning: '上午',
  Noon: '中午',
  Afternoon: '下午',
  Evening: '傍晚',
  Night: '晚上',
  LateNight: '深夜'
}

const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad(value, length) {
  return String(value).padStart(length, '0')
}

function stemOf(audioName) {
  return String(audioName || '').endsWith('.m4a') ? audioName.slice(0, -4) : String(audioName || '')
}

function articleKey(stem) {
  return `articles/${stem}.json`
}

function emptyKey(stem) {
  return `articles/${stem}.empty`
}

function srtKey(stem) {
  return `articles/${stem}.srt`
}

function blockedKey(stem) {
  return `articles/${stem}.blocked`
}

function tagsKey(stem) {
  return `articles/${stem}.tags`
}

function isRecordingFile(name) {
  return typeof name === 'string' && name.startsWith('VoiceDrop-') && name.endsWith('.m4a')
}

function parseStem(stem) {
  const parts = String(stem || '').split('-')
  if (parts.length < 7 || parts[0] !== 'VoiceDrop') return null
  const sessionTs = `${parts[1]}-${parts[2]}-${parts[3]}-${parts[4]}`
  const duration = parts.find((part) => /^\d+m\d+s$/.test(part)) || ''
  return {
    sessionTs,
    month: Number(parts[2]),
    day: Number(parts[3]),
    hhmm: parts[4] && parts[4].length === 6 ? `${parts[4].slice(0, 2)}:${parts[4].slice(2, 4)}` : '',
    duration,
    weekday: parts[6] || '',
    period: parts[7] || '',
    place: parts.length >= 10 ? parts[9] : (parts.length >= 9 ? parts[8] : '')
  }
}

function weekdayToChinese(sessionTs) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(sessionTs || '')
  if (!match) return ''
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return WEEKDAYS_ZH[date.getDay()]
}

function rowTitle(rec) {
  if (rec.articleTitle) return rec.articleTitle
  const parsed = parseStem(rec.stem || stemOf(rec.audioName))
  if (!parsed) return rec.stem || stemOf(rec.audioName)
  const parts = []
  const weekday = weekdayToChinese(parsed.sessionTs)
  if (weekday) parts.push(weekday)
  if (PERIODS[parsed.period]) parts.push(PERIODS[parsed.period])
  const label = parts.join('·')
  return parsed.place ? `${label} · ${parsed.place}` : (label || rec.stem)
}

function timeLabel(rec) {
  const parsed = parseStem(rec && (rec.stem || stemOf(rec.audioName)))
  if (parsed && parsed.month && parsed.day && parsed.hhmm) return `${parsed.month}月${parsed.day}日 ${parsed.hhmm}`
  return rec && rec.uploaded || ''
}

function statusLabel(rec) {
  if (rec.uploading) return '正在上传'
  if (rec.hasArticles) return '已成文'
  if (rec.isEmpty) return '无语音'
  if (rec.phase === 'asr') return '听录音'
  if (rec.phase === 'mining') return '挖文章'
  if (rec.blockReason === 'too-long') return '录音过长'
  if (rec.blockReason === 'no-credit') return '余额不足'
  return '待处理'
}

function fromRemoteFile(file, names) {
  const audioName = file.name || ''
  const stem = stemOf(audioName)
  const parsed = parseStem(stem)
  const rec = {
    audioName,
    stem,
    uploaded: file.uploaded || '',
    hasArticles: names ? names.has(articleKey(stem)) : false,
    isEmpty: names ? names.has(emptyKey(stem)) : false,
    articleTitle: file.articleTitle || '',
    tags: file.tags || [],
    durationLabel: parsed ? parsed.duration : ''
  }
  rec.rowTitle = rowTitle(rec)
  rec.timeLabel = timeLabel(rec)
  rec.statusLabel = statusLabel(rec)
  return rec
}

function durationTag(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  return `${Math.floor(total / 60)}m${total % 60}s`
}

function period(date) {
  const hour = date.getHours()
  if (hour >= 5 && hour < 9) return 'EarlyMorning'
  if (hour >= 9 && hour < 12) return 'Morning'
  if (hour >= 12 && hour < 14) return 'Noon'
  if (hour >= 14 && hour < 18) return 'Afternoon'
  if (hour >= 18 && hour < 20) return 'Evening'
  if (hour >= 20 && hour < 23) return 'Night'
  return 'LateNight'
}

function makeName(date, durationSeconds, place) {
  const d = date instanceof Date ? date : new Date()
  const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}-${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`
  const suffix = place ? `-${place}` : ''
  return `VoiceDrop-${timestamp}-${durationTag(durationSeconds)}-${WEEKDAYS_EN[d.getDay()]}-${period(d)}${suffix}.m4a`
}

function photoKey(sessionTs, offset) {
  const rand = Math.random().toString(36).slice(2, 5)
  return `photos/${sessionTs}/${Math.max(0, offset || 0)}-${rand}.jpg`
}

function tagsFromRecords(records) {
  const tags = new Set()
  ;(records || []).forEach((rec) => {
    ;(rec.tags || []).forEach((tag) => {
      const clean = String(tag || '').trim()
      if (clean) tags.add(clean)
    })
  })
  return Array.from(tags).sort((a, b) => a.localeCompare(b))
}

function filterByTag(records, tag) {
  const selected = String(tag || '').trim()
  if (!selected) return records || []
  return (records || []).filter((rec) => (rec.tags || []).includes(selected))
}

module.exports = {
  articleKey,
  emptyKey,
  srtKey,
  blockedKey,
  tagsKey,
  stemOf,
  isRecordingFile,
  parseStem,
  rowTitle,
  timeLabel,
  statusLabel,
  fromRemoteFile,
  durationTag,
  period,
  makeName,
  photoKey,
  tagsFromRecords,
  filterByTag
}
