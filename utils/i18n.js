// App-local language selection.  Keep this small module as the single place
// that resolves the user's choice; pages should consume translated copy rather
// than branching on a locale themselves.
const LANGUAGE_KEY = 'appLanguage'
const FOLLOW_SYSTEM = ''
const SIMPLIFIED_CHINESE = 'zh-Hans'
const ENGLISH = 'en'

const ENGLISH_UI = {
  '设置': 'Settings',
  '账户': 'Account',
  '算力': 'Credits',
  '关于': 'About',
  '使用手册': 'User Guide',
  '意见反馈': 'Feedback',
  '录音': 'Record',
  '写作风格': 'Writing Style',
  '提示词': 'Prompts',
  '编辑提示词': 'Edit Prompt',
  '微信公众号': 'WeChat Official Account',
  '社区屏蔽管理': 'Blocked Users',
  '音频信息授权协议': 'Audio Information Consent',
  '语言': 'Language',
  '我的录音': 'Recordings',
  'VD社区': 'VD Community',
  '写书': 'Books',
  'VoiceDrop 口述': 'VoiceDrop Dictation'
}

// Template copy is deliberately keyed by the Chinese source string.  This
// keeps product copy in one place while allowing legacy WXML templates to
// bind a locale-aware value without changing any API or user-content field.
// Do not put article bodies, transcripts, titles, comments, or server errors
// here: those are user content and must remain in their original language.
const ENGLISH_COPY = {
  '加载中…': 'Loading…', '加载中...': 'Loading…', '正在加载...': 'Loading…',
  '取消': 'Cancel', '完成': 'Done', '删除': 'Delete', '切换': 'Switch', '重试': 'Retry',
  '分享': 'Share', '拍照': 'Take Photo', '相册': 'Photo Album', '隐藏': 'Hidden',
  'AI生成': 'AI-generated', '提示词': 'Prompts', '回应': 'Reply', '推荐': 'Recommended',
  '最新': 'Latest', '写书': 'Write a Book', '写一本新书': 'Write a New Book',
  '正在整理书架…': 'Organizing your bookshelf…', '还没有录音': 'No recordings yet',
  '社区暂无文章': 'No community posts yet', '稍后刷新，或先分享自己的文章。': 'Refresh later, or share one of your articles first.',
  '输入访问令牌': 'Enter access token', '账户': 'Account', '你的 ID': 'Your ID',
  '访问令牌': 'Access token', '退出登录': 'Sign out', '数据': 'Data', '录音': 'Recordings',
  '成文': 'Articles', '账户管理': 'Account management', '删除账户': 'Delete account',
  '不同意': 'Decline', '同意并继续': 'Agree and continue', '查看完整协议': 'View full agreement',
  '音频信息授权': 'Audio information consent', '开始使用': 'Get started', '基础流程': 'How it works',
  '发送': 'Send', '发送中…': 'Sending…', '关于': 'About', '帮助与反馈': 'Help & feedback',
  '意见反馈': 'Feedback', '使用手册': 'User Guide', '隐私说明': 'Privacy', '社区公约': 'Community Guidelines',
  '已屏蔽用户': 'Blocked users', '支持与投诉': 'Support & complaints', '没有已屏蔽的作者': 'No blocked authors',
  '取消屏蔽': 'Unblock', '剩余算力': 'Credits remaining', '算力来源': 'Credit sources',
  '花费总结': 'Spending summary', '明细': 'Details', '暂无算力明细': 'No credit activity yet',
  '当前写作风格': 'Current writing style', '保存文风': 'Save style', '暂无文风历史': 'No style history yet',
  '修改文章': 'Edit article', '提交修改': 'Submit changes', '版本历史': 'Version history',
  '暂无历史版本': 'No version history', '插入图片': 'Insert image', '换个风格重写': 'Rewrite in another style',
  '文章还没生成': 'Your article is not ready yet', '正在制作中': 'Creating', '暂时无法显示': 'Unavailable for now',
  '写回应': 'Write a reply', '举报': 'Report', '屏蔽此用户': 'Block this user',
  '图片加载失败': 'Image failed to load', '继续阅读 ↓': 'Continue reading ↓', '怎么用': 'How to use',
  '正在检查连接状态...': 'Checking connection…', '已授权账号': 'Authorized account',
  '生成并复制授权链接': 'Create and copy authorization link', '取消连接': 'Disconnect', '连接方法': 'How to connect',
  '电脑打开': 'Open on a computer', '手机打开': 'Open on your phone',
  '菜单里的名字': 'Menu name', '适用于': 'Applies to', '文字': 'Text', '图片': 'Image',
  '分享这条提示词': 'Share this prompt', '复制数字': 'Copy code', '复制链接': 'Copy link', '分享…': 'Share…',
  '新建': 'New', '新建动作': 'New action', '新建分组': 'New group', '创建': 'Create',
  '导入提示词': 'Import prompts', '输入魔法数字导入': 'Import with a code', '加入我的提示词': 'Add to my prompts',
  '恢复默认提示词': 'Restore default prompts', '社区提示词': 'Community prompts',
  '正在加载提示词…': 'Loading prompts…', '正在加载社区提示词…': 'Loading community prompts…',
  '暂时没有可用的社区提示词': 'No community prompts are available yet',
  '录音结束后将由人工智能转写并生成文章': 'Your recording will be transcribed and turned into an article by AI.',
  '采访': 'Interview', '点击停止': 'Tap to stop', '语言': 'Language', '其他': 'Other', '写作': 'Writing',
  '发布': 'Publishing', '名字': 'Name', '写作风格': 'Writing style', '微信公众号': 'WeChat Official Account',
  '加入社群': 'Join the community', '清除缓存': 'Clear cache', '自动分享到 VD 社区': 'Automatically share to VD Community'
  , '我们不会提取声纹模板，也不会使用音频进行声纹身份识别。': 'We do not extract voiceprints or use audio for voiceprint identification.'
  , '在这台设备上自动生成，不需要用户名或密码。': 'Generated automatically on this device. No username or password is needed.'
  , '输入访问令牌（切换到已有账号）': 'Enter an access token to switch to an existing account'
  , '永久删除云端与本机的全部数据（录音、文章、照片、设置、社区分享、登录绑定），不可恢复。': 'Permanently delete all cloud and local data, including recordings, articles, photos, settings, community shares, and login links. This cannot be undone.'
  , '粘贴另一台设备「账户 → 访问令牌」复制的 anon_ 令牌，本机将切换到该账号（当前身份会被替换）。': 'Paste the anon_ token copied from Account → Access token on another device. This device will switch accounts.'
  , 'VoiceDrop 口述': 'VoiceDrop Dictation', '输入 7 位分享码，也可以粘贴包含分享码的链接。': 'Enter a 7-digit sharing code, or paste a link that contains one.'
  , '一条 VoiceDrop 提示词 · 分享码': 'A VoiceDrop prompt · Sharing code', '提示词内容暂不可读，请稍后刷新。': 'This prompt cannot be read right now. Please refresh later.'
  , '这是你分享的提示词。把分享码发给朋友，或在 设置 → 提示词 里管理。': 'This is a prompt you shared. Send its code to friends or manage it in Settings → Prompts.'
  , '想长期用：点下面「收下这条提示词」，之后长按菜单里随手可用。': 'To keep it: tap “Save this prompt” below, then use it from the long-press menu anytime.'
  , '社区正文暂不可读，请稍后刷新或打开分享链接查看。': 'This community post cannot be read right now. Refresh later or open its sharing link.'
  , '草稿箱已就绪 · VoiceDrop 不会自动群发': 'Drafts are ready · VoiceDrop never sends mass messages automatically'
  , '1. 点击“生成并复制授权链接”，链接会自动复制': '1. Tap “Create and copy authorization link”; it is copied automatically.'
  , '2. 任选一种方式打开链接': '2. Open the link using either method below.'
  , '复制链接至电脑浏览器打开，再用手机微信扫码': 'Open the copied link in a desktop browser, then scan it with WeChat on your phone.'
  , '复制链接至手机浏览器中打开，对页面进行截图，随后打开微信“扫一扫”，选择相册中的截图进行识别': 'Open the copied link in your phone browser, screenshot the page, then scan that screenshot in WeChat.'
  , '3. 选择要绑定的公众号并确认授权，然后返回 VoiceDrop': '3. Choose the Official Account to connect, authorize it, then return to VoiceDrop.'
  , '开始写了！': 'Writing has started!', '现在可以关掉小程序。书通常 10–30 分钟写完，过稿一章、上架一章——写好就出现在「写书」书架上，下拉刷新就能看到。': 'You can close the mini program now. Books usually take 10–30 minutes; approved chapters appear on your bookshelf as they are ready. Pull down to refresh.'
  , '好': 'OK', '本功能使用人工智能生成书籍内容': 'This feature uses AI to generate book content', '算力': 'Credits'
  , '写一本书的价钱，提交时一次扣清': 'The cost of one book, charged when you submit', '你现在的算力': 'Your current credits', '算力不够？': 'Need more credits?'
  , '请朋友给你的文章「加油」——': 'Ask friends to boost your article —', '把文章分享到 VD社区或发给朋友，读的人点「加油」你就进账': 'Share an article to VD Community or with friends; when readers boost it, you earn credits.'
  , '邀请朋友装 VoiceDrop——': 'Invite friends to install VoiceDrop —', '朋友通过你的链接安装，双方都到账': 'When friends install through your link, you both receive credits.'
  , '把邀请链接发给朋友': 'Send invite link to friends', '可以补充这本书往哪儿写：比如“写成给孩子的绘本”“扩成一本科普书”“沿着文中第三点展开”。不填就由写书代理自己定。': 'Add any direction for the book, such as making it a children’s picture book or expanding its third point. Leave blank to let the writing agent decide.'
  , '一句话说清这本书要讲明白的那一个问题或主张。想法越聚焦，书越好看；也可以贴一整篇文章当种子。': 'State the one question or idea this book should explain. A focused idea makes a better book; you can also paste a full article as a seed.'
  , '怎么写成': 'How it is written', '拆大纲': 'Build outline', 'AI 建筑师把中心思想拆成一环扣一环的章节': 'An AI architect turns the central idea into connected chapters.'
  , '并行写': 'Write in parallel', '每章一个写手，费曼式大白话，名词当场讲人话': 'One writer per chapter, using clear plain language.'
  , '独立评审': 'Independent review', '另一个 AI 只看成稿挑错，不过就打回重写': 'Another AI reviews the draft and sends it back for revision when needed.'
  , '上你的架': 'Publish to your shelf', '过一章发一章到「写书」书架，署你的名字（设置里的「名字」）': 'Each approved chapter goes to your bookshelf under your name from Settings.'
  , 'AI生成 · 提交后可关闭小程序，10–30 分钟写完并出现在「写书」书架': 'AI-generated · You can close the mini program after submitting; the book appears on your bookshelf in 10–30 minutes.'
  , '一套指令，长按文字或图片时按『适用于』自动筛选。改过的系统项标『已自定义』，自己建的标『自建』，收下别人分享的标『导入』。': 'Prompts are filtered by “Applies to” when you long-press text or images. Changed system prompts are “Customized”, your own are “Created”, and saved shared prompts are “Imported”.'
  , '长按提示词并拖动排序；拖到分组行可收进该组。': 'Long-press and drag prompts to reorder them; drag one to a group row to place it in that group.'
  , '还没有提示词，可点击右上角新建': 'No prompts yet. Tap New in the top right to create one.', '把别人分享的提示词存进你的菜单': 'Save another person’s shared prompt to your menu'
  , '也可以在录音时直接对 VoiceDrop 说出数字，或点开 voicedrop.cn 链接自动跳转到这里。': 'You can also say the code to VoiceDrop while recording, or open a voicedrop.cn link to come here automatically.'
  , '一条提示词指令': 'One prompt instruction', '收纳几个动作，菜单里成二级子菜单': 'Organize actions into a submenu', '输入 7 位魔法数字，或粘贴分享链接': 'Enter a 7-digit code, or paste a sharing link'
  , '导入后是你自己的副本，可改名、改内容、随时删除；原作者之后的修改不影响你。': 'After importing, this is your own copy: rename, edit, or delete it anytime. Later changes by the original author do not affect it.'
  , '被导入': 'Imports', '提示词全文': 'Full prompt', '正在加载提示词全文…': 'Loading full prompt…', '效果示例': 'Example output'
  , '有新设备想登录你的账号': 'A new device wants to sign in to your account', '在新设备上输入下面的验证码': 'Enter the code below on the new device'
  , '不是你本人操作？点「不是我」。': 'Wasn’t this you? Tap “Not me”.', '不是我': 'Not me', '这是我': 'This is me', '请重新打开小程序': 'Please reopen the mini program'
  , '决定在哪种长按里出现': 'Choose which long-press menus this appears in', '转发原作者的版本；改动正文保存后会自动停止转发': 'You are sharing the original author’s version; saving edits stops forwarding it.'
  , '分享的始终是已保存的版本': 'Only the saved version is shared', '稍后刷新，或回到列表查看处理状态。': 'Refresh later, or return to the list to see processing status.'
  , '约 1 分钟完成': 'About 1 minute', 'VD社区可见': 'Visible in VD Community', '扩展成一本书': 'Expand into a book', '分享到小红书': 'Share to Xiaohongshu'
  , '发布公众号草稿': 'Publish Official Account draft', '更新公众号草稿': 'Update Official Account draft'
  , '正在准备微信卡片…': 'Preparing WeChat card…', '微信卡片准备失败，点此重试': 'Could not prepare WeChat card. Tap to retry.'
  , '选一个范文版本，把本文重写一遍。原文不变，可随时换回。': 'Choose a style version to rewrite this article. The original remains unchanged and can be restored anytime.'
  , '正在加载文风...': 'Loading writing styles…', '拍照或从相册选择，照片会交给 AI 放进文章': 'Take a photo or choose one from your album; AI will place it in the article.'
  , '正在读取修改记录…': 'Reading revision history…', '把口述录音自动变成文章的小程序客户端。': 'A mini program that turns dictated recordings into articles.'
  , '怎么录、怎么改、怎么发': 'How to record, edit, and publish', '提改进意见，直达开发者': 'Send improvement ideas directly to the developer', '隐私与社区': 'Privacy & community'
  , '音频信息授权协议': 'Audio information consent agreement', '署名和挖文章时对你的称呼': 'Your byline and how the app addresses you while creating articles'
  , '成文时模仿这套语气': 'Use this tone when creating articles', '自定义长按菜单里的每个动作': 'Customize every action in the long-press menu'
  , '成文一键推送到草稿箱': 'Send finished articles to your draft box with one tap', '挖出新文章后自动发到社区': 'Automatically post newly created articles to the community'
  , '和 VoiceDrop 用户一起交流': 'Connect with other VoiceDrop users', '跟随系统、简体中文或 English': 'Follow System, Simplified Chinese, or English'
  , '文章与图片缓存': 'Article and image cache', '加入 VoiceDrop 社群': 'Join the VoiceDrop community'
  , '点击“加入社群”，即可进入对应社群。': 'Tap “Join the community” to enter the relevant group.', '这个名字会出现在文章署名，以及挖文章时对你的称呼。随时可改。': 'This name appears in article bylines and is how the app addresses you while creating articles. You can change it anytime.'
  , '选择一个版本，将自动切换为当前写作风格。': 'Choose a version to make it your current writing style.'
  , '当前风格': 'Current style', '未命名写作风格': 'Untitled writing style'
  , '算力变动': 'Credit activity', '累计获得 ': 'Total earned ', ' · 已用 ': ' · Used '
  , '共 ': '', ' 个版本': ' versions', ' 字 · ': ' characters · ', '未记录日期': 'Date unavailable'
  , '这条提示词暂时无法读取。': 'This prompt cannot be read right now.'
  , '分享者：': 'Shared by: ', '已被导入 ': 'Imported ', ' 次': ' times', ' 人': ' people'
  , '未登录微信': 'Not signed in to WeChat', '已用微信登录': 'Signed in with WeChat', '正在登录微信...': 'Signing in to WeChat…'
  , '用于同步设备和参与社区': 'Used to sync devices and participate in the community'
  , '社区提示词加载失败，点此重试': 'Could not load community prompts. Tap to retry.'
  , '返回': 'Back', '书籍操作': 'Book actions', '7 位分享码': '7-digit sharing code', '设置': 'Settings'
  , '投币': 'Boost', '喜欢': 'Like', '更多': 'More', 'AI生成内容': 'AI-generated content', '新建': 'New'
  , '分组名字': 'Group name', '关闭': 'Close', 'AI生成内容说明': 'AI-generated content notice', '删除照片': 'Delete photo'
  , '搜索社区': 'Search community', '搜索标题、作者或内容': 'Search title, author, or content', '设备登录请求': 'Device sign-in request'
  , '验证码 {{linkRequest.code}}': 'Verification code {{linkRequest.code}}', '上一版': 'Previous version', '下一版': 'Next version'
  , '输入修改要求，例如：把开头改得更直接': 'Enter editing instructions, for example: make the opening more direct'
  , '分享给微信好友': 'Share with WeChat friends', '删除图片': 'Delete image'
  , '哪里不顺手？想要什么功能？写一句就行。': 'What feels awkward? What feature would you like? A sentence is enough.'
  , '想怎么改这本书？比如：第三章开头太啰嗦，删一半': 'How would you like to revise this book? For example: shorten the beginning of chapter 3 by half.'
  , '发送修改指令': 'Send revision instruction', '例如：胸有成竹地下断言，不绕弯；语气自然，可以添加 emoji': 'For example: make confident, direct claims in a natural tone; emojis are welcome.'
  , '你的名字': 'Your name', '已收下': 'Saved', '收下这条提示词': 'Save this prompt'
  , '结束采访': 'End interview', '开始采访': 'Start interview', '停止录音': 'Stop recording', '开始录音': 'Start recording'
  , '验证码 ': 'Verification code ', '停止播放': 'Stop playback', '播放录音': 'Play recording'
  , '提交中…': 'Submitting…', '算力不够 · 还差 ': 'Not enough credits · Need ', '开始写书 · 320 算力': 'Start writing · 320 credits'
  , '修改《': 'Edit “', '》': '”'
  , 'Token 已导入': 'Token imported'
  , '图片风格': 'Image styles', '卡通': 'Cartoon', '广告': 'Advertisement', '水彩': 'Watercolor', '素描': 'Sketch', '油画': 'Oil painting', '胶片': 'Film'
  , '改写这段': 'Rewrite this', '更简洁': 'More concise', '更口语': 'More conversational', '更书面': 'More formal', '扩写一点': 'Expand a little', '公众号题图': 'Official Account cover'
  , '正在上传': 'Uploading', '已成文': 'Article ready', '无语音': 'No speech', '听录音': 'Transcribing', '挖文章': 'Writing article', '录音过长': 'Recording too long', '余额不足': 'Insufficient credits', '待处理': 'Pending'
  , '1 上手': '1 Getting started', '2 录音': '2 Recording', '3 改稿': '3 Editing', '4 发布': '4 Publishing', '5 社区': '5 Community', '6 文风': '6 Writing style', '7 账号': '7 Account'
  , '拷贝': 'Copy', '编辑': 'Edit'
  , '选一个版本': 'Choose a version', '按住说话，修改文章': 'Hold to speak and edit', '松开 发送 · 上滑取消': 'Release to send · Swipe up to cancel', '上滑取消 · 松开放弃': 'Swipe up to cancel · Release to discard', '正在整理…': 'Preparing…', '正在连接…': 'Connecting…', '在听…': 'Listening…', '正在改…按住继续说': 'Editing… Hold to keep speaking', '加载中...': 'Loading…'
  , '选风格': 'Choose style'
  , '热门': 'Popular', '配图': 'Images', '轻点录音 · 长按说话': 'Tap to record · Hold to speak', '匿名 ID 保存在本机': 'Your anonymous ID is stored on this device', '已登录微信账号': 'Signed in with WeChat', '计算中': 'Calculating…', '暂不可用': 'Unavailable'
  , 'AI 连接中…': 'AI connecting…', 'AI 已断开 · 录音继续': 'AI disconnected · Recording continues', 'AI 采访暂不可用 · 录音继续': 'AI interview unavailable · Recording continues', 'AI 语音播放异常 · 采访仍在进行': 'AI playback issue · Interview continues', 'AI 正在说话': 'AI is speaking', 'AI 采访中 · 再点一下结束': 'AI interview · Tap again to end', 'AI 采访中': 'AI interview'
  , '正在录音': 'Recording'
  , '体验版': 'Trial build', '正式版': 'Release build', '开发版': 'Development build'
  , '为向你提供语音转写、文章生成和编辑、语音指令及社区回应功能，VoiceDrop 会在你主动操作后录制并上传音频。音频中可能包含能够识别个人的声音特征。': 'To provide transcription, article creation and editing, voice commands, and community replies, VoiceDrop records and uploads audio only after you initiate an action. Audio may contain characteristics that can identify a person.'
  , '需要录音权限': 'Microphone permission required', '请允许使用麦克风进行录音和语音处理': 'Allow microphone access for recording and voice processing', '去设置': 'Open Settings'
  , '需要相册权限': 'Photo Album permission required', '请允许保存小红书图片到相册': 'Allow saving Xiaohongshu images to your Photo Album'
  , '录音、文章、图片、文风和公众号配置会按访问令牌同步到 VoiceDrop 后端。请妥善保存访问令牌。': 'Recordings, articles, photos, writing styles, and Official Account settings are synced to the VoiceDrop backend using your access token. Keep the token safe.'
  , '约可成文 ': 'About ', ' 篇': ' articles', '已连接': 'Connected', '未连接': 'Not connected', '当前版本 ': 'Version '
  , '已连接微信公众号': 'WeChat Official Account connected', '未连接微信公众号': 'WeChat Official Account not connected'
  , '授权成功，现在可以将文章保存或更新到公众号草稿箱。': 'Authorization succeeded. You can now save or update articles in your Official Account draft box.'
  , '连接后，VoiceDrop 可以将文章保存到你的公众号草稿箱。不会自动群发。': 'After connecting, VoiceDrop can save articles to your Official Account draft box. It never sends mass messages automatically.'
  , '登录中...': 'Signing in…', '微信登录': 'Sign in with WeChat', '已授权': 'Authorized', '未授权': 'Not authorized'
  , '正在读取...': 'Reading…', '确认导入': 'Confirm import', '保存中': 'Saving…', '保存': 'Save'
  , '转发中：这是原作者的分享码，关闭只停止转发，码不会失效': 'Forwarding: this is the original author’s sharing code. Turning this off only stops forwarding; the code remains valid.'
  , '分享中：社区可见，关闭后分享码失效、社区帖撤下': 'Sharing: visible in the community. Turning this off invalidates the code and removes the community post.'
  , '开启后发布到社区，并得到分享码短链': 'Turn this on to publish to the community and receive a short sharing code.'
  , '发送失败，请检查网络后重试': 'Send failed. Check your network and try again.', '会带上你的账户身份，方便改进后回访。': 'Your account identity is included so we can follow up after improvements.'
  , '仅图片': 'Images only', '仅文字': 'Text only', '文字+图片': 'Text + images', '全部': 'All', '配图提示词': 'Image prompt', '文字提示词': 'Text prompt'
  , '导入': 'Imported', '导入提示词操作': 'Import', '已自定义': 'Customized', '自建': 'Created', '匿名': 'Anonymous', '导入 ': 'Imports ', '已导入': 'Imported', '导入中…': 'Importing…', '已在我的提示词里': 'Already in my prompts'
}

