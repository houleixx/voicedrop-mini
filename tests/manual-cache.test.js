const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const manual = require('../services/manual')

function sampleManual() {
  const chapters = []
  for (let index = 1; index <= 8; index += 1) {
    chapters.push(`## 第 ${index} 章 标题\n\n### 小标题\n\n正文 ${index}\n\n- 一项\n\n1. 一步`)
  }
  return `# VoiceDrop 使用手册\n\n${chapters.join('\n\n')}`
}

test('bundled markdown parser accepts the complete eight-chapter manual', () => {
  const chapters = manual.parseManual(sampleManual())

  assert.equal(chapters.length, 8)
  assert.equal(chapters[0].id, 'ch1')
  assert.equal(chapters[0].title, '第 1 章 标题')
  assert.match(chapters[0].html, /<h2 style="[^"]*margin:0/)
  assert.match(chapters[0].html, /<h3 style="[^"]*">小标题<\/h3>/)
  assert.match(chapters[0].html, /<ul style=/)
  assert.match(chapters[0].html, /<ol style=/)
  assert.deepEqual(manual.parseManual('## 只有一章'), [])
})

test('markdown parser renders tables code and safe inline formatting for rich-text', () => {
  const markdown = sampleManual().replace(
    '正文 1',
    '**重点**与[链接](https://voicedrop.cn)\n\n| 状态 | 意思 |\n|---|---|\n| 完成 | 好 |\n\n```\ncode\n```'
  )
  const html = manual.parseManual(markdown)[0].html

  assert.match(html, /<strong>重点<\/strong>/)
  assert.match(html, /href="https:\/\/voicedrop\.cn"/)
  assert.match(html, /<table style=/)
  assert.match(html, /<pre style=/)
  assert.match(html, /<code[^>]*>code<\/code>/)
})

test('manual loads synchronously from bundled content that matches the markdown source', () => {
  const markdown = fs.readFileSync(path.join(root, manual.MANUAL_ASSET), 'utf8')
  const chapters = manual.loadBundled()

  assert.deepEqual(chapters, manual.parseManual(markdown))
  assert.equal(chapters.length, 8)
  assert.match(chapters[7].title, /常见问题/)
})

test('manual remains available when the mini program cannot read code-package markdown through the file system', () => {
  global.wx = {
    getFileSystemManager() {
      throw new Error('readFileSync:fail no such file or directory')
    }
  }

  const chapters = manual.loadBundled()
  assert.equal(chapters.length, 8)
  assert.match(chapters[0].title, /第一次上手/)
})
