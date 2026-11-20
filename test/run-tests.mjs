#!/usr/bin/env node
/* 自测：用与页面完全相同的 core.js 分析 5 张程序生成的测试封面原始像素，
 * 断言分数拉开差距、关键问题被检出。像素由 gen_tests.py 导出（480x270 RGBA）。 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../core.js');

const dir = new URL('.', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));

const results = {};
for (const [name, { width, height }] of Object.entries(manifest)) {
  const buf = readFileSync(dir + name + '.rgba');
  const rgba = new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
  results[name] = core.analyze(rgba, width, height);
}

for (const [name, r] of Object.entries(results)) {
  const s = r.stats;
  console.log(`\n=== ${name} ===`);
  console.log(`总分 ${r.total}（${r.grade}） 明细 对比${r.scores.contrast} 字号${r.scores.minFont} 占比${r.scores.coverage} 明暗${r.scores.brightness} 饱和${r.scores.saturation} 留白${r.scores.whitespace}`);
  console.log(`实测 对比度 ${s.contrastRatio.toFixed(2)} 最小字高 ${s.minFontPct.toFixed(1)}% 文字占比 ${(s.textCoverage * 100).toFixed(0)}% 亮度 ${s.meanLum.toFixed(2)} 饱和 ${s.meanSat.toFixed(2)} 留白 ${(s.whitespaceRatio * 100).toFixed(0)}% 边缘 ${(s.edgeDensity * 100).toFixed(0)}% 字符数 ${s.charCount} 文字块 ${r.blocks.length}`);
  console.log(`标注 ${r.issues.length} 条：` + r.issues.map(i => i.type).join(', '));
}

// ---------- 断言 ----------
let fails = 0;
function check(label, cond) {
  console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + label);
  if (!cond) fails++;
}
const R = results;
console.log('\n--- 断言 ---');
check('两张好封面占据前二', (() => {
  const sorted = Object.entries(R).sort((a, b) => b[1].total - a[1].total).map(e => e[0]);
  return sorted[0] !== sorted[1] && ['good-cover', 'good-big-highcontrast'].includes(sorted[0]) && ['good-cover', 'good-big-highcontrast'].includes(sorted[1]);
})());
check('大字高对比 ≥80 分', R['good-big-highcontrast'].total >= 80);
check('合格封面 ≥80 分', R['good-cover'].total >= 80);
check('字小低对比 ≤60 分', R['bad-small-lowcontrast'].total <= 60);
check('字小低对比：对比度分 < 字号分之外还应检出低对比或小字标注',
  R['bad-small-lowcontrast'].issues.some(i => i.type === 'low-contrast' || i.type === 'small-text'));
check('字小低对比：实测对比度 < 3', R['bad-small-lowcontrast'].stats.contrastRatio < 3);
check('字小低对比：实测最小字高 < 3.5%', R['bad-small-lowcontrast'].stats.minFontPct < 3.5);
check('杂乱图：留白分 ≤55', R['cluttered'].scores.whitespace <= 55);
check('杂乱图：检出 clutter 标注', R['cluttered'].issues.some(i => i.type === 'clutter'));
check('留白图：留白占比 > 58%', R['whitespace'].stats.whitespaceRatio > 0.58);
check('留白图：检出 empty 标注', R['whitespace'].issues.some(i => i.type === 'empty'));
check('留白图：总分 < 合格封面', R['whitespace'].total < R['good-cover'].total);
check('最高分与最低分差距 ≥25', Math.max(...Object.values(R).map(r => r.total)) - Math.min(...Object.values(R).map(r => r.total)) >= 25);
check('五张图分数互不相同（拉开差距）', new Set(Object.values(R).map(r => r.total)).size === 5);

console.log(fails === 0 ? '\n全部断言通过' : `\n${fails} 条断言失败`);
process.exit(fails ? 1 : 0);
