/* 封面体检所 · 页面逻辑：读图 → 缩到分析分辨率 → CoverCore.analyze → 渲染报告与诊断图 */
(function () {
  'use strict';
  const MAX_EDGE = 640; // 分析分辨率（长边），与自测口径一致
  const $ = (id) => document.getElementById(id);
  const dropZone = $('dropZone'), fileInput = $('fileInput');
  const resultSection = $('resultSection');

  let currentImg = null;   // 原图 Image 元素
  let currentName = '';
  let currentBlob = null;  // 原图 Blob（供 AI 快检 / 深度报告用）
  let currentBlobPromise = null; // 示例图 fetch 的 Blob promise（与像素分析并行）
  let toastTimer = null;

  // ---------- i18n ----------
  const I18n = window.CoverCheckI18n || {
    t: (k) => k, getLang: () => 'zh', setLang: () => 'zh',
    metricLabel: (s) => s, gradeLabel: (s) => s, verdict: () => null,
    issueLabel: () => null, sampleName: (s) => s,
  };
  const t = (key, vars) => I18n.t(key, vars);

  // ---------- AI 状态（像素链路之外的新增状态） ----------
  let aiModule = null;        // 动态 import('./hybrid-ai.js')，首次上传时加载
  let aiInitStarted = false;
  let localOnlyWanted = false;
  let lastPixelResult = null;
  let lastDims = null;
  let aiFastResult = null;    // { data, source }
  let aiDeepResult = null;
  let aiFastState = 'empty';  // empty | loading | ok | not-configured | error
  let aiFastErrorCode = '';
  let aiDeepState = 'empty';  // empty | loading | ok | not-configured | local-only | error
  let aiDeepErrorCode = '';

  const REASONS = {
    zh: {
      'not-configured': '未配置 Firebase 项目', 'init-failed': '初始化失败',
      'device-not-ready': '本机端侧模型未就绪', 'local-only': '仅本地模式已开启',
      'init-timeout': '初始化超时', 'l1-timeout': '调用超时', 'l2-timeout': '调用超时',
      'bad-json': '返回格式异常', 'fetch-error': '网络请求失败', 'unknown': '未知错误',
    },
    en: {
      'not-configured': 'Firebase project not configured', 'init-failed': 'initialization failed',
      'device-not-ready': 'on-device model not ready on this machine', 'local-only': 'local-only mode is on',
      'init-timeout': 'initialization timed out', 'l1-timeout': 'call timed out', 'l2-timeout': 'call timed out',
      'bad-json': 'invalid response format', 'fetch-error': 'network request failed', 'unknown': 'unknown error',
    },
  };
  function reasonText(code) {
    const map = REASONS[I18n.getLang()] || REASONS.zh;
    return map[code] || code || map.unknown;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------- 输入 ----------
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) loadFile(fileInput.files[0]);
    fileInput.value = '';
  });
  for (const evt of ['dragenter', 'dragover']) {
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('dragging'); });
  }
  for (const evt of ['dragleave', 'drop']) {
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('dragging'); });
  }
  dropZone.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith('image/')) { loadFile(it.getAsFile()); break; }
    }
  });
  document.querySelectorAll('[data-sample]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-sample');
      kickAiInit(); // 手势链里预热端侧模型（M1 §7 第 5 条）
      // 示例图：取回 Blob 供 AI 用（与像素分析并行，不阻塞）
      const blobPromise = fetch(url).then((r) => r.blob()).catch(() => null);
      loadImage(url, btn.textContent + '（示例）', blobPromise);
    });
  });

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) { toast(t('toastImageFirst')); return; }
    currentBlob = file; // File 本身就是 Blob
    currentBlobPromise = Promise.resolve(file);
    kickAiInit(); // 手势链里预热端侧模型（M1 §7 第 5 条）
    const url = URL.createObjectURL(file);
    loadImage(url, file.name);
  }

  function loadImage(url, name, blobPromise) {
    if (blobPromise) {
      currentBlob = null;
      currentBlobPromise = blobPromise.then((b) => { if (b) currentBlob = b; return b || null; });
    }
    const img = new Image();
    img.onload = () => { currentImg = img; currentName = name; runAnalysis(); };
    img.onerror = () => toast(t('toastLoadFail'));
    img.src = url;
  }

  // ---------- 分析 ----------
  function runAnalysis() {
    const iw = currentImg.naturalWidth, ih = currentImg.naturalHeight;
    const scale = Math.min(1, MAX_EDGE / Math.max(iw, ih));
    const aw = Math.max(8, Math.round(iw * scale)), ah = Math.max(8, Math.round(ih * scale));
    const c = document.createElement('canvas');
    c.width = aw; c.height = ah;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(currentImg, 0, 0, aw, ah);
    let data;
    try {
      data = ctx.getImageData(0, 0, aw, ah);
    } catch (err) {
      toast(t('toastPixelBlocked'));
      return;
    }
    const r = window.CoverCore.analyze(data.data, aw, ah);
    renderReport(r, { iw, ih, aw, ah });
  }

  const VERDICTS = {
    '优秀': '这张封面可以直接发。',
    '良好': '底子不错，把下面标出来的地方改完再发。',
    '勉强及格': '能发，但有几处正在偷你的点击率。',
    '建议重做': '先别发。按诊断图逐条改，改完再测一次。'
  };
  const ISSUE_COLORS = {
    'low-contrast': '#c2402a',
    'small-text': '#d97706',
    'clutter': '#7c3aed',
    'empty': '#2563eb'
  };
  const ISSUE_LABELS = {
    'low-contrast': '文字对比太弱',
    'small-text': '字太小',
    'clutter': '区域杂乱',
    'empty': '大面积空白'
  };

  function renderReport(r, dims, opts) {
    lastPixelResult = r;
    lastDims = dims;
    resultSection.hidden = false;
    $('totalScore').textContent = r.total;
    const chip = $('gradeChip');
    chip.textContent = I18n.gradeLabel(r.grade);
    chip.dataset.grade = r.grade;
    $('verdict').textContent = I18n.verdict(r.grade) || VERDICTS[r.grade] || '';
    $('issueSummary').textContent = r.issues.length
      ? t('issueSummaryWith', { n: r.issues.length })
      : t('issueSummaryNone');
    $('fileMeta').textContent = `${currentName} · 原图 ${dims.iw}×${dims.ih} · 分析分辨率 ${dims.aw}×${dims.ah}`;

    // 六项指标（标签按语言映射；value/advice 是 core.js 原文，英文模式下保留中文并加注）
    const list = $('metricList');
    list.innerHTML = '';
    for (const m of r.metrics) {
      const row = document.createElement('div');
      row.className = 'metric-row';
      row.innerHTML = `
        <div class="metric-top">
          <span class="metric-label">${esc(I18n.metricLabel(m.label))}</span>
          <span class="metric-value">${esc(m.value)}</span>
          <span class="metric-score st-${m.status}">${m.score}</span>
        </div>
        <div class="metric-bar"><div class="metric-fill st-${m.status}" style="width:${m.score}%"></div></div>
        <p class="metric-advice">${esc(m.advice)}</p>`;
      list.appendChild(row);
    }
    const note = $('adviceLangNote');
    note.hidden = I18n.getLang() !== 'en';
    note.textContent = t('adviceZhOnly');

    renderDiagnosis(r, dims);

    // 问题清单
    const ol = $('issueList');
    ol.innerHTML = '';
    $('noIssue').hidden = r.issues.length > 0;
    r.issues.forEach((issue, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="issue-badge" style="background:${ISSUE_COLORS[issue.type]}">${i + 1}</span>
        <span class="issue-tag" style="color:${ISSUE_COLORS[issue.type]}">${esc(I18n.issueLabel(issue.type) || ISSUE_LABELS[issue.type])}</span>
        <span class="issue-text">${esc(issue.text)}</span>`;
      ol.appendChild(li);
    });

    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (opts && opts.rerunAi === false) { renderAiFast(); renderAiDeep(); } // 语言切换：只重渲染，不重新调 AI
    else runAiFast(); // 像素报告先出，AI 快检随后（不阻塞）
  }

  function renderDiagnosis(r, dims) {
    const canvas = $('diagCanvas');
    const maxW = 920;
    const dw = Math.min(maxW, dims.iw);
    const dh = Math.round(dw * dims.ih / dims.iw);
    canvas.width = dw; canvas.height = dh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(currentImg, 0, 0, dw, dh);
    const sx = dw / dims.aw, sy = dh / dims.ah;
    const lineW = Math.max(2, Math.round(dw / 320));
    const fontPx = Math.max(13, Math.round(dw / 34));
    r.issues.forEach((issue, i) => {
      const b = issue.box;
      const x = b.x0 * sx, y = b.y0 * sy;
      const w = (b.x1 - b.x0 + 1) * sx, h = (b.y1 - b.y0 + 1) * sy;
      const color = ISSUE_COLORS[issue.type];
      ctx.lineWidth = lineW;
      ctx.strokeStyle = color;
      ctx.strokeRect(x, y, w, h);
      // 编号角标
      const rBadge = fontPx * 0.85;
      const cx = Math.min(Math.max(x, rBadge + 2), dw - rBadge - 2);
      const cy = Math.min(Math.max(y, rBadge + 2), dh - rBadge - 2);
      ctx.beginPath();
      ctx.arc(cx, cy, rBadge, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${fontPx}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), cx, cy + 1);
    });
  }

  $('downloadBtn').addEventListener('click', () => {
    const canvas = $('diagCanvas');
    if (!canvas.width) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '封面诊断图.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(t('toastDiagDownloaded'));
    }, 'image/png');
  });

  $('againBtn').addEventListener('click', () => {
    resultSection.hidden = true;
    currentImg = null;
    currentBlob = null;
    currentBlobPromise = null;
    lastPixelResult = null;
    lastDims = null;
    aiFastResult = null;
    aiDeepResult = null;
    aiFastState = 'empty';
    aiDeepState = 'empty';
    renderAiFast();
    renderAiDeep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    dropZone.focus();
  });

  // ================= AI 层（新增；像素链路之外） =================

  // 静态文案应用（data-i18n / data-i18n-html），加载时与语言切换时调用。
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    document.querySelectorAll('[data-sample]').forEach((btn) => {
      if (!btn.hasAttribute('data-sample-name')) btn.setAttribute('data-sample-name', btn.textContent);
      btn.textContent = I18n.sampleName(btn.getAttribute('data-sample-name'));
    });
    $('langZhBtn').classList.toggle('active', I18n.getLang() === 'zh');
    $('langEnBtn').classList.toggle('active', I18n.getLang() === 'en');
    if (document.documentElement) document.documentElement.lang = I18n.getLang() === 'en' ? 'en' : 'zh-CN';
  }

  // 语言切换：重译静态文案 + 按当前语言重渲染已有报告（不重新调 AI）。
  function onLangChange(next) {
    I18n.setLang(next);
    applyI18n();
    if (lastPixelResult && lastDims) renderReport(lastPixelResult, lastDims, { rerunAi: false });
    else { renderAiFast(); renderAiDeep(); }
  }
  $('langZhBtn').addEventListener('click', () => onLangChange('zh'));
  $('langEnBtn').addEventListener('click', () => onLangChange('en'));

  // 仅本地模式开关：立即生效于下一次 AI 调用；深度报告按钮同步置灰。
  $('localOnlyToggle').addEventListener('change', (e) => {
    localOnlyWanted = e.target.checked;
    if (aiModule) aiModule.setLocalOnly(localOnlyWanted);
    syncDeepButton();
    if (localOnlyWanted) { aiDeepState = 'local-only'; renderAiDeep(); }
    else if (aiDeepState === 'local-only') { aiDeepState = 'empty'; renderAiDeep(); }
  });

  function syncDeepButton() {
    const btn = $('deepReportBtn');
    btn.disabled = localOnlyWanted || aiDeepState === 'loading';
    btn.textContent = aiDeepState === 'loading' ? t('deepBtnRunning') : t('deepBtn');
  }

  // 预热：动态加载 hybrid-ai.js 并在手势链里调 init()。
  // 失败也不影响像素体检（AI 面板会显示未配置/失败状态）。
  function kickAiInit() {
    if (aiInitStarted) return;
    aiInitStarted = true;
    import('./hybrid-ai.js')
      .then((mod) => {
        aiModule = mod;
        if (localOnlyWanted) mod.setLocalOnly(true);
        return mod.init();
      })
      .catch(() => { aiModule = null; });
  }

  function setBadge(el, kind, key) {
    el.className = 'source-badge st-' + kind;
    el.hidden = false;
    el.textContent = t(key);
  }

  // ---------- L1 快检 ----------
  async function runAiFast() {
    aiFastResult = null;
    aiDeepResult = null;
    aiDeepState = 'empty';
    renderAiDeep();
    // 示例图的 Blob 是 fetch 并行的，等它（最多 5 秒），避免像素分析先跑完导致误判无图
    if (!currentBlob && currentBlobPromise) {
      try {
        await Promise.race([currentBlobPromise, new Promise((r) => setTimeout(() => r(null), 5000))]);
      } catch (e) { /* fetch 失败则走下面的无图分支 */ }
    }
    if (!currentBlob) {
      aiFastState = 'error';
      aiFastErrorCode = 'fetch-error';
      renderAiFast();
      return;
    }
    aiFastState = 'loading';
    renderAiFast();
    try {
      if (!aiModule) {
        const mod = await import('./hybrid-ai.js');
        aiModule = mod;
        if (localOnlyWanted) mod.setLocalOnly(true);
      }
      const out = await aiModule.fastRead({ blob: currentBlob, pixel: lastPixelResult, lang: I18n.getLang() });
      aiFastResult = out;
      aiFastState = 'ok';
    } catch (e) {
      aiFastState = e && e.code === 'not-configured' ? 'not-configured' : 'error';
      aiFastErrorCode = (e && e.code) || 'unknown';
    }
    renderAiFast();
  }

  function renderAiFast() {
    const badge = $('aiSourceBadge');
    const body = $('aiFastBody');
    if (aiFastState === 'empty') {
      badge.className = 'source-badge st-idle';
      badge.textContent = t('badgeNotConfigured');
      body.innerHTML = `<p class="ai-empty">${esc(t('aiFastEmpty'))}</p>`;
      return;
    }
    if (aiFastState === 'loading') {
      setBadge(badge, 'idle', 'badgeUnknown');
      badge.textContent = '…';
      body.innerHTML = `<p class="ai-empty">${esc(t('aiFastLoading'))}</p>`;
      return;
    }
    if (aiFastState === 'not-configured') {
      setBadge(badge, 'idle', 'badgeNotConfigured');
      body.innerHTML = `<p class="ai-empty">${esc(t('aiFastNotConfigured'))}</p>`;
      return;
    }
    if (aiFastState === 'error') {
      setBadge(badge, 'error', 'badgeError');
      const reason = aiFastErrorCode === 'device-not-ready'
        ? t('aiFastDeviceNotReady')
        : t('aiFastError', { reason: reasonText(aiFastErrorCode) });
      body.innerHTML = `<p class="ai-empty">${esc(reason)}</p>`;
      return;
    }
    // ok
    const d = aiFastResult.data;
    const src = aiFastResult.source;
    if (src === 'on_device') setBadge(badge, 'device', 'badgeOnDevice');
    else if (src === 'in_cloud') setBadge(badge, 'cloud', 'badgeInCloud');
    else setBadge(badge, 'idle', 'badgeUnknown');
    const impKey = { clear: 'impressionClear', okay: 'impressionOkay', unclear: 'impressionUnclear' }[d.firstImpression] || 'impressionOkay';
    const fixes = (d.quickFixes || []).map((f) => `<li>${esc(f)}</li>`).join('');
    body.innerHTML = `
      <dl class="ai-facts">
        <div class="ai-fact"><dt>${esc(t('firstImpression'))}</dt><dd>${esc(t(impKey))}</dd></div>
        <div class="ai-fact"><dt>${esc(t('mainSubject'))}</dt><dd>${esc(d.mainSubject)}</dd></div>
        <div class="ai-fact"><dt>${esc(t('readability'))}</dt><dd>${esc(String(d.readability))} / 5</dd></div>
        <div class="ai-fact"><dt>${esc(t('mood'))}</dt><dd>${esc(d.mood)}</dd></div>
      </dl>
      ${fixes ? `<h3>${esc(t('quickFixes'))}</h3><ul class="ai-fixes">${fixes}</ul>` : ''}`;
  }

  // ---------- L2 深度报告 ----------
  $('deepReportBtn').addEventListener('click', async () => {
    if (localOnlyWanted || aiDeepState === 'loading' || !lastPixelResult || !currentBlob) return;
    aiDeepState = 'loading';
    syncDeepButton();
    renderAiDeep();
    try {
      if (!aiModule) {
        const mod = await import('./hybrid-ai.js');
        aiModule = mod;
        if (localOnlyWanted) mod.setLocalOnly(true);
      }
      const out = await aiModule.deepReport({
        blob: currentBlob, pixel: lastPixelResult,
        l1: aiFastResult ? aiFastResult.data : null, lang: I18n.getLang(),
      });
      aiDeepResult = out;
      aiDeepState = 'ok';
    } catch (e) {
      aiDeepState = (e && e.code === 'not-configured') ? 'not-configured'
        : (e && e.code === 'local-only') ? 'local-only' : 'error';
      aiDeepErrorCode = (e && e.code) || 'unknown';
    }
    syncDeepButton();
    renderAiDeep();
  });

  function renderAiDeep() {
    const badge = $('deepSourceBadge');
    const body = $('deepBody');
    syncDeepButton();
    if (aiDeepState === 'empty') {
      badge.hidden = true;
      body.innerHTML = `<p class="ai-empty">${esc(t('deepEmpty'))}</p>`;
      return;
    }
    if (aiDeepState === 'loading') {
      badge.hidden = true;
      body.innerHTML = `<p class="ai-empty">${esc(t('deepBtnRunning'))}</p>`;
      return;
    }
    if (aiDeepState === 'not-configured') {
      badge.hidden = true;
      body.innerHTML = `<p class="ai-empty">${esc(t('deepNotConfigured'))}</p>`;
      return;
    }
    if (aiDeepState === 'local-only') {
      badge.hidden = true;
      body.innerHTML = `<p class="ai-empty">${esc(t('deepLocalOnly'))}</p>`;
      return;
    }
    if (aiDeepState === 'error') {
      badge.hidden = true;
      body.innerHTML = `<p class="ai-empty">${esc(t('deepError', { reason: reasonText(aiDeepErrorCode) }))}</p>`;
      return;
    }
    // ok
    const d = aiDeepResult.data;
    setBadge(badge, 'cloud', 'badgeCloud');
    const items = (d.improvements || []).map((it) =>
      `<li><strong>${esc(it.metric)}</strong> — ${esc(it.advice)}</li>`).join('');
    const titles = (d.rewrittenTitles || []).map((x) => `<li>${esc(x)}</li>`).join('');
    const tips = d.platformTips || {};
    body.innerHTML = `
      <dl class="ai-facts">
        <div class="ai-fact"><dt>${esc(t('adjustedScore'))}</dt><dd><strong>${esc(String(d.adjustedScore))} / 100</strong></dd></div>
        <div class="ai-fact"><dt>${esc(t('scoreNote'))}</dt><dd>${esc(d.scoreNote)}</dd></div>
      </dl>
      ${items ? `<h3>${esc(t('improvements'))}</h3><ul class="ai-list">${items}</ul>` : ''}
      ${titles ? `<h3>${esc(t('rewrittenTitles'))}</h3><ol class="ai-list">${titles}</ol>` : ''}
      <h3>${esc(t('platformTips'))}</h3>
      <ul class="ai-list">
        <li><strong>${esc(t('tipXiaohongshu'))}</strong> — ${esc(tips.xiaohongshu || '')}</li>
        <li><strong>${esc(t('tipBilibili'))}</strong> — ${esc(tips.bilibili || '')}</li>
      </ul>`;
  }

  // 初始化静态文案（默认中文；localStorage 有保存时恢复）
  applyI18n();
  renderAiFast();
  renderAiDeep();
})();
