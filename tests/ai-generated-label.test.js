const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('AI-generated article result pages show a prominent AI生成 label', () => {
  const pages = [
    ['pages/detail/index.wxml', 'pages/detail/index.wxss'],
    ['pages/shared-article/index.wxml', 'pages/shared-article/index.wxss'],
    ['pages/community-detail/index.wxml', 'pages/community-detail/index.wxss']
  ]

  for (const [wxmlPath, wxssPath] of pages) {
    const wxml = read(wxmlPath)
    const wxss = read(wxssPath)

    assert.match(wxml, /class="ai-generated-label"[^>]*>[\s\S]*?<text[^>]*>AI生成<\/text>/)
    assert.match(wxss, /\.ai-generated-label\s*\{[^}]*display:\s*inline-flex;[^}]*color:\s*#d8593b;[^}]*background:\s*#f6e4dc;[^}]*font-weight:\s*600;/s)
  }
})

test('dated article pages place the AI生成 label at the right edge of metadata', () => {
  const detail = read('pages/detail/index.wxml')
  const detailCss = read('pages/detail/index.wxss')
  const community = read('pages/community-detail/index.wxml')
  const communityCss = read('pages/community-detail/index.wxss')

  assert.match(detail, /class="article-meta">[\s\S]*?rec\.timeLabel[\s\S]*?class="ai-generated-label"[\s\S]*?<\/view>\s*<\/view>/)
  assert.match(community, /class="article-meta">[\s\S]*?class="article-date"[\s\S]*?class="ai-generated-label"[\s\S]*?<\/view>\s*<\/view>/)
  assert.match(detailCss, /\.article-meta \.ai-generated-label\s*\{[^}]*margin-left:\s*auto;/s)
  assert.match(communityCss, /\.article-meta \.ai-generated-label\s*\{[^}]*margin-left:\s*auto;/s)
})

test('audio detail leaves deliberate space before the writing style action', () => {
  const wxss = read('pages/detail/index.wxss')

  assert.match(wxss, /\.style-trigger\s*\{[^}]*margin:\s*0 0 0 12rpx;/s)
  assert.doesNotMatch(wxss, /\.style-trigger\s*\{[^}]*translateX\(-34rpx\)/s)
})

test('shared article aligns its standalone AI生成 label to the right', () => {
  const wxml = read('pages/shared-article/index.wxml')
  const wxss = read('pages/shared-article/index.wxss')

  assert.match(wxml, /class="ai-generated-row">\s*<view class="ai-generated-label"/)
  assert.match(wxss, /\.ai-generated-row\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;/s)
  assert.match(wxss, /\.ai-generated-row \.ai-generated-label\s*\{[^}]*margin-top:\s*0;/s)
})

test('community prompt shares are not incorrectly labelled as AI-generated articles', () => {
  const wxml = read('pages/community-detail/index.wxml')

  assert.match(wxml, /class="ai-generated-label"\s+wx:if="\{\{!post\.isPrompt\}\}"/)
})

test('recording entry prominently explains that AI generates the article', () => {
  const wxml = read('pages/record/index.wxml')
  const wxss = read('pages/record/index.wxss')

  assert.match(wxml, /class="record-ai-notice"[^>]*>[\s\S]*?>AI生成</)
  assert.match(wxml, /录音结束后将由人工智能转写并生成文章/)
  assert.match(wxss, /\.record-ai-notice\s*\{[^}]*display:\s*flex;/s)
  assert.doesNotMatch(wxss, /\.record-ai-notice\s*\{[^}]*(?:border|background):/s)
})
