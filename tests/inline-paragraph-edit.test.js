const test = require('node:test')
const assert = require('node:assert/strict')

const article = require('../utils/article')

test('inline paragraph edit replaces the visible line in the original body', () => {
  const input = {
    title: '标题',
    body: '<!-- style: 风格 v3 -->\n# 标题\n\n第一段\n\n[[photo:photos/session/a.jpg]]\n\n第二段'
  }

  const body = article.replaceRenderedBodyLine(input, 3, '精修后的第二段')

  assert.equal(body, '<!-- style: 风格 v3 -->\n# 标题\n\n第一段\n\n[[photo:photos/session/a.jpg]]\n\n精修后的第二段')
})

test('inline paragraph edit never replaces a photo row', () => {
  const input = {
    title: '标题',
    body: '# 标题\n\n第一段\n\n[[photo:photos/session/a.jpg]]\n\n第二段'
  }

  assert.equal(article.replaceRenderedBodyLine(input, 2, '不能替换图片'), null)
})

test('inline paragraph edit preserves surrounding whitespace and comments', () => {
  const input = {
    title: '标题',
    body: '<!-- origin: voice -->\n\n第一段\n\n\n第二段  \n'
  }

  const body = article.replaceRenderedBodyLine(input, 2, '新的第二段')

  assert.equal(body, '<!-- origin: voice -->\n\n第一段\n\n\n新的第二段  \n')
})
