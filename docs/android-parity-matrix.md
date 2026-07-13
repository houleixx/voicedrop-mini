# VoiceDrop Android -> WeChat Mini Program Parity Matrix

Source: the VoiceDrop Android client implementation.

## User-Facing Features

| Android feature | Mini Program status | Evidence |
|---|---|---|
| Networking platform header | Implemented with `X-VD-Platform: miniapp` across request, upload, download, and WebSocket entry points | `services/request`, `services/audio`, `services/library`, `services/share-collect`, `services/article-edit`, `services/library-command`, `services/status-session` |
| Record audio as `VoiceDrop-*.m4a` | Implemented with `wx.getRecorderManager()` and Android-compatible duration, weekday, and time-period naming boundaries | `pages/recordings`, `services/audio`, `utils/recording` |
| Realtime AI interviewer during recording | Implemented with 16 kHz framed PCM capture, Android-compatible PCMU uplink, `/realtime/relay?fmt=pcmu`, ordered 24 kHz WebAudio playback, half-duplex mute, and six-step exponential reconnect; relay failure never stops the primary recording | `pages/record`, `services/realtime-session`, `services/realtime-interviewer`, `services/realtime-audio-player`, `utils/mu-law`, `utils/wav` |
| Recording quality silent detection | Implemented with Android-compatible peak/duration rule when Mini Program recorder metadata exposes a peak; otherwise upload continues because WeChat does not expose Android `MediaRecorder.getMaxAmplitude()` | `utils/recording-quality`, `pages/recordings` |
| Generate article from audio file | Implemented as an in-app Mini Program substitute for Android audio share receive: choose an audio file, upload it with a VoiceDrop-compatible name, and trigger mining | `pages/share-collect`, `services/share-collect.audioArticlePlan`, `services/share-collect.generateFromAudio` |
| Record deep link with tag | Implemented via Mini Program query/deeplink route and Android-compatible tags sidecar upload to `articles/<stem>.tags` | `utils/app-router`, `app.js`, `services/audio.tagsSidecarUpload`, `services/audio.uploadTags` |
| Auto upload and trigger mining | Implemented with `PUT /files/api/upload/<name>` and `POST /files/api/mine` | `services/audio` |
| Recording list states | Implemented: uploading, pending, ASR, mining, ready, empty, blocked | `utils/recording`, `services/status-session` |
| Resume refresh policy | Implemented: top-level pages avoid redraw once rendered and refresh silently on resume | `utils/resume-refresh`, `pages/recordings` |
| Dynamic home tag tabs | Implemented with Mini Program scroll tabs; selected tag filters recordings and library command targets | `pages/recordings`, `utils/recording.tagsFromRecords`, `utils/recording.filterByTag` |
| Real-time status sync | Implemented with `/agent/status` WebSocket | `services/status-session`, `pages/recordings` |
| Article detail | Implemented with article JSON parsing, body rendering, transcript, tags | `pages/detail`, `utils/article` |
| Play original audio | Implemented with authorized download, `InnerAudioContext`, loading guard, stop behavior, and playback progress | `services/library.downloadTempFile`, `utils/audio-playback-state`, `pages/detail` |
| Delete recording/article | Implemented with Files API deletes; recording deletion success matches Android/iOS by requiring audio deletion only | `services/library`, `pages/detail` |
| Public share link | Implemented by copying share URL or Android-compatible article text plus public link | `services/library.shareUrl`, `utils/article.shareTextWithLink`, `pages/detail` |
| Platform share sheet | Implemented with Mini Program friend and timeline sharing on key pages plus global share menu | `app.js`, `pages/recordings`, `pages/detail`, `pages/community`, `pages/community-detail` |
| Copy article text | Implemented using Android-compatible marker stripping, with optional public link payload | `utils/article.shareText`, `utils/article.shareTextWithLink`, `pages/detail` |
| Voice article edit | Partially substituted: text commands and full edit WebSocket are implemented; Android raw PCM ASR is platform-limited | `services/article-edit`, `pages/detail` |
| Hold-to-talk edit gesture/transcript | Platform-independent gesture cancellation and transcript aggregation are implemented; raw live dictation transport remains Mini Program-limited | `utils/hold-to-talk` |
| Long-press edit menus | Implemented with built-in and remote `/agent/ui-config` menus | `utils/ui-config`, `services/ui-config`, `pages/detail` |
| Popup menu positioning helpers | Implemented with Android-compatible right-aligned and upward offset math for reusable Mini Program popovers | `utils/popup-menu-position` |
| Insert photos | Implemented inside the detail page with a full-screen picker overlay, `wx.chooseMedia`, photo upload, Android-compatible timestamp offsets, image sample-size logic, and insert instruction | `pages/detail`, `utils/photo-insert` |
| Generate article from images | Implemented as an in-app Mini Program substitute for Android image share receive: choose images, upload photo keys under one session, upload silent task audio, and trigger mining | `pages/share-collect`, `services/share-collect.imageArticlePlan`, `services/share-collect.generateFromImages` |
| Inline article photos | Implemented with marker resolution and photo URLs | `utils/article`, `pages/detail`, `pages/community-detail` |
| Article version history/head | Implemented including previous/next navigation by version head ids | `services/library.versionHistory`, `services/library.patchHead`, `utils/version-navigation`, `pages/detail` |
| Rewrite article with selected writing style | Implemented: choose style history version, switch to already generated matching article version, or request `/agent/restyle` with explicit `styleV` | `pages/detail`, `services/settings.loadStyleHistory`, `services/library.restyle`, `utils/style-rewrite` |
| Writing style settings | Implemented with Android-compatible style text trimming on save and numeric `styles` normalization on load | `services/settings`, `pages/settings` |
| Writing style history/head | Implemented with single head switching plus multi-style selection, limited to 3 versions like Android | `services/settings`, `utils/style-selection`, `pages/settings` |
| Style dataset collection and extraction | Implemented as a Mini Program page replacing Android system share receive; request body, first-line fallback title, and extraction task names match Android contracts | `pages/share-collect`, `services/share-collect` |
| Share routing classification | Implemented as reusable classifier/title extraction for Mini Program entry flows | `utils/share-router`, `tests/router-share.test.js` |
| WeChat official account drafts | Implemented: config, validation, publish/update flow, Chinese error mapping, and config-error routing | `pages/wechat-settings`, `services/settings`, `services/library.publishWechat` |
| VD Community list/detail | Implemented, including Android-compatible post field trimming, `sharedAt` fallback, and inline article normalization for community detail posts | `pages/community`, `pages/community-detail`, `services/community` |
| Community ranking | Implemented via `/reco/rank` with Android-compatible author fallback and reply-count payload | `services/community.rank`, `services/community.rankPayload`, `pages/community` |
| Community like/view engagement | Implemented with local liked prefs and `/reco/engage` | `utils/prefs`, `services/community.engage` |
| Community report/block | Implemented | `pages/community-detail`, `utils/block-store`, `pages/about` |
| Community replies | Implemented list, continuation previews, click-through reading, parent reply chip, plus pending reply auto-publish after recording is ready | `utils/pending-replies`, `utils/community-reply`, `pages/recordings`, `pages/community-detail` |
| Community visibility and terms gate | Implemented: detects shared state, shares, hides, prompts community terms, and handles WeChat-login-required responses | `pages/detail`, `services/community`, `utils/community-terms` |
| Library natural-language command | Implemented with `/agent/command` WebSocket | `services/library-command`, `pages/recordings` |
| Account token display/import | Implemented | `services/auth`, `pages/account` |
| WeChat login session exchange | Implemented with `wx.login` and `/files/api/auth/wechat` | `services/wechat-auth`, `pages/account` |
| Device link start/verify/cancel | Implemented | `services/device-link`, `pages/account`, `services/status-session` |
| Usage balance and ledger | Implemented | `services/usage`, `pages/usage` |
| About/privacy/community terms/support | Implemented | `pages/about`, `utils/community-terms` |
| Independent audio information agreement | Implemented: versioned explicit consent before every microphone entry, standalone agreement page, and local withdrawal; copy states audio purposes and explicitly excludes voiceprint identification | `utils/audio-consent`, `components/audio-consent-dialog`, `pages/audio-consent`, `pages/about` |
| App version display/comparison | Implemented with Android-compatible numeric version comparison, GitHub release/APK asset parsing, GitHub download proxy rewriting, manual and startup update check status handling, ignored-version preference, update auto-check preference policy, and About page version display; APK update install flow remains platform-limited | `utils/app-version`, `utils/update-prefs`, `utils/prefs`, `services/update`, `app.js`, `pages/settings`, `pages/about` |
| Theme color tokens | Implemented with Android/iOS-compatible accent, red, secondary, and faint tokens applied across Mini Program styles | `utils/theme`, `app.wxss`, `pages/*/*.wxss` |
| Android deep links | Implemented as Mini Program query/deeplink router | `utils/app-router`, `app.js` |
| Data export | Platform substitute: copy cloud article/export URL with Android-compatible empty export feedback; local zip generation is not available in Mini Program | `services/export`, `pages/settings` |

