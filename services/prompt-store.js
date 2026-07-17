const api = require('./api')
const authService = require('./auth')
const http = require('./request')
const tree = require('../utils/prompt-tree')

const CACHE_KEY = 'voicedrop.prompts.cache.v1'

function builtin() {
  const action = (id, label, prompt, anchor, kind) => ({ id, type: 'action', label, origin: 'system', prompt, appliesTo: [anchor], kind })
  const group = (id, label, children) => ({ id, type: 'group', label, origin: 'system', children })
  return [
    group('sys_style', '图片风格', [
      action('sys_cartoon', '卡通', '把这张图（[[photo:{{KEY}}]]）重画成宫崎骏动画的手绘卡通风格，构图和主体不变，正文其他内容都不要动。', 'image', 'image'),
      action('sys_ad', '广告', '把这张图（[[photo:{{KEY}}]]）重新设计成一则商品广告。请从专业设计师的角度，结合本篇文章的内容和受众，打造一个精致、洗练的视觉设计。整体风格要现代、极简，不使用文字，可以加一些别的代替文字的元素。请通过合理的版式构成，最大限度地突出商品的魅力。正文其他内容都不要动。', 'image', 'image'),
      action('sys_watercolor', '水彩', '把这张图（[[photo:{{KEY}}]]）重画成通透的水彩画风格，构图和主体不变，正文其他内容都不要动。', 'image', 'image'),
      action('sys_sketch', '素描', '把这张图（[[photo:{{KEY}}]]）重画成铅笔素描风格，构图和主体不变，正文其他内容都不要动。', 'image', 'image'),
      action('sys_oil', '油画', '把这张图（[[photo:{{KEY}}]]）重画成古典油画风格，构图和主体不变，正文其他内容都不要动。', 'image', 'image'),
      action('sys_film', '胶片', '把这张图（[[photo:{{KEY}}]]）调成胶片摄影的质感和色调，构图和主体不变，正文其他内容都不要动。', 'image', 'image')
    ]),
    group('sys_rewrite', '改写这段', [
      action('sys_concise', '更简洁', '把第{{LINE}}行（开头是"{{QUOTE}}"）改写得更简洁，意思不变，正文其他行都不要动。', 'text'),
      action('sys_casual', '更口语', '把第{{LINE}}行（开头是"{{QUOTE}}"）改写得更口语、像平时说话，意思不变，正文其他行都不要动。', 'text'),
      action('sys_formal', '更书面', '把第{{LINE}}行（开头是"{{QUOTE}}"）改写得更书面、更正式，意思不变，正文其他行都不要动。', 'text'),
      action('sys_expand', '扩写一点', '把第{{LINE}}行（开头是"{{QUOTE}}"）扩写一点，补充细节但别啰嗦，正文其他行都不要动。', 'text')
    ]),
    group('sys_insert', '插入图片', [
      action('sys_wechat_cover', '公众号题图', '给这篇文章画一张微信公众号题图，放在文章最前面。画面为 2.45:1 的横幅比例。主视觉不要用泛泛的机器人形象或模糊的科技背景，要用具体的物件表达文章主题，比如提示词卡片、设计画布、图片生成面板、封面草稿。题图上的中文主标题从文章标题提炼，必须清晰可读，最好 6 到 10 个汉字。构图要适合公众号封面：大标题放上面，主视觉放下面，文字左右撑满。风格：成熟的新媒体编辑部封面，干净、精致、实用，不要廉价营销海报感。避免：乱码文字、过多小字、真实品牌 logo、纯氛围壁纸、厚重的蓝紫渐变。正文其他内容都不要动。', 'text', 'image'),
      action('sys_cartoon_explainer', '卡通解释图', '给这篇文章画一张扁平卡通风格的解释图（flat cartoon explanation illustration），插入到正文最能帮助理解的位置，让没读过文章的人扫一眼就能看懂文章的核心结构。先读懂全文，找出核心结构——分几个阶段？有什么对比？有什么递进？——再把这个结构画出来。画幅比例由内容决定，以一眼读懂为准：双行对照用 3:2 或 4:3 横版，流程递进用横长条（2.45:1 或 3:1），层级深度用竖版（3:4 或 4:5），凝聚式概念用方形 1:1。风格：像 New Yorker 杂志插图、xkcd 或高级科普读物的插画，既有趣又有思想深度；人物几何化简化（火柴人或圆头方身），线条清晰，无写实细节；配色温暖克制，最多 4 到 5 种主色，建议米白底加深色线条加 1 到 2 个强调色（橙红、墨绿、深蓝任选）；质感纯平面或轻微手绘线条感，像在白纸上手绘的概念图，不像 PPT 或 Canva 模板。构图：把核心层级、阶段或对比关系分区并列展开（从左到右、上下分层或环形排布），用箭头、台阶、流程线等通用视觉符号连接各区；每个分区只画 1 个主场景加 1 个核心物件，不堆细节；每个分区可配 1 个 2 到 6 字的中文短标签，标签必须准确、可读、无伪汉字；分区之间留呼吸空间，整体不能挤。必须避免：真人脸部（用简化几何代替）、文字过多（只用关键标签，不是 PPT）、抽象到看不懂（必须能读图理解文章）、风格不统一、饱和霓虹、廉价渐变、3D 拟真、金属玻璃光泽、儿童读物感、中国风滥用、任何水印签名 Logo 二维码、错字漏字伪中文笔画。正文其他内容都不要动。', 'text', 'image')
    ])
  ]
}

