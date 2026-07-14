const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')

test('shared page header paints behind the status bar', () => {
  const wxml = fs.readFileSync(path.join(root, 'components/page-header/index.wxml'), 'utf8')

  assert.match(wxml, /class="page-header"[^>]*top:\s*0px;/)
  assert.match(wxml, /class="page-header"[^>]*height:\s*calc\(\{\{toolbarTop \+ toolbarHeight\}\}px \+ 26rpx\);/)
  assert.match(wxml, /class="page-header"[^>]*padding-top:\s*\{\{toolbarTop\}\}px;/)
  assert.match(wxml, /class="page-header"[^>]*padding-bottom:\s*26rpx;/)
})

test('custom detail toolbars paint behind the status bar and leave bottom room', () => {
  const detail = fs.readFileSync(path.join(root, 'pages/detail/index.wxml'), 'utf8')
  const communityDetail = fs.readFileSync(path.join(root, 'pages/community-detail/index.wxml'), 'utf8')

  assert.match(detail, /class="detail-toolbar"[^>]*top:\s*0px;/)
  assert.match(detail, /class="detail-toolbar"[^>]*height:\s*calc\(\{\{toolbarTop \+ toolbarHeight\}\}px \+ 26rpx\);/)
  assert.match(detail, /class="detail-toolbar"[^>]*padding-top:\s*\{\{toolbarTop\}\}px;/)
  assert.match(detail, /class="detail-toolbar"[^>]*padding-bottom:\s*26rpx;/)
  assert.match(detail, /class="detail-body"[^>]*padding-top:\s*120px;/)
  assert.match(communityDetail, /class="detail-toolbar"[^>]*top:\s*0px;/)
  assert.match(communityDetail, /class="detail-toolbar"[^>]*height:\s*calc\(\{\{toolbarTop \+ toolbarHeight\}\}px \+ 26rpx\);/)
  assert.match(communityDetail, /class="detail-toolbar"[^>]*padding-top:\s*\{\{toolbarTop\}\}px;/)
  assert.match(communityDetail, /class="detail-toolbar"[^>]*padding-bottom:\s*26rpx;/)
  assert.match(communityDetail, /class="detail-body"[^>]*padding-top:\s*120px;/)
})

test('detail photo sheet top bar paints behind the status bar and leaves bottom room', () => {
  const detail = fs.readFileSync(path.join(root, 'pages/detail/index.wxml'), 'utf8')

  assert.match(detail, /class="photo-sheet-top"[^>]*top:\s*0px;/)
  assert.match(detail, /class="photo-sheet-top"[^>]*height:\s*calc\(\{\{toolbarTop \+ toolbarHeight\}\}px \+ 26rpx\);/)
  assert.match(detail, /class="photo-sheet-top"[^>]*padding-top:\s*\{\{toolbarTop\}\}px;/)
  assert.match(detail, /class="photo-sheet-top"[^>]*padding-bottom:\s*26rpx;/)
  assert.match(detail, /class="photo-sheet-content"[^>]*padding-top:\s*calc\(\{\{photoSheetTopPadding\}\}px \+ 26rpx\);/)
})
