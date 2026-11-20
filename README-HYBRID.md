# 封面体检所 · Hybrid AI 版（M2 构建）

> 本目录是 #BuildHybridAI 2026 参赛作品的 M2 构建产物：封面体检所源码的完整副本 +
> 新增的混合推理层。**不要直接把它当线上版部署**——部署、公开仓库、Devpost 提交
> 按《方案筹备.md》M3/M4 走，须用户先批开源与 Firebase 配置。

## 目录结构（相对本目录）

| 文件 | 说明 |
|---|---|
| `index.html` / `app.js` / `core.js` / `style.css` | 原站文件；`core.js` **未动**（像素引擎原样保留） |
| `firebase-config.js` | Firebase 配置（**占位**，见 §1） |
| `hybrid-ai.js` | 混合推理层：L1 快检 + L2 深度报告 + 仅本地模式 |
| `i18n.js` | 中文 / English 字符串与像素报告静态文案映射 |
| `vendor/firebase-bundle.js` | Firebase JS SDK 13.4.0 本地打包（app + ai + app-check，esbuild） |
| `test/` | 回归测试（14 断言）+ 页面冒烟（原样保留） |
| `samples/` | 5 张示例封面（原样保留） |
| `README.md` / `部署说明.md` / `自测记录.md` | 原站文档（部署说明仍针对旧版，见 §5） |

## 1. 启用 AI 之前：用户要做的事（约 10 分钟）

1. Firebase 控制台新建项目 → 左侧 **AI Services > AI Logic** 走引导流程 →
   选 **Gemini Developer API** → 取 Web 端 `firebaseConfig`。
2. 把 `firebase-config.js` 里的 6 项换成真实值，`FIREBASE_CONFIGURED` 改为 `true`。
   `appCheckSiteKey`：控制台 **App Check** 页开 reCAPTCHA v3 后填入；留空则跳过
   App Check 初始化（云端调用可能被 AI Logic 的 App Check 强制拦截，见 §3）。
3. 本地调试（localhost）时，`hybrid-ai.js` 会自动置
   `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`；浏览器控制台会打印 debug token，
   去控制台 **App Check > 管理调试令牌** 注册一次即可。
4. 真机要求（端侧）：桌面 Chrome 139+，开 flag
   `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`，确认
   `await LanguageModel.availability()` 为 `available`（未下载时等模型下完；
   机器需 22GB 空闲 + 显存 >4GB 或 16GB 内存 + 4 核 CPU）。

在完成第 2 步之前，页面是**占位状态**：像素体检全部正常，AI 面板显示「未配置」，
深度报告按钮可用但点击后同样提示未配置——不会假装调用成功。

## 2. 功能说明

- **L1 端侧快检**：上传封面后自动跑。混合模型 `PREFER_ON_DEVICE`，
  结构化 JSON（`firstImpression` / `mainSubject` / `readability` / `mood` /
  `quickFixes`）。徽标读 `response.inferenceSource`：端侧显示「端侧 · 本地完成」，
  云端回退显示「云端回退」，绝不谎报。
- **L2 云端深度报告**：点「生成深度报告」才触发（知情同意发图上云）。
  `ONLY_IN_CLOUD` + `gemini-2.5-flash`，输出总分修正、逐项改法、3 条改写标题、
  小红书/B站平台建议。
- **仅本地模式**：开关切到 `ONLY_ON_DEVICE`；打开后深度报告按钮置灰，
  端侧未就绪时 L1 明确报错，不静默走云端。
- **EN / 中文切换**：页面 chrome + AI 提示词语言联动；像素报告的逐项 advice
  是规则引擎中文原文，英文模式下保留中文并加注（不做机器翻译）。
- **不动的部分**：`core.js` 像素引擎、六项指标、诊断图、5 张样张、14 项回归测试。

## 3. 已知限制与待验证（M2 如实记录）

- **云端真实生成未验证**：无真实 Firebase 项目，沙箱只验到认证边界（dummy 配置
  返回 403，见《构建报告-M2.md》）。换真实配置后按验证报告 §5 清单第 3 条冒烟。
- **端侧真实推理未验证**：沙箱 headless Chromium 的 `LanguageModel` 是回显桩，
  真实 Nano 质量、延迟、`responseConstraint` 合规率须真机验证（验证报告 §5 清单第 4、5 条）。
- **App Check 全流程未验证**：无真实项目，debug token 注册流程须真机走一遍。
- **CDN import map 未采用**：gstatic / jsdelivr / unpkg 在本沙箱出口被拦截
  （403 / policy_denied），M2 改用 esbuild 本地打包 `vendor/firebase-bundle.js`
  （firebase@13.4.0，111KB minified）。部署时无需外网拉 SDK。
- **SDK 多模态输入格式**：M2 在 Node 实测确认 Firebase SDK 接受
  `[{ text }, { inlineData: { mimeType, data } }]` 的 parts 格式并发出请求；
  注意这与 Chrome Prompt API 原生的 `{ role, content: [...] }` 格式不同，
  不要混用（M1 报告 §7 第 6 条的写法按此理解）。

## 4. 本地运行与测试

```bash
cd m2-build
python3 -m http.server 8000   # 不要用 file:// 打开（ES module 需要 http）
# 打开 http://localhost:8000/ ，点一张示例封面
node test/run-tests.mjs       # 回归 14/14
node test/page-smoke.mjs      # 页面冒烟
```

## 5. 与原站文档的关系

- 原 `部署说明.md` 仍针对旧版静态站；M2 部署时除原文件外还须同步
  `firebase-config.js`、`hybrid-ai.js`、`i18n.js`、`vendor/` 四项新增内容，
  回滚时用原站备份覆盖即可（新增文件不影响旧版运行，删掉即回退）。
- `README.md`（原站）未改；本文件是 M2 的补充说明，M3 合并回源码仓时
  再决定是否合入主 README。

## 6. 许可证

本站代码（不含 Firebase SDK 打包产物）沿用原站口径；`vendor/firebase-bundle.js`
是 Firebase JS SDK（Apache License 2.0）的打包产物。参赛提交用的公开仓库
须用 Apache-2.0 LICENSE——**建公开仓前须用户先批准**（方案筹备 §8 第 1 条）。