## Platform-Limited Android Features

| Android feature | Mini Program limitation | Current replacement |
|---|---|---|
| Raw PCM real-time ASR over Volc binary protocol | Mini Program recorder does not expose the same low-level `AudioRecord` PCM stream and background sender loop | Text command editor and full `/agent/edit` WebSocket; ready for future Mini Program ASR upload endpoint |
| Android system share receive intents | Mini Program cannot receive arbitrary Android share intents | In-app style collection page |
| APK update manager and installer permissions | Mini Program is distributed by WeChat, no APK update flow | Not applicable |
| Local zip archive export | Mini Program sandbox does not provide equivalent desktop-style archive sharing | Cloud article/export link copied to clipboard |
| Android FileProvider / filesystem document directory | Mini Program uses temporary files and WeChat storage APIs | `wx.downloadFile`, `wx.setStorageSync`, clipboard |

## Verification

Automated local checks:

```bash
npm test
npm run validate:miniapp
node -e "JSON.parse(require('fs').readFileSync('app.json','utf8'))"
for f in $(rg --files -g '*.js'); do node --check "$f" || exit 1; done
```

`validate:miniapp` checks page file sets, tabBar registration, Mini Program route references, required friend/timeline sharing entry points, and relative `require()` targets.

Required before claiming full parity:

- Import the project in WeChat Developer Tools.
- Configure request/download/upload/socket legal domains for `https://jianshuo.dev` and `wss://jianshuo.dev`.
- Test recording upload on a real device.
- Test first-use audio agreement view/decline/agree actions and confirm that merely viewing does not grant consent.
- Test main recording, home voice commands, article voice editing, and community voice replies all remain blocked before agreement.
- Test microphone permission denial, recovery through settings, local withdrawal, and agreement re-consent on a real device.
- Test article generation status WebSocket.
- Test article edit WebSocket.
- Test image upload and inline rendering.
- Test WeChat login with the real Mini Program AppID and backend auth configuration.
- Test official account draft publish against real credentials.
