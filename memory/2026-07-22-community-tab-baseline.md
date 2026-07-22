# Community feed tab baseline investigation — 2026-07-22

## Symptom

The `推荐 / 最新 / 回应` labels appeared visually high inside the `88rpx` community filter bar on small-screen Android and HarmonyOS WeChat runtimes, despite Flex box centering.

## Root cause

Flex centers the fixed `30rpx` text line box, while each runtime's system font places the visible Chinese glyphs differently inside that box. Android was visually centered after a `9rpx` label translation. Fresh before/after HarmonyOS screenshots proved that the same translation was applied (the glyph bounding box moved down by about 13 screenshot pixels), but the visible glyph center remained about 8–9 screenshot pixels above the bar center. At the captured 1260px viewport scale, that remaining distance is about `5rpx`.

An initially resubmitted HarmonyOS screenshot was byte-identical to the earlier image, so it was rejected as stale evidence. A fresh 20:35 capture established the remaining HarmonyOS-specific offset.

## Fix

- Keep the default non-iOS optical correction at `9rpx`.
- Detect HarmonyOS from system/device metadata values containing `harmony`, `ohos`, or `openharmony`.
- Override the HarmonyOS correction to `14rpx`.
- Keep the transform on the label only, preserving the `88rpx` hit target.

Both the label font size and correction use `rpx`, so their relative geometry remains stable across viewport sizes. Physical-pixel rounding may still vary by roughly one pixel.

## Verification

- `npm test`: 463 tests passed.
- `npm run validate:miniapp`: `Miniapp static OK`.
- Regression coverage: `tests/recordings-layout.test.js` checks HarmonyOS identification and the `14rpx` override.

## Status

DONE_WITH_CONCERNS — code and automated verification are complete; the `14rpx` HarmonyOS result still requires a fresh screenshot from the physical device.
