# Mini Program photo CDN fallback debug report

- Date: 2026-07-21
- Symptom: Photos in My Recordings, including row covers, stopped loading after original-photo URLs moved to `voicedrop.cn`.
- Root cause: The mini program has URL checking enabled. A newly introduced `downloadFile` host can be rejected before the request when it is not yet available in the WeChat legal-domain configuration. Both article images and recording covers use `downloadPhotoTemp`, so the domain-level failure removed both at once. Direct HTTP checks showed both photo routes reachable, ruling out the key format and backend route.
- Fix: `downloadPhotoTemp` now tries the EdgeOne URL first and automatically retries the existing `jianshuo.dev` photo route. Direct `<image>` URLs remain on `jianshuo.dev` because that path has no controlled retry callback. Public photo reads do not send a user bearer token.
- Evidence: A regression test reproducing `downloadFile:fail url not in domain list` failed before the fix and passes after it, proving the second request uses `jianshuo.dev` and returns the fallback temp file.
- Regression test: `tests/library-list.test.js` — `library falls back to the API host when the photo CDN domain is unavailable`.
- Verification: 448 tests passed; `npm run validate:miniapp` passed; `git diff --check` passed.
- Related: Add `https://voicedrop.cn` to the WeChat `downloadFile` legal-domain list to receive the CDN speedup. The fallback keeps photos functional until then.
- Status: DONE_WITH_CONCERNS — automated reproduction is fixed; WeChat Developer Tools and real-device verification remain required for platform domain configuration.
