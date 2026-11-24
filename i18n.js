/* 封面体检所 · 双语字符串（EN / 中文切换）
 *
 * 范围：页面 chrome + 新增的 AI 面板 + 像素报告的静态文案（指标名、等级、 verdict、
 * 问题类型标签用映射翻译）。core.js 生成的逐项 advice 是动态中文文本，不做机器翻译，
 * 英文模式下如实保留中文并在面板下方注明。
 * AI 快检 / 深度报告的正文由模型按当前语言直接生成（prompt 语言联动）。
 */
(function () {
  'use strict';

  const STR = {
    zh: {
      headerNote: '像素本地分析 · AI 端侧优先 · 免费',
      heroTitleA: '封面发出去之前，',
      heroTitleB: '先做个全身体检',
      heroSub: '上传一张封面，量六项硬指标：<strong>文字对比度、最小字号、文字占比、明暗、饱和度、留白</strong>。出体检分、逐项建议，外加一张把问题圈出来的诊断图。再加一层 AI：端侧快检看一眼就懂，深度报告手把手改。',
      dropMain: '把封面图拖进来，或点击选择文件',
      dropHint: '支持 JPG / PNG / WebP，横竖版都行 · 也可以直接粘贴（Ctrl+V）',
      samplesLabel: '没有现成的图？拿示例先试：',
      privacyNote: '先说清：六项指标是本地像素规则测量，图片默认不上传。AI 快检优先在你的浏览器里端侧完成（图片不出设备）；点「生成深度报告」才会把图片发往云端 Gemini，平时不会。',
      aiControlsTitle: 'AI 设置',
      localOnlyLabel: '仅本地模式',
      localOnlyHint: '只用端侧模型，不发任何图片到云端；深度报告不可用',
      langLabel: '语言',
      aiFastTitle: 'AI 快检',
      aiFastLoading: 'AI 正在看图…',
      aiFastEmpty: '上传封面后，这里会出现 AI 的一眼判断。',
      aiFastNotConfigured: 'AI 快检未配置：本站尚未填入 Firebase 项目配置。像素体检不受影响；配好后这里会显示端侧快检结果。',
      aiFastError: 'AI 快检这次没跑出来（{reason}），像素体检结果不受影响，换一张图或稍后再试。',
      aiFastDeviceNotReady: '仅本地模式下本机端侧模型未就绪，无法快检；关掉「仅本地模式」可走云端回退。',
      badgeOnDevice: '端侧 · 本地完成',
      badgeInCloud: '云端回退',
      badgeCloud: '云端 · Gemini',
      badgeUnknown: '来源未知',
      badgeNotConfigured: '未配置',
      badgeError: '调用失败',
      firstImpression: '一眼可读性',
      impressionClear: '一眼能读懂',
      impressionOkay: '勉强能读懂',
      impressionUnclear: '一眼读不懂',
      mainSubject: '主视觉',
      readability: '文字可读性',
      mood: '风格情绪',
      quickFixes: '即时建议',
      deepTitle: '深度报告',
      deepHint: '点下面按钮，云端 Gemini 会综合六项像素分与快检判断，给总分修正、逐项改法、3 条改写标题与平台建议。图片将发送到云端处理。',
      deepBtn: '生成深度报告（云端）',
      deepBtnRunning: '云端正在写报告…',
      deepEmpty: '还没有深度报告。',
      deepNotConfigured: '深度报告未配置：本站尚未填入 Firebase 项目配置。',
      deepLocalOnly: '仅本地模式已开启：深度报告需要把图片发往云端，已按你的设置禁用。',
      deepError: '深度报告这次没生成（{reason}），可以重试。',
      adjustedScore: 'AI 修正总分',
      scoreNote: '为什么这样修正',
      improvements: '逐项改法',
      rewrittenTitles: '改写后的标题',
      platformTips: '平台建议',
      tipXiaohongshu: '小红书',
      tipBilibili: 'B站',
      adviceZhOnly: '注：六项指标的逐项建议目前为中文（规则引擎原文），AI 报告已按当前语言生成。',
      againBtn: '再测一张',
      downloadBtn: '下载诊断图',
      metricsTitle: '六项指标',
      diagTitle: '诊断图',
      noIssue: '没有圈出问题区域——六项指标都在可接受范围。',
      issueSummaryWith: '诊断图上圈出了 {n} 处问题，逐条对照改。',
      issueSummaryNone: '没有发现需要圈出来的问题。',
      methodTitle: '像素指标算法口径（规则测量，全是明账）',
      methodNote: '边界也要说清：这是规则估算，不是读图——它不知道你的标题写得好不好、主体好不好看，只管量「缩到手机信息流里还看不看得清」这类像素层面的事。分数是参考，审美还是你说了算。',
      footerTag: '封面管量，不管审美——标题好不好，还得看内容',
      toastImageFirst: '请选择图片文件',
      toastLoadFail: '图片加载失败，换一张试试',
      toastPixelBlocked: '这张图受浏览器安全限制无法读取像素，请换一种方式打开页面',
      toastDiagDownloaded: '诊断图已下载',
    },
    en: {
      headerNote: 'Pixel analysis on-device · AI on-device first · Free',
      heroTitleA: 'Before you publish a cover,',
      heroTitleB: 'give it a full check-up',
      heroSub: 'Upload a cover and get six hard metrics: <strong>text contrast, minimum font size, text coverage, brightness, saturation, whitespace</strong>. You get a score, per-item advice, and a diagnosis image with problem areas circled. Plus one AI layer: an on-device fast read at a glance, and a deep report that walks you through the fixes.',
      dropMain: 'Drop a cover image here, or click to choose a file',
      dropHint: 'JPG / PNG / WebP, portrait or landscape · or paste directly (Ctrl+V)',
      samplesLabel: 'No image handy? Try a sample:',
      privacyNote: 'To be clear: the six metrics are local pixel-rule measurements and your image is not uploaded by default. The AI fast read runs on-device in your browser first (the image never leaves the device); only clicking “Generate deep report” sends the image to cloud Gemini.',
      aiControlsTitle: 'AI settings',
      localOnlyLabel: 'Local-only mode',
      localOnlyHint: 'On-device model only, nothing sent to the cloud; deep report unavailable',
      langLabel: 'Language',
      aiFastTitle: 'AI Fast Read',
      aiFastLoading: 'AI is looking at your cover…',
      aiFastEmpty: 'Upload a cover and the AI’s at-a-glance verdict will appear here.',
      aiFastNotConfigured: 'AI fast read is not configured: no Firebase project is set up for this site yet. The pixel check still works; once configured, the on-device fast read will show here.',
      aiFastError: 'The AI fast read failed this time ({reason}). The pixel report is unaffected — try another image or retry later.',
      aiFastDeviceNotReady: 'In local-only mode the on-device model is not ready on this machine, so no fast read. Turn off “Local-only mode” to fall back to the cloud.',
      badgeOnDevice: 'On-device · Done locally',
      badgeInCloud: 'Cloud fallback',
      badgeCloud: 'Cloud · Gemini',
      badgeUnknown: 'Source unknown',
      badgeNotConfigured: 'Not configured',
      badgeError: 'Call failed',
      firstImpression: 'Readable at a glance',
      impressionClear: 'Clear at a glance',
      impressionOkay: 'Barely readable',
      impressionUnclear: 'Not readable at a glance',
      mainSubject: 'Main subject',
      readability: 'Text readability',
      mood: 'Mood / style',
      quickFixes: 'Instant fixes',
      deepTitle: 'Deep Report',
      deepHint: 'Click below and cloud Gemini will combine the six pixel scores with the fast read to give a revised total, per-item fixes, 3 rewritten titles, and platform advice. Your image will be sent to the cloud for this.',
      deepBtn: 'Generate deep report (cloud)',
      deepBtnRunning: 'Cloud is writing the report…',
      deepEmpty: 'No deep report yet.',
      deepNotConfigured: 'Deep report is not configured: no Firebase project is set up for this site yet.',
      deepLocalOnly: 'Local-only mode is on: the deep report needs to send the image to the cloud, so it is disabled per your setting.',
      deepError: 'The deep report failed this time ({reason}). You can retry.',
      adjustedScore: 'AI-revised total',
      scoreNote: 'Why the revision',
      improvements: 'Fixes, item by item',
      rewrittenTitles: 'Rewritten titles',
      platformTips: 'Platform advice',
      tipXiaohongshu: 'Xiaohongshu',
      tipBilibili: 'Bilibili',
      adviceZhOnly: 'Note: the per-item pixel advice is shown in Chinese (rule-engine original); the AI report is generated in your current language.',
      againBtn: 'Check another',
      downloadBtn: 'Download diagnosis image',
      metricsTitle: 'Six metrics',
      diagTitle: 'Diagnosis image',
      noIssue: 'No problem areas circled — all six metrics are within range.',
      issueSummaryWith: '{n} problem areas are circled on the diagnosis image — fix them one by one.',
      issueSummaryNone: 'No problems found to circle.',
      methodTitle: 'Pixel metrics, in the open (rule-based, no AI)',
      methodNote: 'And the boundary: this is a rule-based estimate, not image understanding — it does not know whether your title is good or your subject is beautiful. It only measures pixel-level things like “still legible when shrunk into a phone feed”. The score is a reference; taste is still yours.',
      footerTag: 'We measure covers, not taste — whether a title works still depends on the content',
      toastImageFirst: 'Please choose an image file',
      toastLoadFail: 'Image failed to load, try another',
      toastPixelBlocked: 'This image cannot be read due to browser security limits — try opening the page another way',
      toastDiagDownloaded: 'Diagnosis image downloaded',
    },
  };

  // core.js 的静态文案映射（不改 core.js，渲染层翻译）
  const METRIC_LABELS = {
    '文字对比度': 'Text contrast',
    '最小字号': 'Minimum font size',
    '文字占比': 'Text coverage',
    '画面明暗': 'Brightness',
    '色彩饱和': 'Saturation',
    '留白与杂乱': 'Whitespace & clutter',
  };
  const GRADES = { '优秀': 'Excellent', '良好': 'Good', '勉强及格': 'Passable', '建议重做': 'Needs rework' };
  const VERDICTS = {
    '优秀': 'Ready to publish as-is.',
    '良好': 'Solid base — fix the circled items, then publish.',
    '勉强及格': 'Publishable, but a few things are costing you clicks.',
    '建议重做': 'Hold off. Fix item by item from the diagnosis image, then re-check.',
  };
  const ISSUE_LABELS = {
    'low-contrast': 'Weak text contrast',
    'small-text': 'Text too small',
    'clutter': 'Cluttered area',
    'empty': 'Large empty area',
  };
  const SAMPLE_NAMES = {
    '合格封面': 'Good cover',
    '大字高对比': 'Big text, high contrast',
    '字小低对比': 'Small text, low contrast',
    '画面杂乱': 'Cluttered',
    '留白过多': 'Too much whitespace',
  };

  let lang = ((navigator.language || (navigator.languages && navigator.languages[0]) || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en');
  try {
    const saved = window.localStorage.getItem('covercheck-lang');
    if (saved === 'en' || saved === 'zh') lang = saved;
  } catch (e) { /* private mode: keep browser-detected default */ }

  function t(key, vars) {
    let s = (STR[lang] && STR[lang][key]) || STR.zh[key] || key;
    if (vars) for (const k of Object.keys(vars)) s = s.replace('{' + k + '}', String(vars[k]));
    return s;
  }
  function metricLabel(zhLabel) {
    return lang === 'en' ? (METRIC_LABELS[zhLabel] || zhLabel) : zhLabel;
  }
  function gradeLabel(zhGrade) {
    return lang === 'en' ? (GRADES[zhGrade] || zhGrade) : zhGrade;
  }
  function verdict(zhGrade) {
    if (lang === 'en') return VERDICTS[zhGrade] || '';
    return null; // zh 用 app.js 原 VERDICTS
  }
  function issueLabel(type) {
    return lang === 'en' ? (ISSUE_LABELS[type] || type) : null; // zh 用 app.js 原 ISSUE_LABELS
  }
  function sampleName(zhName) {
    return lang === 'en' ? (SAMPLE_NAMES[zhName] || zhName) : zhName;
  }
  function setLang(next) {
    lang = next === 'en' ? 'en' : 'zh';
    try { window.localStorage.setItem('covercheck-lang', lang); } catch (e) {}
    return lang;
  }
  function getLang() { return lang; }

  window.CoverCheckI18n = { t, metricLabel, gradeLabel, verdict, issueLabel, sampleName, setLang, getLang };
})();
