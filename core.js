/*
 * 封面体检所 · 分析核心（纯像素函数，浏览器与 Node 自测共用同一份代码）
 *
 * 诚实口径：本工具不识别文字内容、不调用任何 AI 模型。
 * 它只做像素层面的规则测量：
 *  - 文字区域/字号：Otsu 二值化后找「字符状连通域」，按尺寸/填充率/宽高比过滤，
 *    相邻字符合并成文字块；字号取字符高度的低分位数，换算成占画面高度的百分比。
 *  - 对比度：文字块内字符像素的平均色 vs 文字块外圈背景像素的平均色，
 *    按 WCAG 相对亮度公式算亮度比 (L1+0.05)/(L2+0.05)。
 *  - 明暗：全图平均相对亮度（sRGB 线性化后加权）。
 *  - 饱和度：逐像素 HSV 饱和度取均值。
 *  - 留白：把画面切成网格，局部边缘密度与灰度方差都极低的格子记为「安静格」，
 *    安静格占比即留白比例；边缘密度极高且不在文字块内的格子记为「杂乱格」。
 * 输入约定：rgba 为 Uint8ClampedArray/Uint8Array（RGBA 交错），
 * 调用方应先把图缩到长边 ≤480px 再传入（页面端用 canvas 缩放，自测端同样缩放）。
 */
