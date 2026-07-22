# Prompt Settings — Design QA

## Evidence

- Source visual truth:
  - `/var/folders/h2/_6smmfkj2z1f7pbmqc0f36gm0000gn/T/codex-clipboard-2OMfyA.png`
  - `/var/folders/h2/_6smmfkj2z1f7pbmqc0f36gm0000gn/T/codex-clipboard-DCZ2sW.png`
  - `/var/folders/h2/_6smmfkj2z1f7pbmqc0f36gm0000gn/T/codex-clipboard-JFX2w8.png`
  - `/var/folders/h2/_6smmfkj2z1f7pbmqc0f36gm0000gn/T/codex-clipboard-P0sNZV.png` (pre-fix prompt row evidence)
  - `/var/folders/h2/_6smmfkj2z1f7pbmqc0f36gm0000gn/T/codex-clipboard-HHoiyD.png` (pre-fix simulator tab evidence)
  - `/var/folders/h2/_6smmfkj2z1f7pbmqc0f36gm0000gn/T/codex-clipboard-1rqli8.png` (pre-fix detail CTA alignment evidence)
  - `/var/folders/h2/_6smmfkj2z1f7pbmqc0f36gm0000gn/T/codex-clipboard-c4Pqhw.png` (pre-fix tab optical-alignment evidence)
- Source dimensions: 945 × 2048 px, Android reference capture.
- Implementation: native WeChat Mini Program prompt settings page.
- Target state: prompt lists, community loading state, community prompt detail bottom sheet, second-level long-press menu, and VD community sort tabs.
- Implementation screenshot: not captured, following the user's stated preference to perform visual confirmation directly.
- Viewport and density normalization: unavailable without a rendered implementation capture.

## Source-level comparison

- Fonts and typography: the existing project font stack is retained; title, metadata, badge, body, and CTA hierarchy now follows the Android reference.
- Spacing and layout: both list dividers begin at their text columns; the detail sheet has a scrollable content region and fixed footer action.
- Colors and tokens: the existing VoiceDrop background, ink, accent, green, border, and disabled tokens are reused.
- Image and icon fidelity: text prompts now use the folded-corner `ri-file-text-line` document icon that matches Android's `ic_doc`, while image prompts retain `ri-image-line`. The second-level menu return affordance uses the same stable chevron treatment as its right-facing entry affordance.
- Copy: “社区热门” is replaced by “社区提示词”; loading, detail labels, and import states match the reference semantics.

## Findings

- No source-level P0/P1 issue remains.
- Rendered spacing, device-specific safe-area behavior, animation timing, and final visual fidelity still require the user's WeChat Developer Tools or device confirmation.

## Comparison history

1. Initial implementation used full-width dividers, a text-only loading state, the “社区热门” heading, and an undifferentiated detail sheet.
2. The implementation now uses text-column dividers, spinner-above-label loading states, the “社区提示词” heading, a closeable animated bottom sheet, scrolling content, and a fixed import action.
3. No post-change implementation screenshot was produced at the user's request, so a same-viewport visual comparison could not be completed.
4. Prompt detail CTA text now uses two-axis Flex centering; the `自建` badge is non-shrinking and single-line; text-prompt quote icons are replaced by document icons.
5. Community sort tabs use explicit `88rpx` heights for both item and label. A `10rpx` label-only optical correction accounts for the visible Chinese glyph box sitting above the font line box without changing the tab hit area.
6. The detail footer now owns horizontal centering and the CTA expands with `flex: 1`; community text-prompt icons use Android's green semantic treatment while image prompts retain the red accent.
7. User-created prompt badges use Android's `GREEN` / `GREEN_BG` values (`#5e8a6a` / `#e7f1e8`); modified system prompts retain the separate amber treatment.
8. VD community feed filters use a native `text` with a fixed `30rpx` line box inside an `88rpx` Flex hit target. Because WeChat Developer Tools and device fonts expose different glyph baselines, a runtime-gated `10rpx` correction applies only when either system or device metadata identifies the developer tools; iOS and Android devices retain unshifted geometric centering.
9. The community prompt list keeps its original compact `112rpx` row, `14rpx 20rpx` padding, `18rpx` icon gap, `72rpx` icon tile, and `110rpx` divider inset. Personal prompt rows now use those same metrics, including a synchronized `112rpx` drag step. Text prompts share Android's green semantic icon treatment; image prompts remain red and group folders remain neutral.
10. Personal prompt movable rows use a white underlay so fractional row positioning cannot expose a red hairline. The swipe-delete action itself remains red, while the visible divider remains the same inset neutral line as the community list.

## Final result

final result: blocked

Blocked only on the intentionally user-owned rendered visual comparison.
