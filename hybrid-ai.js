/* 封面体检所 · Hybrid AI 层（Firebase AI Logic 混合推理）
 *
 * 两层诊断：
 *   L1 快检 —— 混合模型 PREFER_ON_DEVICE（端侧 Nano 优先、不可用回退云端），
 *              结构化 JSON 输出；徽标以 response.inferenceSource 为准，如实显示
 *              本次实际跑在哪（端侧 / 云端），绝不谎报。
 *   L2 深度报告 —— ONLY_IN_CLOUD（gemini-2.5-flash），用户主动点击才触发，
 *              等于知情同意把图片发往云端。
 *   仅本地模式 —— ONLY_ON_DEVICE；打开后 L2 按钮置灰，端侧未就绪时 L1 明确报错，
 *              绝不静默走云端。
 *
 * 防踩坑要点（M1 验证报告 §7，逐条落地）：
 *   1. 混合模式用 HybridParams 写法：mode + inCloudParams + onDeviceParams；
 *      顶层 generationConfig / model 会被 SDK 静默忽略，本文件绝不使用。
 *   2. 云端回退模型显式写 inCloudParams.model = 'gemini-2.5-flash'；
 *      不写则默认 gemini-3.5-flash-lite（M1 实测 SDK 常量）。
 *   3. 端侧图片输入在 onDeviceParams.createOptions.expectedInputs 声明
 *      [{ type: 'image' }]，否则会话报 Image not supported。
 *   4. 端侧结构化输出走 onDeviceParams.promptOptions.responseConstraint
 *      （原生 JSON Schema 对象）；云端走 inCloudParams.generationConfig.responseSchema
 *      （Firebase Schema 助手生成）。
 *   5. initializeDeviceModel() 只在用户手势链里调用（本文件 init() 由上传点击触发）。
 *   6. SDK 的多模态输入格式是 parts 数组：[{ text }, { inlineData: { mimeType, data } }]，
 *      不要用 Chrome Prompt API 的 { role, content: [...] } 格式（那是底层 API，
 *      SDK 会自己翻译；M2 已在 Node 实测两种 SDK 格式均可发出请求）。
 *   7. inferenceSource 读 result.response.inferenceSource（EnhancedGenerateContentResponse
 *      上的字段，见 @firebase/ai@13.4.0 的 ai.d.ts）。
 *   8. SDK 锁定 firebase@13.4.0（vendor/firebase-bundle.js，esbuild 本地打包；
 *      gstatic/jsdelivr/unpkg 在本沙箱出口被拦截，CDN import map 无法验证，故改本地 vendor）。
 *   9. App Check：有 site key 时初始化 ReCaptchaV3Provider；localhost 下先置
 *      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true 走 debug token 流程；
 *      无 key 时跳过初始化并在状态里标明（云端调用可能被拦截，见 README）。
 *  10. ONLY_ON_DEVICE 的无模型行为以真机实测为准，本文件不做假设：
 *      端侧未就绪时 L1 返回明确错误，不回退、不谎报。
 */
import {
  initializeApp,
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  Schema,
  initializeAppCheck,
  ReCaptchaV3Provider,
} from './vendor/firebase-bundle.js';
import { FIREBASE_CONFIG, FIREBASE_CONFIGURED } from './firebase-config.js';

export const CLOUD_MODEL = 'gemini-2.5-flash'; // 显式指定；默认回退是 gemini-3.5-flash-lite
const INIT_TIMEOUT_MS = 30000;
const L1_TIMEOUT_MS = 90000;
const L2_TIMEOUT_MS = 120000;

export const AIStatus = {
  IDLE: 'idle', // 尚未初始化
  NOT_CONFIGURED: 'not-configured', // 占位配置，AI 功能不可用
  INITIALIZING: 'initializing',
  READY: 'ready',
  ERROR: 'error',
};

const state = {
  status: AIStatus.IDLE,
  localOnly: false,
  deviceReady: false, // initializeDeviceModel 是否成功
  appCheckReady: false,
  lastError: null,
};

let hybridModel = null; // PREFER_ON_DEVICE（L1 默认）
let localModel = null; // ONLY_ON_DEVICE（仅本地模式）
let cloudModel = null; // ONLY_IN_CLOUD（L2）
let initPromise = null;