function defaultStorage() {
  return {
    get: (key) => typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function' ? null : wx.getStorageSync(key),
    set: (key, value) => { if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') wx.setStorageSync(key, value) }
  }
}

function createStore(deps = {}) {
  const request = deps.request || http
  const storage = deps.storage || defaultStorage()
  const auth = deps.auth || authService
  const base = deps.base || api.agentBase()
  let items = loadCache(storage)
  let lastError = ''
  let mutating = false

  function loadCache(source) {
    const raw = source.get(CACHE_KEY)
    if (raw) { try { return tree.decodeItems(raw).items } catch (_) {} }
    return tree.clone(builtin())
  }

  function saveCache() { storage.set(CACHE_KEY, JSON.stringify({ schema: 1, items })) }
  function ok(res) { return res && res.statusCode >= 200 && res.statusCode < 300 }

  async function refresh() {
    try {
      const res = await request.get(`${base}/prompts`, auth.bearer())
      if (!ok(res)) throw new Error('http')
      items = tree.decodeItems(res.data).items; saveCache(); lastError = ''
      return { ok: true, items: tree.clone(items) }
    } catch (_) {
      lastError = '加载失败'
      return { ok: false, error: 'load_failed', items: tree.clone(items) }
    }
  }

  async function transact(draftMaker) {
    if (mutating) return { ok: false, error: 'busy' }
    const snapshot = tree.clone(items)
    mutating = true
    try {
      items = draftMaker(tree.clone(items))
      const res = await request.putJson(`${base}/prompts`, auth.bearer(), { items: tree.rawItems(items) })
      if (!ok(res)) throw new Error('save')
      items = tree.decodeItems(res.data).items; saveCache(); lastError = ''
      return { ok: true, items: tree.clone(items) }
    } catch (_) {
      items = snapshot
      return { ok: false, error: 'save_failed' }
    } finally { mutating = false }
  }

  async function replace(id, node) { return transact((source) => tree.replace(source, id, node).items) }
  async function remove(id) { return transact((source) => tree.remove(source, id).items) }
  async function add(node, groupId) { return transact((source) => tree.append(source, node, groupId)) }
  async function applyReorder(draft, baseline) {
    if (JSON.stringify(tree.flattenIds(items)) !== JSON.stringify(baseline || [])) return { ok: false, error: 'conflict' }
    return transact(() => tree.clone(draft))
  }

  async function restoreDefaults() {
    if (mutating) return { ok: false, error: 'busy' }
    mutating = true
    try {
      const res = await request.postJson(`${base}/prompts/restore-defaults`, auth.bearer(), {})
      if (!ok(res)) return { ok: false, error: 'restore_failed' }
      items = tree.decodeItems(res.data).items; saveCache()
      return { ok: true, items: tree.clone(items) }
    } catch (_) { return { ok: false, error: 'network_error' } } finally { mutating = false }
  }

  async function preview(code) {
    try {
      const res = await request.get(`${base}/prompt-share/${code}`, '')
      return ok(res) ? { ok: true, data: res.data || {} } : { ok: false, error: res && res.statusCode === 404 ? 'not_found' : 'preview_failed' }
    } catch (_) { return { ok: false, error: 'network_error' } }
  }

  async function importCode(code) {
    if (tree.extractShareCode(code) !== code) return { ok: false, error: 'invalid_code' }
    try {
      const res = await request.postJson(`${base}/prompts/import`, auth.bearer(), { code })
      if (!ok(res) || !res.data || !res.data.item) return { ok: false, error: 'import_failed' }
      const imported = tree.cloneNode(res.data.item)
      const existing = tree.flattenIds(items).includes(imported.id)
      if (!existing) items = [...tree.clone(items), imported]
      saveCache()
      return { ok: true, item: tree.cloneNode(imported), already: Boolean(res.data.already || existing) }
    } catch (_) { return { ok: false, error: 'network_error' } }
  }

  async function shareStates() {
    try {
      const res = await request.get(`${base}/prompt-shares`, auth.bearer())
      return ok(res) ? { ok: true, byItem: res.data && res.data.byItem || {} } : { ok: false, error: 'share_failed', byItem: {} }
    } catch (_) { return { ok: false, error: 'network_error', byItem: {} } }
  }

  async function setSharing(id, on) {
    const session = typeof auth.session === 'function' ? auth.session() : ''
    if (!session) return { ok: false, error: 'needs_wechat_signin' }
    try {
      const res = on
        ? await request.postJson(`${base}/prompt-share`, session, { id })
        : await request.del(`${base}/prompt-share/${encodeURIComponent(id)}`, session)
      if (res && res.statusCode === 429) return { ok: false, error: 'daily_cap' }
      if (!ok(res)) {
        const remote = String(res && res.data && res.data.error || '')
        const error = remote === 'needs_apple_signin' ? 'needs_wechat_signin' : (remote || 'share_failed')
        return { ok: false, error, statusCode: res && res.statusCode }
      }
      return { ok: true, code: String(res.data && res.data.code || ''), sharing: Boolean(res.data && res.data.sharing), url: res.data && res.data.url, communityShareId: res.data && res.data.communityShareId }
    } catch (_) { return { ok: false, error: 'network_error' } }
  }

  return {
    items: () => tree.clone(items), error: () => lastError, isMutating: () => mutating,
    refresh, replace, remove, add, applyReorder, restoreDefaults, preview, importCode, shareStates, setSharing,
    menu: (anchor) => tree.menu(items, anchor)
  }
}

const store = createStore()
module.exports = Object.assign(store, { createStore, CACHE_KEY, builtin })
