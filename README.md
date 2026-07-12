# VoiceDrop Mini

VoiceDrop 的微信原生小程序客户端：把口述录音上传并转写为文章，支持编辑、配图、分享、VD 社区发布和微信公众号草稿。

本项目与 VoiceDrop Android、[VoiceDrop iOS](https://github.com/jianshuo/voicedrop) 共享核心业务语义，并针对微信小程序的权限、网络和交互能力做平台适配。

## 主要功能

- 录音、上传、文章生成状态和录音列表管理。
- 文章阅读、播放、版本切换、自然语言编辑和长按快捷编辑。
- 相册/拍照插图、图片 marker 解析和图片风格处理。
- 分享链接、微信公众号草稿与 VD 社区发布。
- 社区浏览、推荐、回应、举报和作者屏蔽。
- 微信登录、账号切换确认、匿名会话与设备配对。
- 文风配置、文风素材收集、用量查询和导出入口。

## 工作流程

```text
录音 → 上传 → 转写/生成 → 编辑与配图 → 分享、公众号草稿或 VD 社区
```

跨端共享的关键约定包括：

- 录音文件名：`VoiceDrop-...m4a`
- 文章图片 marker：`[[photo:photos/<sessionTs>/<offset>-<rand>.jpg]]`
- HTTP 与 WebSocket 的状态、事件顺序和错误语义以服务端契约为准

## 技术栈

- 微信小程序原生 JavaScript、WXML、WXSS
- 微信小程序 `request`、`uploadFile`、`downloadFile` 与 `SocketTask`
- Node.js 内置测试运行器

## 目录结构

```text
.
├── app.js / app.json / app.wxss
├── components/       # 可复用组件
├── pages/            # 页面与交互逻辑
├── services/         # HTTP、WebSocket、认证和上传
├── utils/            # 文章、录音和状态等共享逻辑
├── tests/            # Node 单元与契约测试
└── scripts/          # 小程序结构校验
```

## 本地开发

要求：当前 Node.js LTS、npm，以及微信开发者工具。

```bash
npm ci
npm test
npm run validate:miniapp
```

然后在微信开发者工具中导入仓库根目录。请在开发者工具或本机的 `project.private.config.json` 中设置自己的小程序 AppID；微信登录会通过 `wx.getAccountInfoSync()` 读取当前运行环境的 AppID，不应在源码中硬编码。

后端默认使用 `https://jianshuo.dev`。真机调试和发布前，请在微信公众平台配置所需的 request、uploadFile、downloadFile 与 WebSocket 合法域名（WebSocket 使用 `wss://jianshuo.dev`）。

## 敏感配置

请勿提交以下内容：

- AppSecret、访问 Token、用户 Session 或真实登录凭据
- `project.private.config.json` 和 `.env*`
- 私钥、证书、签名文件或本机绝对路径

公开仓库中的 `project.config.json` 应使用测试占位 AppID；正式 AppID 由开发者工具的本地私有配置提供。

## 验证说明

自动化测试覆盖 API 路径、录音命名、文章解析、认证、社区发布及跨端共享契约。以下能力仍应使用微信开发者工具和真机验证：录音权限、微信登录与账号切换、图片选择、合法域名、WebSocket 重连以及分享链路。

## License

本仓库暂未声明开源许可证。未经许可，请勿将代码用于再发布或商业分发。