// ---------- Schema ----------
// L1 云端用 Firebase Schema 助手；端侧用原生 JSON Schema 对象（两者字段一致）。
const L1_CLOUD_SCHEMA = Schema.object({
  properties: {
    firstImpression: Schema.enumString({
      enum: ['clear', 'okay', 'unclear'],
      description: 'At a glance, can the title be read? clear / okay / unclear',
    }),
    mainSubject: Schema.string({ description: 'What is the main visual subject, in a few words' }),
    readability: Schema.integer({ minimum: 1, maximum: 5, description: 'Text readability 1-5' }),
    mood: Schema.string({ description: 'Style / mood in one or two words' }),
    quickFixes: Schema.array({
      items: Schema.string(),
      description: 'Up to 3 instant fixes, each short',
    }),
  },
});
const L1_DEVICE_SCHEMA = {
  type: 'object',
  properties: {
    firstImpression: { type: 'string', enum: ['clear', 'okay', 'unclear'] },
    mainSubject: { type: 'string' },
    readability: { type: 'integer', minimum: 1, maximum: 5 },
    mood: { type: 'string' },
    quickFixes: { type: 'array', items: { type: 'string' } },
  },
  required: ['firstImpression', 'mainSubject', 'readability', 'mood', 'quickFixes'],
};

const L2_CLOUD_SCHEMA = Schema.object({
  properties: {
    adjustedScore: Schema.integer({ minimum: 0, maximum: 100, description: 'Revised total score after AI review' }),
    scoreNote: Schema.string({ description: 'One or two sentences explaining the revision' }),
    improvements: Schema.array({
      items: Schema.object({
        properties: {
          metric: Schema.string({ description: 'Which of the six metrics this is about' }),
          advice: Schema.string({ description: 'Concrete fix, one or two sentences' }),
        },
      }),
      description: 'One item per metric that needs work (skip metrics already fine)',
    }),
    rewrittenTitles: Schema.array({
      items: Schema.string(),
      description: 'Exactly 3 rewritten cover titles',
    }),
    platformTips: Schema.object({
      properties: {
        xiaohongshu: Schema.string({ description: 'One Xiaohongshu cover tip' }),
        bilibili: Schema.string({ description: 'One Bilibili cover tip' }),
      },
    }),
  },
});

// ---------- 工具 ----------
function withTimeout(promise, ms, code) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('timed out');
      err.code = code;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      resolve(url.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('read image failed'));
    reader.readAsDataURL(blob);
  });
}

function stripFences(text) {
  const t = String(text || '').trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : t;
}

function parseJson(text, required) {
  let data;
  try {
    data = JSON.parse(stripFences(text));
  } catch (e) {
    const err = new Error('AI returned non-JSON output');
    err.code = 'bad-json';
    err.raw = String(text || '').slice(0, 500);
    throw err;
  }
  for (const key of required) {
    if (data[key] === undefined || data[key] === null) {
      const err = new Error(`AI JSON missing field: ${key}`);
      err.code = 'bad-json';
      err.raw = JSON.stringify(data).slice(0, 500);
      throw err;
    }
  }
  return data;
}

function validateL1(d) {
  if (!['clear', 'okay', 'unclear'].includes(d.firstImpression)) throw badJson('firstImpression');
  if (typeof d.mainSubject !== 'string' || !d.mainSubject.trim()) throw badJson('mainSubject');
  if (!Number.isInteger(d.readability) || d.readability < 1 || d.readability > 5) throw badJson('readability');
  if (typeof d.mood !== 'string' || !d.mood.trim()) throw badJson('mood');
  if (!Array.isArray(d.quickFixes)) throw badJson('quickFixes');
  d.quickFixes = d.quickFixes.filter((s) => typeof s === 'string' && s.trim()).slice(0, 3);
  return d;
}
function validateL2(d) {
  if (!Number.isInteger(d.adjustedScore) || d.adjustedScore < 0 || d.adjustedScore > 100) throw badJson('adjustedScore');
  if (typeof d.scoreNote !== 'string' || !d.scoreNote.trim()) throw badJson('scoreNote');
  if (!Array.isArray(d.improvements)) throw badJson('improvements');
  if (!Array.isArray(d.rewrittenTitles)) throw badJson('rewrittenTitles');
  d.rewrittenTitles = d.rewrittenTitles.filter((s) => typeof s === 'string' && s.trim()).slice(0, 3);
  if (!d.platformTips || typeof d.platformTips !== 'object') throw badJson('platformTips');
  return d;
}
function badJson(field) {
  const err = new Error(`AI JSON invalid field: ${field}`);
  err.code = 'bad-json';
  return err;
}

