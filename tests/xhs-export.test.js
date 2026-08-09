const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const xhsExport = require('../services/xhs-export')
const xhsCards = require('../utils/xhs-cards')

const root = path.join(__dirname, '..')

test('xhs text-card canvas keeps its 3:4 layout and export aspect ratio', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/detail/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(root, 'pages/detail/index.wxss'), 'utf8')
  const canvas = wxml.match(/<canvas[^>]*canvas-id="xhsExportCanvas"[^>]*width="(\d+)"[^>]*height="(\d+)"[^>]*class="[^"]*xhs-export-canvas[^"]*"[^>]*>/)
  const layout = wxss.match(/\.xhs-export-canvas\s*\{[^}]*width:\s*(\d+)px;[^}]*height:\s*(\d+)px;/s)

  assert.ok(canvas, 'xhs canvas should expose its export dimensions and a dedicated class')
  assert.ok(layout, 'xhs canvas should have dedicated layout dimensions')
  assert.equal(Number(canvas[1]) / Number(canvas[2]), 3 / 4)
  assert.equal(Number(layout[1]) / Number(layout[2]), 3 / 4)
})

test('xhs text cards follow the iOS body typography and layout', () => {
  assert.equal(
    xhsCards.canvasFont(42, 400),
    'normal 400 42px "PingFang SC", "Microsoft YaHei", sans-serif'
  )

  const detailPage = fs.readFileSync(path.join(root, 'pages/detail/index.js'), 'utf8')
  assert.match(detailPage, /xhsCards\.applyCanvasFont\(ctx, 42, 400\)/)
  assert.equal(xhsCards.BODY_TOP, 150)
  assert.equal(xhsCards.BODY_WIDTH, 860)
  assert.equal(xhsCards.BODY_LINE_SPACING, 26)
  assert.equal(xhsCards.BODY_PARAGRAPH_SPACING, 36)
  assert.doesNotMatch(detailPage, /VOICE DROP · 小红书素材/)
  assert.doesNotMatch(detailPage, /padStart\(2, '0'\)/)
  assert.doesNotMatch(detailPage, /ctx\.scale\([^)]*1\.\d+/)
})

test('xhs iOS-style wrapping measures text and keeps closing punctuation with its line', () => {
  const lines = xhsCards.wrapParagraph(
    '我来测试一下，现在录音是不是正常呢？现在用的是小程序的录音功能。',
    17,
    (value) => Array.from(value).length
  )

  assert.deepEqual(lines, [
    '我来测试一下，现在录音是不是正常呢？',
    '现在用的是小程序的录音功能。'
  ])
})

test('xhs export keeps the backend content shape and creates clipboard text', () => {
  const pack = xhsExport.normalizePack({
    title: '  周末散步  ',
    body: '  一段正文  ',
    tags: [' 城市漫步 ', '', '#日常'],
    photoKeys: [' photos/a.jpg ', null]
  })

  assert.deepEqual(pack, {
    title: '周末散步',
    body: '一段正文',
    tags: ['城市漫步', '#日常'],
    photoKeys: ['photos/a.jpg']
  })
  assert.equal(xhsExport.clipboardText(pack), '周末散步\n\n一段正文\n\n#城市漫步 ##日常')
})

test('xhs export calls the real pack endpoint and fails safely on error responses', async () => {
  const calls = []
  const dependencies = {
    api: { agentBase: () => 'https://example.test/agent' },
    token: 'token',
    http: {
      async postJson(url, token, body) {
        calls.push({ url, token, body })
        return { statusCode: 200, data: { ok: true, title: '标题', body: '正文', tags: ['标签'], photoKeys: ['photos/a.jpg'] } }
      }
    }
  }
  const result = await xhsExport.prepare('VoiceDrop-demo', dependencies)
  assert.equal(result.ok, true)
  assert.equal(result.clipboardText, '标题\n\n正文\n\n#标签')
  assert.deepEqual(calls, [{ url: 'https://example.test/agent/xhs-pack', token: 'token', body: { stem: 'VoiceDrop-demo' } }])

  const failed = await xhsExport.prepare('VoiceDrop-demo', {
    api: dependencies.api,
    token: 'token',
    http: { postJson: async () => ({ statusCode: 422, data: { error: 'empty_article' } }) }
  })
  assert.deepEqual(failed, { ok: false, error: 'empty_article' })
})

test('xhs text cards fill only the remaining nine image slots', () => {
  assert.equal(xhsExport.generatedCardSlots(0), 9)
  assert.equal(xhsExport.generatedCardSlots(3), 6)
  assert.equal(xhsExport.generatedCardSlots(9), 0)

  const cards = xhsCards.buildCards('一个足够长的标题用于换行', '第一段内容。\n\n第二段内容。', '2026-08-09', 2)
  assert.equal(cards.length, 2)
  assert.deepEqual(cards[0], { kind: 'title', title: '一个足够长的标题用于换行', date: '2026-08-09' })
  assert.equal(cards[1].kind, 'body')
  assert.ok(cards[1].lines.length > 0)
})
