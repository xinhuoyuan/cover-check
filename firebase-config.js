/* 封面体检所 · Firebase 配置（占位版）
 *
 * 云端调用（L2 深度报告、以及端侧不可用时的云端回退）需要一个真实的 Firebase 项目。
 * 用户在 Firebase 控制台建好项目后（见 m2-build/README-HYBRID.md），把下面四项换成
 * 控制台给出的 Web 端 firebaseConfig，并把 FIREBASE_CONFIGURED 改为 true。
 *
 * 安全口径：这里只放客户端公开标识（apiKey 等）。apiKey 不是服务端密钥，
 * 但也不要把它提交到公开仓库——正式提交前按 README-HYBRID.md 的说明处理。
 * App Check 的 reCAPTCHA v3 site key 同样是公开标识，填在这里；
 * 留空则跳过 App Check 初始化（云端调用可能被 AI Logic 的 App Check 强制拦截，
 * 见 README-HYBRID.md §3）。
 */
export const FIREBASE_CONFIG = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.firebasestorage.app',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
  // App Check（reCAPTCHA v3 site key，Firebase 控制台 App Check 页获取；留空 = 不初始化）
  appCheckSiteKey: '',
};

/* 总开关：false = 未配置真实项目，AI 功能显示「未配置」状态，像素体检照常工作；
 * true = 已填真实配置，启用混合推理。 */
export const FIREBASE_CONFIGURED = false;