function storageOf(storage) {
  if (storage) return storage
  return {
    get: (key) => (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function' ? undefined : wx.getStorageSync(key)),
    put: (key, value) => { if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') wx.setStorageSync(key, value) }
  }
}

function normalizeLanguage(value) {
  const language = String(value || '').replace('_', '-').toLowerCase()
  if (language === ENGLISH || language.startsWith('en-')) return ENGLISH
  if (language === SIMPLIFIED_CHINESE.toLowerCase() || language.startsWith('zh')) return SIMPLIFIED_CHINESE
  return FOLLOW_SYSTEM
}

function systemLanguage(systemInfo) {
  const info = systemInfo || (typeof wx === 'undefined' || typeof wx.getSystemInfoSync !== 'function' ? {} : wx.getSystemInfoSync())
  return normalizeLanguage(info && info.language) || SIMPLIFIED_CHINESE
}

function selectedLanguage(storage) {
  return normalizeLanguage(storageOf(storage).get(LANGUAGE_KEY))
}

function setSelectedLanguage(language, storage) {
  storageOf(storage).put(LANGUAGE_KEY, normalizeLanguage(language))
}

/**
 * Broadcast a persisted language choice to every page currently in the stack.
 * A page may expose `onLanguageChanged(language)` to replace its dynamic copy.
 * Keeping this here avoids each settings surface inventing incompatible refresh
 * behaviour, while pages with static legacy copy remain safe no-ops.
 */
function notifyLanguageChanged(language) {
  const effectiveLanguage = normalizeLanguage(language) || currentLanguage()
  if (typeof getApp === 'function') {
    const app = getApp()
    if (app && app.globalData) {
      app.globalData.language = effectiveLanguage
      app.globalData.languageRevision = Number(app.globalData.languageRevision || 0) + 1
    }
  }
  if (typeof getCurrentPages !== 'function') return effectiveLanguage
  for (const page of getCurrentPages() || []) {
    if (page && typeof page.onLanguageChanged === 'function') page.onLanguageChanged(effectiveLanguage)
  }
  return effectiveLanguage
}

function currentLanguage(storage, systemInfo) {
  return selectedLanguage(storage) || systemLanguage(systemInfo)
}

function languageLabel(language, storage, systemInfo) {
  const selected = normalizeLanguage(language)
  if (!selected) return currentLanguage(storage, systemInfo) === ENGLISH ? 'Follow System' : '跟随系统'
  return selected === ENGLISH ? 'English' : '简体中文'
}

/** Translate shared shell labels; feature pages keep their own richer copy. */
function ui(value, language, storage, systemInfo) {
  const text = String(value || '')
  if ((language || currentLanguage(storage, systemInfo)) !== ENGLISH) return text
  return ENGLISH_UI[text] || ENGLISH_COPY[text] || text
}

// Native feedback is interface copy, but it is intentionally separate from
// `ui()`: page titles can contain user-created prompt names and article names,
// which must never be translated or replaced.  For legacy feedback that has
// not yet been promoted into the exact dictionary, use a clear English
// fallback rather than leaking Chinese into an English interface.
function message(value, language, storage, systemInfo) {
  const text = String(value || '')
  if ((language || currentLanguage(storage, systemInfo)) !== ENGLISH) return text
  const exact = ENGLISH_UI[text] || ENGLISH_COPY[text]
  if (exact) return exact
  if (!/[\u4e00-\u9fff]/.test(text)) return text
  const fragments = [
    ['加载失败', 'Failed to load'], ['保存失败', 'Failed to save'], ['上传失败', 'Upload failed'], ['录音失败', 'Recording failed'],
    ['登录失败', 'Sign-in failed'], ['发布失败', 'Publishing failed'], ['分享失败', 'Sharing failed'], ['导入失败', 'Import failed'],
    ['删除失败', 'Delete failed'], ['切换失败', 'Switch failed'], ['操作失败', 'Action failed'], ['网络异常', 'Network error'],
    ['请稍后再试', 'Please try again later'], ['请重试', 'Please try again'], ['正在上传', 'Uploading'], ['上传中', 'Uploading'],
    ['正在加载', 'Loading'], ['加载中', 'Loading'], ['正在保存', 'Saving'], ['保存中', 'Saving'], ['正在删除', 'Deleting'],
    ['已删除', 'Deleted'], ['已保存', 'Saved'], ['已上传', 'Uploaded'], ['已登录', 'Signed in'], ['已发布', 'Published'],
    ['已取消', 'Canceled'], ['没有音频', 'No audio'], ['没有识别到语音', 'No speech detected'], ['内容不能为空', 'Content cannot be empty'],
    ['当前微信不支持', 'This version of WeChat does not support'], ['最多选择', 'You can select up to'], ['张图片', ' images'],
    ['录音太短', 'Recording is too short'], ['时间太短，不足以产生文章', 'The recording is too short to create an article'],
    ['文章还没生成', 'Your article is not ready yet'], ['暂无文风版本', 'No writing style versions'], ['文风加载失败', 'Failed to load writing styles'],
    ['请选择文风', 'Please choose a writing style'], ['重写成功', 'Rewrite completed'], ['历史加载失败', 'Failed to load history'],
    ['没有更早版本', 'No earlier version'], ['没有更新版本', 'No newer version'], ['听写失败', 'Transcription failed'],
    ['无法打开这个地址', 'This address cannot be opened'], ['名字已保存', 'Name saved'], ['缓存已清除', 'Cache cleared']
  ]
  let translated = text
  fragments.forEach(([source, target]) => { translated = translated.split(source).join(target) })
  translated = translated.replace(/，/g, ', ').replace(/。/g, '.').replace(/：/g, ': ')
  return /[\u4e00-\u9fff]/.test(translated) ? 'The operation could not be completed.' : translated
}

function copy(language, storage, systemInfo) {
  const effectiveLanguage = language || currentLanguage(storage, systemInfo)
  const result = {}
  Object.keys(ENGLISH_COPY).forEach((key) => {
    result[key] = effectiveLanguage === ENGLISH ? ENGLISH_COPY[key] : key
  })
  return result
}

module.exports = {
  LANGUAGE_KEY,
  FOLLOW_SYSTEM,
  SIMPLIFIED_CHINESE,
  ENGLISH,
  normalizeLanguage,
  systemLanguage,
  selectedLanguage,
  setSelectedLanguage,
  notifyLanguageChanged,
  currentLanguage,
  languageLabel,
  ui,
  message,
  copy
}
