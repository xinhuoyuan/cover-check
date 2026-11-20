# 封面体检所 — 混合 AI 封面体检

[English](README.md)

上传一张视频/图文封面，立刻得到一份可解释的体检报告；AI 层**优先在端侧推理**，只有你主动点，才上云端。

#BuildHybridAI 2026 参赛作品。

## 使用说明

**像素体检（全程本地，不用 AI、不上传）**
浏览器内用 Canvas 算六项可量化指标：文字对比度（WCAG 相对亮度比）、最小字号估计、文字占比、画面明暗、色彩饱和、留白与杂乱（边缘密度）。输出体检分、逐项建议和一张把问题区域圈出来的诊断图。图片不离开设备。

**混合 AI 层（Firebase AI Logic）**
- **L1 端侧快检**：上传后自动跑，混合推理 `PREFER_ON_DEVICE`（Chrome 内置 Gemini Nano）。界面给每条结果亮 `inferenceSource` 徽标，端侧还是云端一目了然。
- **L2 云端深度报告**：更完整的点评，点了才调用。
- **仅本地模式**：硬开关，关掉一切云端调用。
- **中 / EN 界面切换**。

未配置 Firebase 项目时，AI 面板如实显示「未配置」，像素体检照常工作，不假装调用成功。

## 本地运行

```bash
python3 -m http.server -d . 8080
# 打开 http://localhost:8080
```

（不要用 `file://`，浏览器会拦像素读取。）

启用 AI 层需要建一个 Firebase 项目并填 `firebase-config.js`，完整步骤见 [README-HYBRID.md](README-HYBRID.md)。端侧推理需要桌面 Chrome 139+ 并开启 Gemini Nano 多模态 Prompt API flag（同文档内）。

## 测试

```bash
python3 test/gen_tests.py   # 重新生成 .rgba 测试图（不入仓）
node test/run-tests.mjs     # 14 条断言，针对分析核心
node test/page-smoke.mjs    # 页面冒烟
```

## 许可证

Apache License 2.0 — 见 [LICENSE](LICENSE)。

出品：AI落地前线 · 像素引擎线上版：https://cover.gaoqiangq.cn