// ---------- Prompt ----------
function pixelContext(pixel) {
  // pixel: CoverCore.analyze 的返回（含 total / grade / metrics[].label+score+value）
  const lines = (pixel.metrics || []).map((m) => `- ${m.label}: ${m.score}分（${m.value}）`);
  return `Pixel-engine report (deterministic, measured locally): total ${pixel.total}/100, grade ${pixel.grade}.\n${lines.join('\n')}`;
}

function l1Prompt(pixel, lang) {
  const ctx = pixelContext(pixel);
  if (lang === 'en') {
    return `You are judging a video/article cover image. ${ctx}\nLook at the image and answer in JSON only: firstImpression (clear/okay/unclear: can the title be read at a glance in a feed?), mainSubject (main visual subject, a few words), readability (text readability 1-5), mood (style/mood in one or two words), quickFixes (up to 3 instant fixes, each under 20 words). Keep every string short. Output JSON only, no other text.`;
  }
  return `你正在评审一张视频/图文封面。${ctx}\n请看图，只输出 JSON：firstImpression（clear/okay/unclear：信息流里一眼能不能读懂标题）、mainSubject（主视觉是什么，几个词）、readability（文字可读性 1–5 分）、mood（风格情绪，一两个词）、quickFixes（最多 3 条即时建议，每条 20 字以内）。所有字符串保持简短。只输出 JSON，不要其他文字。`;
}

function l2Prompt(pixel, l1, lang) {
  const ctx = pixelContext(pixel);
  const l1s = l1 ? `\nOn-device fast read: ${JSON.stringify(l1)}` : '';
  if (lang === 'en') {
    return `You are writing a deep cover-image report. ${ctx}${l1s}\nGive JSON only: adjustedScore (revised 0-100 total, considering both pixel scores and the fast read), scoreNote (1-2 sentences explaining the revision), improvements (one item per metric that needs work: metric name + concrete fix; skip metrics already fine), rewrittenTitles (exactly 3 rewritten cover titles, punchy), platformTips { xiaohongshu: one tip, bilibili: one tip } (how cover norms differ between the two platforms, one sentence each). Output JSON only.`;
  }
  return `你要写一份封面深度报告。${ctx}${l1s}\n只输出 JSON：adjustedScore（综合像素分与快检判断后修正的总分 0–100）、scoreNote（用一两句说明为什么这样修正）、improvements（每项需要改进的指标一条：metric 指标名 + advice 具体改法；已达标的指标跳过）、rewrittenTitles（恰好 3 条改写后的封面标题，要抓人）、platformTips { xiaohongshu: 一条小红书封面建议，bilibili: 一条 B站封面建议 }（两个平台封面规范的差异，各一句话）。只输出 JSON。`;
}

// ---------- 初始化（必须在用户手势链里调用） ----------
export function getState() {
  return { ...state };
}

export function setLocalOnly(on) {
  state.localOnly = !!on;
  return state.localOnly;
}