(function (global) {
  'use strict';

  // ---------- 基础 ----------
  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function relLum(r, g, b) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  }
  // 分段线性打分：points 为 [[x, score], ...]（x 递增），区间外钳制
  function band(x, points) {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      if (x <= points[i][0]) {
        const x0 = points[i - 1][0], y0 = points[i - 1][1];
        const x1 = points[i][0], y1 = points[i][1];
        return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
      }
    }
    return points[points.length - 1][1];
  }
  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
    return sorted[idx];
  }

  // ---------- Otsu 阈值 ----------
  function otsuThreshold(gray, n) {
    const hist = new Float64Array(256);
    for (let i = 0; i < n; i++) hist[gray[i]]++;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = -1, thr = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (wB === 0) continue;
      const wF = n - wB;
      if (wF === 0) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    return thr;
  }

  // ---------- 连通域标记（4 连通，BFS） ----------
  // mask: Uint8Array（1=前景）。返回分量数组（含 bbox/面积/颜色和）
  function labelComponents(mask, rgba, W, H) {
    const labels = new Int32Array(W * H).fill(-1);
    const comps = [];
    const stack = [];
    for (let start = 0; start < W * H; start++) {
      if (!mask[start] || labels[start] !== -1) continue;
      const id = comps.length;
      let x0 = W, y0 = H, x1 = -1, y1 = -1, area = 0, sr = 0, sg = 0, sb = 0;
      labels[start] = id;
      stack.length = 0;
      stack.push(start);
      while (stack.length) {
        const idx = stack.pop();
        const x = idx % W, y = (idx / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        area++;
        sr += rgba[idx * 4]; sg += rgba[idx * 4 + 1]; sb += rgba[idx * 4 + 2];
        if (x > 0 && mask[idx - 1] && labels[idx - 1] === -1) { labels[idx - 1] = id; stack.push(idx - 1); }
        if (x < W - 1 && mask[idx + 1] && labels[idx + 1] === -1) { labels[idx + 1] = id; stack.push(idx + 1); }
        if (y > 0 && mask[idx - W] && labels[idx - W] === -1) { labels[idx - W] = id; stack.push(idx - W); }
        if (y < H - 1 && mask[idx + W] && labels[idx + W] === -1) { labels[idx + W] = id; stack.push(idx + W); }
      }
      comps.push({ id, x0, y0, x1, y1, area, sr, sg, sb });
    }
    return { comps, labels };
  }

  function isCharLike(c, W, H) {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    if (h < Math.max(3, 0.008 * H) || h > 0.30 * H) return false;
    if (w < 2 || w > 0.45 * W) return false;
    if (c.area < 5 || c.area > 0.03 * W * H) return false;
    const fill = c.area / (w * h);
    if (fill < 0.10 || fill > 0.95) return false;
    const aspect = w / h;
    if (aspect < 0.06 || aspect > 14) return false;
    return true;
  }

  // ---------- 主分析 ----------
  function analyze(rgba, W, H) {
    const n = W * H;
    const gray = new Uint8Array(n);
    let lumSum = 0, satSum = 0;
    for (let i = 0; i < n; i++) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      lumSum += relLum(r, g, b);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      satSum += mx === 0 ? 0 : (mx - mn) / mx;
    }
    const meanLum = lumSum / n;
    const meanSat = satSum / n;

    // Sobel 边缘
    const edge = new Uint8Array(n);
    let edgeCount = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx = -gray[i - W - 1] - 2 * gray[i - 1] - gray[i + W - 1]
                   + gray[i - W + 1] + 2 * gray[i + 1] + gray[i + W + 1];
        const gy = -gray[i - W - 1] - 2 * gray[i - W] - gray[i - W + 1]
                   + gray[i + W - 1] + 2 * gray[i + W] + gray[i + W + 1];
        if (Math.abs(gx) + Math.abs(gy) > 140) { edge[i] = 1; edgeCount++; }
      }
    }
    const edgeDensity = edgeCount / n;

    // 两种极性的字符状连通域
    const thr = otsuThreshold(gray, n);
    const darkMask = new Uint8Array(n), lightMask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (gray[i] <= thr) darkMask[i] = 1; else lightMask[i] = 1;
    }
    const darkRes = labelComponents(darkMask, rgba, W, H);
    const lightRes = labelComponents(lightMask, rgba, W, H);
    // 空腔排除：若某分量被「单一相反极性分量」包围（bbox 外圈 1px 环的主导标签
    // 占多数且该分量面积与本分量同量级），它是图形/字形的封闭空腔，不是笔画。
    function isHole(c, opp) {
      const x0 = Math.max(0, c.x0 - 1), y0 = Math.max(0, c.y0 - 1);
      const x1 = Math.min(W - 1, c.x1 + 1), y1 = Math.min(H - 1, c.y1 + 1);
      const counts = new Map();
      let tot = 0;
      for (let x = x0; x <= x1; x++) {
        for (const y of [y0, y1]) {
          const lb = opp.labels[y * W + x];
          if (lb >= 0) { counts.set(lb, (counts.get(lb) || 0) + 1); tot++; }
        }
      }
      for (let y = y0; y <= y1; y++) {
        for (const x of [x0, x1]) {
          const lb = opp.labels[y * W + x];
          if (lb >= 0) { counts.set(lb, (counts.get(lb) || 0) + 1); tot++; }
        }
      }
      if (!tot) return false;
      let domId = -1, domCnt = 0;
      for (const [id, cnt] of counts) if (cnt > domCnt) { domCnt = cnt; domId = id; }
      if (domCnt / tot < 0.6) return false;
      const domArea = opp.comps[domId].area;
      return domArea > 0.15 * c.area && domArea < 25 * c.area;
    }
    let totalComponents = 0;
    for (const res of [darkRes, lightRes]) {
      for (const c of res.comps) if (c.area >= 3) totalComponents++;
    }
    const chars = [];
    const charPixelMask = new Uint8Array(n);
    for (const [res, opp] of [[darkRes, lightRes], [lightRes, darkRes]]) {
      const { comps, labels } = res;
      for (const c of comps) {
        if (!isCharLike(c, W, H)) continue;
        if (isHole(c, opp)) continue;
        c.h = c.y1 - c.y0 + 1; c.w = c.x1 - c.x0 + 1;
        chars.push(c);
        // 标记字符像素（供背景采样排除）
        for (let y = c.y0; y <= c.y1; y++) {
          for (let x = c.x0; x <= c.x1; x++) {
            const idx = y * W + x;
            if (labels[idx] === c.id) charPixelMask[idx] = 1;
          }
        }
      }
    }
    const hasText = chars.length >= 2;

    // 合并文字块：按中位字高扩张 bbox 后合并重叠框
    let blocks = [];
    let minFontPct = 0, medianCharH = 0;
    if (hasText) {
      const heights = chars.map(c => c.h).sort((a, b) => a - b);
      medianCharH = percentile(heights, 0.5);
      const padX = 0.35 * medianCharH, padY = 0.25 * medianCharH;
      const boxes = chars.map(c => ({
        x0: c.x0 - padX, y0: c.y0 - padY, x1: c.x1 + padX, y1: c.y1 + padY, members: [c]
      }));
      let merged = true;
      while (merged) {
        merged = false;
        outer:
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            if (a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1) {
              a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0);
              a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1);
              a.members = a.members.concat(b.members);
              boxes.splice(j, 1);
              merged = true;
              break outer;
            }
          }
        }
      }
      blocks = boxes.map(b => {
        let x0 = W, y0 = H, x1 = -1, y1 = -1, area = 0;
        for (const c of b.members) {
          x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0);
          x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1);
          area += c.area;
        }
        // 行带估计：成员 bbox 的纵向区间合并成行，行高取成员 bbox 的纵向并集——
        // 汉字由多个笔画分量组成，单个分量高度不代表字号，整行笔画的纵向跨度才代表。
        const ivs = b.members.map(c => [c.y0, c.y1]).sort((p, q) => p[0] - q[0]);
        const lines = [];
        for (const [ly0, ly1] of ivs) {
          const last = lines[lines.length - 1];
          if (last && ly0 <= last[1] + 1) last[1] = Math.max(last[1], ly1);
          else lines.push([ly0, ly1]);
        }
        const minLineArea = Math.max(20, 0.00015 * W * H);
        const validLines = lines.filter(([ly0, ly1]) => {
          const mem = b.members.filter(c => (c.y0 + c.y1) / 2 >= ly0 && (c.y0 + c.y1) / 2 <= ly1);
          const la = mem.reduce((s, c) => s + c.area, 0);
          const lw = Math.max(...mem.map(c => c.x1)) - Math.min(...mem.map(c => c.x0)) + 1;
          return la >= minLineArea && (mem.length >= 2 || lw >= 10);
        }).map(([ly0, ly1]) => ly1 - ly0 + 1);
        let minLineH = validLines.length ? Math.min(...validLines) : (y1 - y0 + 1);
        let hasValidLine = validLines.length > 0;
        // 兜底：块高超过画面一半时多半是多个元素链式误合并，行带会失真——
        // 改用成员分量高度中位数 ×1.5 近似字号（笔画分量高度系统性小于整字高度）。
        if (y1 - y0 + 1 > 0.5 * H) {
          const mh = percentile(b.members.map(c => c.h).sort((p, q) => p - q), 0.5);
          minLineH = Math.min(y1 - y0 + 1, Math.round(mh * 1.5));
          hasValidLine = true;
        }
        return { x0, y0, x1, y1, chars: b.members.length, fgArea: area, minLineH, hasValidLine };
      });
      // 全图最小字号：取「有有效行」的块里最小的行高（小块噪点不参与）
      const lineBlocks = blocks.filter(b => b.hasValidLine);
      if (lineBlocks.length) {
        minFontPct = Math.min(...lineBlocks.map(b => b.minLineH)) / H * 100;
      }
    }

    // 每块对比度：先取外圈背景色，再在块内取「离背景最远的 30% 像素」作文字色——
    // 抗锯齿边缘像素和汉字封闭空腔（与背景同色）都不会污染文字色估计。
    let contrastRatio = 0, minBlockRatio = Infinity;
    if (hasText) {
      let wSum = 0;
      for (const b of blocks) {
        const bh = b.y1 - b.y0 + 1;
        const ex = Math.round(0.35 * bh), ey = Math.round(0.35 * bh);
        const bx0 = Math.max(0, b.x0 - ex), by0 = Math.max(0, b.y0 - ey);
        const bx1 = Math.min(W - 1, b.x1 + ex), by1 = Math.min(H - 1, b.y1 + ey);
        let sr = 0, sg = 0, sb = 0, cnt = 0;
        for (let y = by0; y <= by1; y++) {
          for (let x = bx0; x <= bx1; x++) {
            const idx = y * W + x;
            if (charPixelMask[idx]) continue;
            if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) continue;
            sr += rgba[idx * 4]; sg += rgba[idx * 4 + 1]; sb += rgba[idx * 4 + 2]; cnt++;
          }
        }
        const bgL = cnt >= 8 ? relLum(sr / cnt, sg / cnt, sb / cnt) : meanLum;
        // 文字色只从「字符像素」里取：按 |L - bgL| 排序取最远的 30%——
        // 块内大片背景、汉字空腔、抗锯齿边缘都不会污染文字色估计。
        let pix = [];
        for (let y = b.y0; y <= b.y1; y++) {
          for (let x = b.x0; x <= b.x1; x++) {
            const idx = y * W + x;
            if (!charPixelMask[idx]) continue;
            const L = relLum(rgba[idx * 4], rgba[idx * 4 + 1], rgba[idx * 4 + 2]);
            pix.push([Math.abs(L - bgL), idx]);
          }
        }
        if (pix.length < 8) { // 字符像素太少时退回全块像素
          pix = [];
          for (let y = b.y0; y <= b.y1; y++) {
            for (let x = b.x0; x <= b.x1; x++) {
              const idx = y * W + x;
              const L = relLum(rgba[idx * 4], rgba[idx * 4 + 1], rgba[idx * 4 + 2]);
              pix.push([Math.abs(L - bgL), idx]);
            }
          }
        }
        pix.sort((p, q) => q[0] - p[0]);
        const take = Math.max(8, Math.floor(pix.length * 0.25));
        let fr = 0, fg = 0, fb = 0;
        for (let i = 0; i < take && i < pix.length; i++) {
          const idx = pix[i][1];
          fr += rgba[idx * 4]; fg += rgba[idx * 4 + 1]; fb += rgba[idx * 4 + 2];
        }
        const fgL = relLum(fr / take, fg / take, fb / take);
        const ratio = (Math.max(fgL, bgL) + 0.05) / (Math.min(fgL, bgL) + 0.05);
        b.ratio = ratio; b.fgL = fgL; b.bgL = bgL;
        contrastRatio += ratio * b.fgArea;
        wSum += b.fgArea;
        if (ratio < minBlockRatio) minBlockRatio = ratio;
      }
      contrastRatio = wSum ? contrastRatio / wSum : 0;
    } else {
      // 无文字兜底：两个最主导量化色之间的亮度比
      const hist = new Map();
      for (let i = 0; i < n; i += 2) {
        const key = ((rgba[i * 4] >> 5) << 6) | ((rgba[i * 4 + 1] >> 5) << 3) | (rgba[i * 4 + 2] >> 5);
        const e = hist.get(key) || { cnt: 0, r: 0, g: 0, b: 0 };
        e.cnt++; e.r += rgba[i * 4]; e.g += rgba[i * 4 + 1]; e.b += rgba[i * 4 + 2];
        hist.set(key, e);
      }
      const top = [...hist.values()].sort((a, b) => b.cnt - a.cnt).slice(0, 2);
      if (top.length === 2) {
        const l1 = relLum(top[0].r / top[0].cnt, top[0].g / top[0].cnt, top[0].b / top[0].cnt);
        const l2 = relLum(top[1].r / top[1].cnt, top[1].g / top[1].cnt, top[1].b / top[1].cnt);
        contrastRatio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      } else {
        contrastRatio = 1;
      }
      minBlockRatio = contrastRatio;
    }

    // 网格：留白与杂乱
    const cell = 16;
    const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
    const cellKind = new Uint8Array(cols * rows); // 0 普通 1 安静 2 杂乱
    const cellChar = new Float32Array(cols * rows); // 每格字符像素密度
    let quietCells = 0, busyCells = 0;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const px0 = cx * cell, py0 = cy * cell;
        const px1 = Math.min(W, px0 + cell), py1 = Math.min(H, py0 + cell);
        let cnt = 0, eCnt = 0, sum = 0, sum2 = 0, chCnt = 0;
        for (let y = py0; y < py1; y++) {
          for (let x = px0; x < px1; x++) {
            const idx = y * W + x;
            cnt++; eCnt += edge[idx]; chCnt += charPixelMask[idx];
            sum += gray[idx]; sum2 += gray[idx] * gray[idx];
          }
        }
        cellChar[cy * cols + cx] = chCnt / cnt;
        const mean = sum / cnt;
        const std = Math.sqrt(Math.max(0, sum2 / cnt - mean * mean));
        const eD = eCnt / cnt;
        const ci = cy * cols + cx;
        if (eD < 0.012 && std < 9) { cellKind[ci] = 1; quietCells++; }
        else if (eD > 0.10) cellKind[ci] = 2;
        if (eD >= 0.05) busyCells++;
      }
    }
    const whitespaceRatio = quietCells / (cols * rows);
    const busyRatio = busyCells / (cols * rows);

    // 区域聚类（4 连通，格子级）；valueArr 给定时同时累计每区域的格值和
    function clusterCells(kind, valueArr) {
      const seen = new Uint8Array(cols * rows);
      const regions = [];
      for (let s = 0; s < cols * rows; s++) {
        if (cellKind[s] !== kind || seen[s]) continue;
        const stack = [s]; seen[s] = 1;
        let cx0 = cols, cy0 = rows, cx1 = -1, cy1 = -1, cnt = 0, vsum = 0;
        while (stack.length) {
          const cur = stack.pop();
          const x = cur % cols, y = (cur / cols) | 0;
          cx0 = Math.min(cx0, x); cx1 = Math.max(cx1, x);
          cy0 = Math.min(cy0, y); cy1 = Math.max(cy1, y);
          cnt++;
          if (valueArr) vsum += valueArr[cur];
          const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
          for (const [nx, ny] of nb) {
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const ni = ny * cols + nx;
            if (cellKind[ni] === kind && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
          }
        }
        regions.push({
          x0: cx0 * cell, y0: cy0 * cell,
          x1: Math.min(W, (cx1 + 1) * cell) - 1, y1: Math.min(H, (cy1 + 1) * cell) - 1,
          cells: cnt, vmean: cnt ? vsum / cnt : 0
        });
      }
      return regions.sort((a, b) => b.cells - a.cells);
    }
    const textCoverage = hasText
      ? blocks.reduce((s, b) => s + (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1), 0) / n
      : 0;
    // 杂乱区域：高边缘格聚类，且区域内字符像素密度低（不是文字本身）才算杂乱；
    // 面积按全部区域算（展示只取前 3）
    const allClutter = clusterCells(2, cellChar).filter(r => r.cells >= 2 && r.vmean < 0.06);
    const clutterRegions = allClutter.slice(0, 3);
    const clutterArea = allClutter.reduce((s, r) => s + (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1), 0) / n;
    // 大面积空白标注只在「主体确实撑不起来」时给：安静格 >75% 且文字占比 <3%
    const emptyRegions = (whitespaceRatio > 0.75 && textCoverage < 0.03) ? clusterCells(1).slice(0, 1) : [];

    // ---------- 打分 ----------
    const scores = {};
    scores.contrast = Math.round(band(contrastRatio,
      [[1, 5], [1.5, 20], [2, 35], [2.5, 50], [3, 62], [3.5, 74], [4.5, 88], [7, 100]]));
    scores.minFont = hasText ? Math.round(band(minFontPct,
      [[0, 10], [1.5, 25], [2.5, 42], [3.5, 60], [4.5, 78], [5.5, 90], [7, 100]])) : 30;
    scores.coverage = hasText ? Math.round(band(textCoverage,
      [[0, 25], [0.02, 55], [0.06, 85], [0.10, 100], [0.28, 100], [0.40, 78], [0.55, 55], [0.75, 35]])) : 30;
    scores.brightness = Math.round(band(meanLum,
      [[0, 25], [0.05, 45], [0.10, 62], [0.18, 82], [0.28, 94], [0.45, 100], [0.60, 97], [0.72, 85], [0.82, 65], [0.90, 48], [1, 30]]));
    scores.saturation = Math.round(band(meanSat,
      [[0, 25], [0.08, 45], [0.16, 68], [0.26, 90], [0.38, 100], [0.55, 96], [0.68, 78], [0.8, 58], [1, 40]]));
    let wsScore = band(whitespaceRatio,
      [[0, 30], [0.05, 52], [0.12, 78], [0.2, 95], [0.32, 100], [0.45, 95], [0.58, 84], [0.7, 68], [0.85, 45], [1, 25]]);
    // 杂乱修正：大片高边缘密度区域（且不在文字块内）说明画面挤，留白分封顶；
    // 「忙碌格」过半也扣分——平底色被杂物切碎时，安静格占比会失真；
    // 文字块覆盖过半个画面时，元素必然铺满全场，同样按拥挤封顶。
    if (clutterArea > 0.25) wsScore = Math.min(wsScore, 45);
    else if (clutterArea > 0.12) wsScore = Math.min(wsScore, 55);
    if (textCoverage > 0.5) wsScore = Math.min(wsScore, 50);
    // 细节格（边缘密度 ≥5%）占比过高 = 元素铺满全场，按拥挤封顶——
    // 平底色被杂物切碎时只看安静格占比会失真，这条是硬修正。
    if (busyRatio >= 0.50) wsScore = Math.min(wsScore, 45);
    else if (busyRatio >= 0.40) wsScore = Math.min(wsScore, 55);
    else if (busyRatio >= 0.35) wsScore = Math.min(wsScore, 65);
    if (busyRatio > 0.45) wsScore -= (busyRatio - 0.45) * 50;
    if (edgeDensity > 0.30) wsScore -= 8;
    scores.whitespace = Math.round(Math.max(5, wsScore));

    const total = Math.round(
      scores.contrast * 0.25 + scores.minFont * 0.20 + scores.coverage * 0.15 +
      scores.whitespace * 0.15 + scores.saturation * 0.13 + scores.brightness * 0.12
    );
    const grade = total >= 85 ? '优秀' : total >= 70 ? '良好' : total >= 55 ? '勉强及格' : '建议重做';

    // ---------- 标注问题（区域类在前，文字块类按面积降序，同类限量） ----------
    const issues = [];
    for (const r of clutterRegions) {
      issues.push({ type: 'clutter', box: r, text: '这片区域细节密度很高、又没有文字信息，容易抢走视线。考虑虚化、压暗或裁掉。' });
    }
    for (const r of emptyRegions) {
      issues.push({ type: 'empty', box: r, text: '大面积空白：主体太小、画面撑不起来。放大主体或把标题移过来占住这块。' });
    }
    const blockIssues = [];
    for (const b of blocks) {
      if (b.ratio !== undefined && b.ratio < 3) {
        blockIssues.push({ type: 'low-contrast', box: b, area: b.fgArea, text: `这块文字与背景亮度比只有 ${b.ratio.toFixed(1)}:1，缩到手机上基本糊成一片。加深底色或给文字加描边/阴影。` });
      } else if (b.hasValidLine && b.minLineH / H * 100 < 3.5) {
        blockIssues.push({ type: 'small-text', box: b, area: b.fgArea, text: `这块最小的字高只占画面高度 ${(b.minLineH / H * 100).toFixed(1)}%，信息流里滑过去根本看不清。放大字号或删掉这行。` });
      }
    }
    blockIssues.sort((a, b) => b.area - a.area);
    let lcCount = 0;
    for (const bi of blockIssues) {
      if (bi.type === 'low-contrast' && ++lcCount > 3) continue;
      issues.push(bi);
    }

    // ---------- 逐项结论 ----------
    function statusOf(s) { return s >= 75 ? 'good' : s >= 50 ? 'warn' : 'bad'; }
    const metrics = [
      {
        key: 'contrast', label: '文字对比度', score: scores.contrast, status: statusOf(scores.contrast),
        value: hasText ? `文字与背景亮度比 ${contrastRatio.toFixed(1)} : 1` : `未检出文字，主色间亮度比 ${contrastRatio.toFixed(1)} : 1`,
        advice: !hasText ? '没有检测到成块的文字。如果封面本来就该有标题，可能是字太碎或与背景融在一起了。'
          : scores.contrast >= 75 ? '对比扎实，缩略图状态下文字也能跳出来。'
          : scores.contrast >= 50 ? '对比中等。把背景再压暗一档，或给文字加一圈描边，会明显更醒目。'
          : '对比太弱是点击率杀手：文字和背景亮度太接近。换深底白字/浅底黑字，或加半透明色块垫底。',
        method: '文字块内字符像素平均色 vs 外圈背景平均色，按 WCAG 相对亮度公式算比值；≥4.5:1 为佳。'
      },
      {
        key: 'minFont', label: '最小字号', score: scores.minFont, status: statusOf(scores.minFont),
        value: hasText ? `最小字高约占画面高度 ${minFontPct.toFixed(1)}%（约合 1080 高封面上的 ${Math.round(minFontPct * 10.8)} px）` : '未检出文字',
        advice: !hasText ? '没有可测的字号。纯图封面在信息流里很难传达主题，建议至少加一行主标题。'
          : scores.minFont >= 75 ? '最小的字也够大，手机上能读。'
          : scores.minFont >= 50 ? '最小字偏小。副标题/角标在手机信息流里会先被牺牲，重要的信息别用这个字号写。'
          : '最小字太小了：占画面高度不到 3.5%，等于写给自己看的。要么放大，要么直接删掉。',
        method: '按文字行带量字号：一行里所有笔画分量的纵向跨度≈该行字号，取各行最小值换算成占画面高度的百分比；经验线 ≥5%。'
      },
      {
        key: 'coverage', label: '文字占比', score: scores.coverage, status: statusOf(scores.coverage),
        value: hasText ? `文字区域约占画面 ${(textCoverage * 100).toFixed(0)}%` : '未检出文字区域',
        advice: !hasText ? '画面里没有文字区域。'
          : scores.coverage >= 75 ? '文字量适中，既传达主题又不挤。'
          : textCoverage < 0.06 ? '文字太少、太弱。封面在信息流里只有不到 1 秒，先靠标题说清「这是什么」。'
          : '文字铺得太满，画面没有喘气的地方。砍掉次要信息，只留一行主标题 + 一个视觉主体。',
        method: '所有文字块外接框面积之和 ÷ 画面面积；经验区间 10%–28%。'
      },
      {
        key: 'brightness', label: '画面明暗', score: scores.brightness, status: statusOf(scores.brightness),
        value: `平均相对亮度 ${meanLum.toFixed(2)}（0–1）`,
        advice: scores.brightness >= 75 ? '明暗在舒服的区间，不抢眼也不沉。'
          : meanLum < 0.24 ? '整体偏暗。信息流里暗图天然吃亏，整体提亮一档或给主体打光。'
          : '整体偏亮发飘。压一点曝光、加深局部，画面会更「稳」。',
        method: '全图逐像素相对亮度（sRGB 线性化）的均值；经验区间 0.24–0.68。'
      },
      {
        key: 'saturation', label: '色彩饱和', score: scores.saturation, status: statusOf(scores.saturation),
        value: `平均饱和度 ${meanSat.toFixed(2)}（HSV 口径，0–1）`,
        advice: scores.saturation >= 75 ? '色彩浓度合适。'
          : meanSat < 0.26 ? '颜色偏灰、偏淡，缩略图里容易「隐形」。适当加饱和或换一个更跳的主色。'
          : '饱和拉得太满，容易显得廉价和刺眼。降一点饱和、留一个主色就行。',
        method: '逐像素 HSV 饱和度取均值；经验区间 0.26–0.55。'
      },
      {
        key: 'whitespace', label: '留白与杂乱', score: scores.whitespace, status: statusOf(scores.whitespace),
        value: `安静区域约占 ${(whitespaceRatio * 100).toFixed(0)}%，全图边缘密度 ${(edgeDensity * 100).toFixed(0)}%`,
        advice: scores.whitespace >= 75 ? '留白比例健康，主体有呼吸感。'
          : whitespaceRatio > 0.58 ? '空白太多，主体撑不起画面。放大主体或让标题承担更多面积。'
          : '画面太挤，几乎没有安静区域。删元素、虚化背景，先让主体跳出来。',
        method: '16px 网格逐格测边缘密度与灰度方差，两者都极低记为安静格（经验区间 20%–45%）；细节格占比 ≥40% 或文字块覆盖过半时按拥挤封顶，因为平底被杂物切碎时安静格占比会失真。'
      }
    ];

    return {
      total, grade, scores, metrics, issues: issues.slice(0, 6),
      blocks: blocks.map(b => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, ratio: b.ratio, fgL: b.fgL, bgL: b.bgL, fgArea: b.fgArea, chars: b.chars })),
      stats: {
        width: W, height: H, hasText, charCount: chars.length,
        textCoverage, minFontPct, contrastRatio, minBlockRatio,
        meanLum, meanSat, whitespaceRatio, edgeDensity, clutterArea, busyRatio, totalComponents
      }
    };
  }

  const api = { analyze, relLum, band };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.CoverCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
