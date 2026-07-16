# 小程序 WebSocket 与库级语音指令 iOS 对齐设计

## 目标

取消尚未被服务端支持的 `ws-ticket` 方案，将小程序的 ASR、库级语音指令和状态 WebSocket 恢复为与 iOS 一致的 Bearer 直连认证；同时按 iOS 的服务端权威队列模型重新整理库级指令的发送、回包和断线恢复逻辑。

## 范围

- `services/asr-dictation.js`：恢复 `/agent/asr` Bearer WebSocket 直连，保留现有火山 ASR 二进制协议、音频缓冲和最终帧语义。
- `services/status-session.js`：恢复 `/agent/status` Bearer WebSocket 直连，保留状态消息和自动重连。
- `services/library-command.js`：重新组织 `/agent/command` 的本地队列、发送、快照协调、确认和回包处理。
- `pages/recordings/index.js`：仅在会话接口变化需要时调整调用，不改变长按、听写、上滑取消和确认弹窗交互。
- 删除 `services/ws-ticket.js` 及只验证 ticket URL 的测试。
- 不修改 iOS、Android 或后端仓库。

## 认证与连接

三个 WebSocket 都直接连接 `wss://jianshuo.dev/agent/<audience>`，请求头为：

```text
Authorization: Bearer <auth.bearer()>
X-VD-Platform: miniapp
```

客户端不得把 Bearer token 放进 URL。所有通道忽略旧连接的迟到回调；主动关闭后不再重连。ASR 不自动重连，因为一段听写不能跨连接继续；状态通道断线 3 秒重连；指令通道断线 1.5 秒重连。

## 指令队列模型

每条本地未完成指令保存：

```json
{
  "id": "stable-id",
  "text": "删除第二篇",
  "refs": [{ "n": 2, "stem": "VoiceDrop-...", "title": "标题" }]
}
```

`refs` 必须是用户说出指令当时的编号快照，不能在重连时替换成当前页面的新编号。读取旧版仅含 `id/text` 的缓存时，以空 `refs` 兼容，不丢弃旧指令。

新指令先写入本地存储，再尝试发送。Socket 尚未打开时只保留在队列；`onOpen` 后等待服务端 `snapshot` 协调。若服务端不发送快照，则通过短时兜底刷新发送本地队列，避免兼容性死锁。

## 服务端消息处理

- `snapshot`：服务端队列是权威状态。`done/error` 从本地删除；`pending/running` 保留但不重复提交；服务端未知的本地 ID 使用原始 `refs` 重发。
- `status`：`working` 映射为正在执行，不结束本地队列项。
- `updated`：触发列表静默刷新，并按 `id` 结束本地指令；没有 ID 时兼容旧服务端，结束队首。
- `reply`：展示服务端回复。带 ID 的终结回复结束对应指令；这是对 iOS 当前实现的契约修正，因为删除取消只返回 `reply`，否则队列会残留到下次重连。
- `error`：展示业务错误并结束对应指令；没有 ID 时兼容结束队首。
- `confirm`：把 `summary/text/message` 归一化后交给页面弹窗。用户选择后发送 `{type:"confirm",id}` 或 `{type:"cancel",id}`。
- 非法 JSON、未知消息类型和旧连接消息静默忽略，不能把传输噪声显示成业务错误。

## 确认与恢复

未回答的确认文案以及已经选择但尚未得到服务端终结回包的 `confirm/cancel` 控制消息继续本地持久化。连接恢复后先依据快照处理指令，再补发仍待处理的控制消息。收到对应 `reply/updated/error` 后清除确认和控制状态。

## 页面反馈

- 听写中显示黑色 transcript 气泡。
- 松手并入队后显示队列气泡。
- 服务端 `reply` 显示结果气泡；`error` 显示错误气泡。
- 连接状态本身不冒充业务回复。
- 指令完成后列表通过 `onUpdate` 静默刷新。

## 测试

自动化测试必须覆盖：

1. 三个通道均使用 Bearer 请求头直连正确 URL，且 URL 不含 token/ticket。
2. Socket 打开前不发送指令，打开/快照后发送。
3. 每条指令持久化并恢复自己的 `refs`。
4. `snapshot` 对 done、error、pending、running 和未知 ID 的协调。
5. `updated`、`reply`、`error` 的队列终结语义。
6. `confirm/cancel` 断线恢复和去重。
7. 旧连接消息被忽略，主动关闭取消重连。
8. 现有 ASR 最终文本、录音停止等待和页面交互测试继续通过。

交付前运行：

```bash
npm test
npm run validate:miniapp
```

真机验证需要在微信后台确认 `https://jianshuo.dev` 的 request 合法域名和 `wss://jianshuo.dev` 的 socket 合法域名，然后测试普通指令、删除确认、取消删除、断网恢复和切换标签后的编号指令。

## 非目标

- 不引入新的认证端点。
- 不修改后端消息协议。
- 不重构普通录音、文章内语音编辑或 Realtime 采访链路。
- 不处理与本次故障无关的页面样式和其他未提交改动。