export async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!FIREBASE_CONFIGURED) {
      state.status = AIStatus.NOT_CONFIGURED;
      return { ok: false, reason: 'not-configured' };
    }
    state.status = AIStatus.INITIALIZING;
    try {
      const app = initializeApp(FIREBASE_CONFIG);
      // App Check：有 site key 才初始化；localhost 下走 debug token 流程。
      const siteKey = (FIREBASE_CONFIG.appCheckSiteKey || '').trim();
      if (siteKey && !siteKey.startsWith('YOUR_')) {
        const host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') {
          window.self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        }
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(siteKey),
          isTokenAutoRefreshEnabled: true,
        });
        state.appCheckReady = true;
      }
      const ai = getAI(app, { backend: new GoogleAIBackend() });
      // L1 混合模型：HybridParams 写法（M1 §3.1 纠正版）
      hybridModel = getGenerativeModel(ai, {
        mode: InferenceMode.PREFER_ON_DEVICE,
        inCloudParams: {
          model: CLOUD_MODEL,
          generationConfig: { responseMimeType: 'application/json', responseSchema: L1_CLOUD_SCHEMA },
        },
        onDeviceParams: {
          createOptions: { expectedInputs: [{ type: 'image' }] },
          promptOptions: { responseConstraint: L1_DEVICE_SCHEMA },
        },
      });
      // 仅本地模式模型
      localModel = getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_ON_DEVICE,
        onDeviceParams: {
          createOptions: { expectedInputs: [{ type: 'image' }] },
          promptOptions: { responseConstraint: L1_DEVICE_SCHEMA },
        },
      });
      // L2 云端模型
      cloudModel = getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: {
          model: CLOUD_MODEL,
          generationConfig: { responseMimeType: 'application/json', responseSchema: L2_CLOUD_SCHEMA },
        },
      });
      // 端侧模型预热：必须在手势里；失败不阻塞（混合模式会回退云端）。
      try {
        await withTimeout(hybridModel.initializeDeviceModel(), INIT_TIMEOUT_MS, 'init-timeout');
        state.deviceReady = true;
      } catch (e) {
        state.deviceReady = false;
        state.lastError = e;
      }
      state.status = AIStatus.READY;
      return { ok: true, deviceReady: state.deviceReady, appCheckReady: state.appCheckReady };
    } catch (e) {
      state.status = AIStatus.ERROR;
      state.lastError = e;
      return { ok: false, reason: 'init-failed', error: e };
    }
  })();
  return initPromise;
}

// ---------- L1 端侧快检 ----------
export async function fastRead({ blob, pixel, lang = 'zh' }) {
  const ready = await init();
  if (!ready.ok) {
    const err = new Error(ready.reason === 'not-configured' ? 'Firebase not configured' : 'AI init failed');
    err.code = ready.reason || 'init-failed';
    throw err;
  }
  if (state.localOnly && !state.deviceReady) {
    // 仅本地模式：端侧未就绪时明确报错，绝不静默回退云端（M1 §7 第 10 条）。
    const err = new Error('On-device model not ready in local-only mode');
    err.code = 'device-not-ready';
    throw err;
  }
  const model = state.localOnly ? localModel : hybridModel;
  const b64 = await blobToBase64(blob);
  const mimeType = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png';
  const parts = [{ text: l1Prompt(pixel, lang) }, { inlineData: { mimeType, data: b64 } }];
  const result = await withTimeout(model.generateContent(parts), L1_TIMEOUT_MS, 'l1-timeout');
  const res = result.response;
  const source = res.inferenceSource || InferenceSource.IN_CLOUD; // 读不到时按云端计，不谎报端侧
  const data = validateL1(parseJson(res.text(), ['firstImpression', 'mainSubject', 'readability', 'mood', 'quickFixes']));
  return { data, source };
}

// ---------- L2 云端深度报告 ----------
export async function deepReport({ blob, pixel, l1, lang = 'zh' }) {
  if (state.localOnly) {
    const err = new Error('Deep report disabled in local-only mode');
    err.code = 'local-only';
    throw err;
  }
  const ready = await init();
  if (!ready.ok) {
    const err = new Error(ready.reason === 'not-configured' ? 'Firebase not configured' : 'AI init failed');
    err.code = ready.reason || 'init-failed';
    throw err;
  }
  const b64 = await blobToBase64(blob);
  const mimeType = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png';
  const parts = [{ text: l2Prompt(pixel, l1, lang) }, { inlineData: { mimeType, data: b64 } }];
  const result = await withTimeout(cloudModel.generateContent(parts), L2_TIMEOUT_MS, 'l2-timeout');
  const res = result.response;
  const source = res.inferenceSource || InferenceSource.IN_CLOUD;
  const data = validateL2(parseJson(res.text(), ['adjustedScore', 'scoreNote', 'improvements', 'rewrittenTitles', 'platformTips']));
  return { data, source };
}
