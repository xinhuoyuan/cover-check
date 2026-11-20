# Cover Check — Hybrid AI Cover Image Analyzer

[中文说明](README.zh-CN.md)

Upload a video or social-media cover image and get an instant, explainable health check — plus an optional AI layer that runs **on-device first** and only goes to the cloud when you ask it to.

Built for **#BuildHybridAI 2026**.

## What it does

**Pixel engine (always local, no AI, no upload)**
Six measurable metrics computed in the browser with Canvas: text contrast (WCAG relative luminance), estimated minimum font size, text-area ratio, brightness, color saturation, and whitespace/clutter (edge density). You get a score, per-metric advice, and a diagnostic image with problem regions circled. The image never leaves the device.

**Hybrid AI layer (Firebase AI Logic)**
- **L1 on-device quick check** — runs automatically after upload using hybrid inference (`PREFER_ON_DEVICE`, Gemini Nano in Chrome). The UI badges every result with its `inferenceSource`, so you can see whether inference happened on-device or in the cloud.
- **L2 cloud deep report** — a fuller critique, only when you click for it.
- **Local-only mode** — a hard switch that disables all cloud calls.
- **EN / 中文** UI toggle.

If no Firebase project is configured, the AI panel honestly shows "not configured" — the pixel check keeps working and nothing pretends to call a model.

## Quick start

```bash
python3 -m http.server -d . 8080
# open http://localhost:8080
```

(Don't use `file://` — browsers block pixel reads.)

To enable the AI layer, create a Firebase project and fill in `firebase-config.js` — full step-by-step in [README-HYBRID.md](README-HYBRID.md). On-device inference needs desktop Chrome 139+ with the Gemini Nano multimodal Prompt API flag enabled (details in the same doc).

## Tests

```bash
python3 test/gen_tests.py   # regenerate the .rgba fixtures (not committed)
node test/run-tests.mjs     # 14 assertions against the analysis core
node test/page-smoke.mjs    # page smoke test
```

## Files

| File | Role |
|---|---|
| `index.html` / `style.css` | Page, responsive for phone / tablet / desktop |
| `core.js` | Pixel analysis core (pure functions, shared by page and Node tests) |
| `app.js` | Image loading, report + diagnostic rendering |
| `hybrid-ai.js` | Hybrid inference layer: L1 quick check, L2 deep report, local-only mode |
| `i18n.js` | English / Chinese strings |
| `firebase-config.js` | Firebase config (**placeholder** — put your own project's values here) |
| `vendor/firebase-bundle.js` | Firebase JS SDK 13.4.0 (app + ai + app-check), bundled locally — no CDN |
| `samples/` | 5 generated sample covers (a good one scores 84, a bad one 39) |

## License

Apache License 2.0 — see [LICENSE](LICENSE).

By AI落地前线 (AI Landing Frontier) · Live demo of the pixel engine: https://cover.gaoqiangq.cn
