const CACHE_KEY = 'voicedrop.uiconfig.cache.v1'
const MAX_SCHEMA = 1

function node(id, label, type, instruction, children) {
  return { id: id || '', label: label || '', type: type || '', instruction: instruction || '', children: children || [] }
}

function builtin() {
  const imageMenu = {
    groups: [[
      node('style', '图片风格', 'submenu', '', [
        node('cartoon', '卡通', '', '把这张图（[[photo:{{KEY}}]]）重画成宫崎骏动画的手绘卡通风格，构图和主体不变，正文其他内容都不要动。'),
        node('ad', '广告', '', '把这张图（[[photo:{{KEY}}]]）重新设计成一则商品广告。请从专业设计师的角度，结合本篇文章的内容和受众，打造一个精致、洗练的视觉设计。整体风格要现代、极简，不使用文字，可以加一些别的代替文字的元素。请通过合理的版式构成，最大限度地突出商品的魅力。正文其他内容都不要动。'),
        node('watercolor', '水彩', '', '把这张图（[[photo:{{KEY}}]]）重画成通透的水彩画风格，构图和主体不变，正文其他内容都不要动。'),
        node('sketch', '素描', '', '把这张图（[[photo:{{KEY}}]]）重画成铅笔素描风格，构图和主体不变，正文其他内容都不要动。'),
        node('oil', '油画', '', '把这张图（[[photo:{{KEY}}]]）重画成古典油画风格，构图和主体不变，正文其他内容都不要动。'),
        node('film', '胶片', '', '把这张图（[[photo:{{KEY}}]]）调成胶片摄影的质感和色调，构图和主体不变，正文其他内容都不要动。')
      ])
    ]]
  }

  const textMenu = {
    groups: [
      [
        node('rewrite', '改写这段', 'submenu', '', [
          node('concise', '更简洁', '', '把第{{LINE}}行（开头是"{{QUOTE}}"）改写得更简洁，意思不变，正文其他行都不要动。'),
          node('casual', '更口语', '', '把第{{LINE}}行（开头是"{{QUOTE}}"）改写得更口语、像平时说话，意思不变，正文其他行都不要动。'),
          node('formal', '更书面', '', '把第{{LINE}}行（开头是"{{QUOTE}}"）改写得更书面、更正式，意思不变，正文其他行都不要动。'),
          node('expand', '扩写一点', '', '把第{{LINE}}行（开头是"{{QUOTE}}"）扩写一点，补充细节但别啰嗦，正文其他行都不要动。')
        ])
      ],
      [
        node('insert', '插入图片', 'submenu', '', [
          node('wechat-cover', '公众号题图', '', '给这篇文章画一张微信公众号题图，放在文章最前面。画面为 2.45:1 的横幅比例。主视觉不要用泛泛的机器人形象或模糊的科技背景，要用具体的物件表达文章主题，比如提示词卡片、设计画布、图片生成面板、封面草稿。题图上的中文主标题从文章标题提炼，必须清晰可读，最好 6 到 10 个汉字。构图要适合公众号封面：大标题放左侧，主视觉放右侧，四周留足安全边距。风格：成熟的新媒体编辑部封面，干净、精致、实用，不要廉价营销海报感。避免：乱码文字、过多小字、真实品牌 logo、纯氛围壁纸、厚重的蓝紫渐变。正文其他内容都不要动。')
        ])
      ]
    ]
  }

  return { schema: 1, pages: { 'voice-editor': { longpress: { image: imageMenu, text: textMenu } } } }
}

function parseDoc(raw) {
  const doc = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!doc || Number(doc.schema || 1) > MAX_SCHEMA) return builtin()
  return doc
}

function menu(doc, page, kind) {
  const source = doc || builtin()
  const pageConfig = source.pages && source.pages[page]
  const longpress = pageConfig && pageConfig.longpress
  return longpress ? longpress[kind] : null
}

function fill(instruction, key1, value1, key2, value2) {
  let out = instruction || ''
  out = out.replaceAll(`{{${key1}}}`, value1 == null ? '' : String(value1))
  if (key2) out = out.replaceAll(`{{${key2}}}`, value2 == null ? '' : String(value2))
  return out
}

function quotePrefix(text) {
  const trimmed = String(text || '').trim().replaceAll('"', "'")
  return trimmed.length <= 15 ? trimmed : trimmed.slice(0, 15)
}

function renderableNode(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id || '')
  const label = String(raw.label || '')
  if (!id || !label) return null
  if (raw.type === 'submenu') {
    const children = (Array.isArray(raw.children) ? raw.children : []).map(renderableNode).filter(Boolean)
    return children.length ? { id, label, type: 'submenu', children } : null
  }
  if (raw.type) return null
  const instruction = String(raw.instruction || '')
  return instruction ? { id, label, instruction } : null
}

function renderableGroups(menuConfig) {
  return ((menuConfig && menuConfig.groups) || [])
    .map((group) => (Array.isArray(group) ? group : []).map(renderableNode).filter(Boolean))
    .filter((group) => group.length)
}

function normalizeInstructionItem(raw) {
  const source = raw || {}
  const label = String(source.label || '')
  const parts = label.split('·').map((part) => part.trim()).filter(Boolean)
  const defaultName = parts.length ? parts[parts.length - 1] : label
  const defaultText = String(source.default || '')
  const override = typeof source.override === 'string' && source.override.trim() ? source.override : null
  const customLabel = typeof source.customLabel === 'string' && source.customLabel.trim() ? source.customLabel : null
  return {
    id: String(source.id || ''),
    label,
    defaultName,
    defaultText,
    override,
    customLabel,
    hidden: Boolean(source.hidden),
    effective: override || defaultText,
    effectiveLabel: customLabel || defaultName,
    customized: Boolean(override || customLabel),
    shareCode: /^\d{7}$/.test(String(source.shareCode || '')) ? String(source.shareCode) : null,
    sharing: Boolean(source.sharing)
  }
}

function cached() {
  if (typeof wx === 'undefined') return builtin()
  const raw = wx.getStorageSync(CACHE_KEY)
  if (!raw) return builtin()
  try {
    return parseDoc(raw)
  } catch (error) {
    return builtin()
  }
}

function cache(raw) {
  if (typeof wx !== 'undefined') wx.setStorageSync(CACHE_KEY, typeof raw === 'string' ? raw : JSON.stringify(raw))
}

module.exports = {
  builtin,
  parseDoc,
  menu,
  fill,
  quotePrefix,
  renderableGroups,
  normalizeInstructionItem,
  cached,
  cache
}
