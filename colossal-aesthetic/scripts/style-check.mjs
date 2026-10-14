#!/usr/bin/env node
/**
 * 巨物美学 · 风格锁校验器
 *
 * 把出图结果与《风格锁核心》第 2 节的可测量阈值逐条比对，输出偏差与建议。
 *
 * 用法:
 *   node style-check.mjs <图片...>                     # 校验一张或多张
 *   node style-check.mjs <图片> --ref <参考图目录>      # 额外与参考图比对色彩指纹
 *   node style-check.mjs <图片> --json                 # 机器可读输出
 *
 * 支持 PNG（全质量解码）与 JPEG（仅解 DC 系数，得到 1/8 缩略图，色彩统计足够）。
 * 不依赖任何第三方库。
 *
 * JPEG 近似路径的实测偏差（同一帧对比 PNG 全质量路径）：
 *   明度中位 ±0.9、饱和度中位 ±1.2、有色像素占比 ±1.1 —— 可忽略；
 *   **高饱和占比会被低估**（实测 0.1% vs 全质量 2.0%），因为 8×8 块平均会抹掉细小的饱和细节。
 *   因此需要精确判定高饱和项时，请先把 JPEG 转为 PNG 再测。
 * 不支持渐进式 JPEG（Progressive），遇到会明确报错。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ═══════════════ PNG 解码（8 位非隔行） ═══════════════ */
function decodePNG(buf) {
  let p = 8, w = 0, h = 0, ct = 0, bd = 8; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8) throw new Error('仅支持 8 位 PNG（该图为 ' + bd + ' 位）');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  if (!ch) throw new Error('不支持的 PNG 颜色类型 ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, px = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      if (ft === 1) cur[i] = (cur[i] + a) & 255;
      else if (ft === 2) cur[i] = (cur[i] + b) & 255;
      else if (ft === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    cur.copy(px, y * stride); prev = cur;
  }
  return { w, h, ch, px };
}

/* ═══════════════ JPEG 解码（仅 DC 系数 → 1/8 缩略图） ═══════════════ */
function decodeJPEG_DC(buf) {
  let p = 2, w = 0, h = 0;
  const qt = {}, hts = {}; let comps = [], adobe = false, restartInterval = 0;
  const ZIG = [0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63];

  const buildHuff = (d) => { // d 指向 DHT 段中 Tc/Th 之后的 16 个计数
    const counts = [], symbols = [];
    for (let i = 0; i < 16; i++) counts.push(d[i]);
    let off = 16;
    for (let i = 0; i < 16; i++) for (let j = 0; j < counts[i]; j++) symbols.push(d[off++]);
    const codes = new Map(); let code = 0, k = 0;
    for (let l = 1; l <= 16; l++) { for (let i = 0; i < counts[l - 1]; i++) codes.set(l + ':' + code++, symbols[k++]); code <<= 1; }
    return codes;
  };

  while (p < buf.length) {
    if (buf[p] !== 0xFF) { p++; continue; }
    const m = buf[p + 1];
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { p += 2; continue; }
    const len = buf.readUInt16BE(p + 2);
    if (m === 0xDB) { // DQT
      let q = p + 4;
      while (q < p + 2 + len) {
        const pq = buf[q] >> 4, tq = buf[q] & 15; q++;
        const tbl = new Array(64);
        for (let i = 0; i < 64; i++) {
          if (pq) { tbl[ZIG[i]] = buf.readUInt16BE(q); q += 2; } else { tbl[ZIG[i]] = buf[q++]; }
        }
        qt[tq] = tbl;
      }
    } else if (m === 0xC4) { // DHT
      let q = p + 4;
      while (q < p + 2 + len) {
        const tc = buf[q] >> 4, th = buf[q] & 15; q++;
        const counts = []; let total = 0;
        for (let i = 0; i < 16; i++) { counts.push(buf[q + i]); total += buf[q + i]; }
        const seg = buf.subarray(q, q + 16 + total);
        hts[(tc ? 'AC' : 'DC') + th] = buildHuff(seg);
        q += 16 + total;
      }
    } else if (m === 0xDD) { restartInterval = buf.readUInt16BE(p + 4); }
    else if (m === 0xC0 || m === 0xC1 || m === 0xC2) { // SOF0/1/2
      if (m === 0xC2) throw new Error('不支持渐进式 JPEG（Progressive），请转为基线 JPEG 或 PNG');
      h = buf.readUInt16BE(p + 5); w = buf.readUInt16BE(p + 7);
      const n = buf[p + 9];
      for (let i = 0; i < n; i++) {
        const o = p + 10 + i * 3;
        comps.push({ id: buf[o], hs: buf[o + 1] >> 4, vs: buf[o + 1] & 15, tq: buf[o + 2], dc: 0, pred: 0 });
      }
    } else if (m === 0xEE) { adobe = true; }
    else if (m === 0xDA) { // SOS → 开始熵解码
      const n = buf[p + 4];
      for (let i = 0; i < n; i++) {
        const o = p + 5 + i * 2, id = buf[o];
        const c = comps.find((x) => x.id === id);
        if (c) { c.dcT = buf[o + 1] >> 4; c.acT = buf[o + 1] & 15; }
      }
      // SOS 头 = FFDA(2) + 长度(2) + Ns(1) + Ns*2 个分量说明 + Ss/Se/AhAl(3)
      let d = p + 8 + n * 2;
      const hMax = Math.max(...comps.map((c) => c.hs)), vMax = Math.max(...comps.map((c) => c.vs));
      const mcuW = 8 * hMax, mcuH = 8 * vMax;
      const mx = Math.ceil(w / mcuW), my = Math.ceil(h / mcuH);
      // 每个分量有各自的平面尺寸（色度通常是亮度的 1/4，即 4:2:0）
      for (const c of comps) {
        c.pw = mx * c.hs; c.ph = my * c.vs;
        c.buf = new Float32Array(c.pw * c.ph).fill(128);
      }

      let bitBuf = 0, bitCnt = 0, mcu = 0;
      const nextBit = () => {
        if (bitCnt === 0) {
          if (d >= buf.length) return 0;
          let b = buf[d++];
          if (b === 0xFF) { const nb = buf[d]; if (nb === 0x00) d++; else return 0; }
          bitBuf = b; bitCnt = 8;
        }
        bitCnt--; return (bitBuf >> bitCnt) & 1;
      };
      const decodeHuff = (tbl) => {
        let code = 0;
        for (let l = 1; l <= 16; l++) {
          code = (code << 1) | nextBit();
          const v = tbl.get(l + ':' + code);
          if (v !== undefined) return v;
        }
        return 0;
      };
      const extend = (v, t) => (t === 0 ? 0 : v < (1 << (t - 1)) ? v - (1 << t) + 1 : v);

      for (let yi = 0; yi < my; yi++) {
        for (let xi = 0; xi < mx; xi++) {
          if (restartInterval && mcu > 0 && mcu % restartInterval === 0) {
            bitCnt = 0; for (const c of comps) c.pred = 0;
            while (d < buf.length - 1 && !(buf[d] === 0xFF && buf[d + 1] >= 0xD0 && buf[d + 1] <= 0xD7)) d++;
            d += 2;
          }
          mcu++;
          for (let ci = 0; ci < comps.length; ci++) {
            const c = comps[ci];
            for (let by = 0; by < c.vs; by++) {
              for (let bx = 0; bx < c.hs; bx++) {
                const t = decodeHuff(hts['DC' + c.dcT]);
                const diff = t === 0 ? 0 : extend((() => { let v = 0; for (let i = 0; i < t; i++) v = (v << 1) | nextBit(); return v; })(), t);
                c.pred += diff;
                // 只保留 DC：即该 8x8 块的平均值（反量化后 /8 + 128）
                const qv = qt[c.tq] ? qt[c.tq][0] : 1;
                const val = c.pred * qv / 8 + 128;
                c.buf[(yi * c.vs + by) * c.pw + (xi * c.hs + bx)] = val;
                // 跳过该块的 AC 系数
                for (let k = 1; k < 64;) {
                  const rs = decodeHuff(hts['AC' + c.acT]);
                  const run = rs >> 4, size = rs & 15;
                  if (size === 0) { if (run === 15) { k += 16; continue; } break; }
                  k += run + 1;
                  for (let i = 0; i < size; i++) nextBit();
                }
              }
            }
          }
        }
      }
      // YCbCr → RGB：输出分辨率取亮度平面的 DC 分辨率（即约 w/8 × h/8）
      const outW = comps[0].pw, outH = comps[0].ph;
      const npx = outW * outH;
      const outPx = Buffer.alloc(npx * 3);
      const sample = (c, x, y) => {
        const sx = Math.min(c.pw - 1, Math.floor(x * c.hs / comps[0].hs));
        const sy = Math.min(c.ph - 1, Math.floor(y * c.vs / comps[0].vs));
        return c.buf[sy * c.pw + sx];
      };
      const isRGB = comps.length === 3 && comps[0].id === 82; // Adobe RGB（分量 ID 'R','G','B'）
      for (let y = 0, i = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++, i++) {
          if (comps.length >= 3) {
            const Y = sample(comps[0], x, y);
            let r, g, b;
            if (isRGB) {
              r = Y; g = sample(comps[1], x, y); b = sample(comps[2], x, y);
            } else {
              const Cb = sample(comps[1], x, y) - 128, Cr = sample(comps[2], x, y) - 128;
              r = Y + 1.402 * Cr; g = Y - 0.344136 * Cb - 0.714136 * Cr; b = Y + 1.772 * Cb;
            }
            outPx[i * 3] = Math.max(0, Math.min(255, r));
            outPx[i * 3 + 1] = Math.max(0, Math.min(255, g));
            outPx[i * 3 + 2] = Math.max(0, Math.min(255, b));
          } else {
            const Y = sample(comps[0], x, y);
            outPx[i * 3] = outPx[i * 3 + 1] = outPx[i * 3 + 2] = Math.max(0, Math.min(255, Y));
          }
        }
      }
      return { w: outW, h: outH, ch: 3, px: outPx, dcOnly: true, adobeRGB: isRGB };
    }
    p += 2 + len;
  }
  throw new Error('未找到 JPEG 扫描数据');
}

/* ═══════════════ 色彩统计 ═══════════════ */
const rgb2hsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let s = 0, h = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
};
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function analyze(img) {
  const { ch, px } = img;
  const L = [], S = [], HUES = [];
  let black = 0, blown = 0, warm = 0, colored = 0, highSat = 0, cool = 0, n = 0;
  const hist = new Map();
  const step = Math.max(1, Math.floor((px.length / ch) / 200000)); // 控制在 ~20 万采样点
  for (let i = 0; i < px.length; i += ch * step) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const { h, s, l } = rgb2hsl(r, g, b);
    L.push(l); S.push(s); n++;
    if (l < 3) black++;
    if (l > 97) blown++;
    if (s > 70) highSat++;
    if (s > 10) {
      colored++; HUES.push(h);
      if (h < 60 || h > 330) warm++;
      else if (h >= 90 && h <= 250) cool++;
    }
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  const topPalette = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, c]) => {
    const r = ((k >> 8) & 15) * 17, g = ((k >> 4) & 15) * 17, b = (k & 15) * 17;
    return { hex: '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(), pct: +(c / n * 100).toFixed(1) };
  });
  return {
    尺寸: `${img.w}x${img.h}${img.dcOnly ? '（JPEG 1/8 缩略）' : ''}`,
    明度L中位: +median(L).toFixed(1),
    饱和度S中位: +median(S).toFixed(1),
    有色像素色相中位: HUES.length ? +median(HUES).toFixed(0) : null,
    纯黑占比: +(black / n * 100).toFixed(1),
    高光溢出占比: +(blown / n * 100).toFixed(1),
    高饱和占比: +(highSat / n * 100).toFixed(1),
    暖色占比: +(warm / n * 100).toFixed(1),
    冷色占比: +(cool / n * 100).toFixed(1),
    有色像素占比: +(colored / n * 100).toFixed(1),
    主色板: topPalette,
  };
}

/* ═══════════════ 与风格锁阈值比对 ═══════════════
 * 阈值全部来自 20 张参考图的逐像素实测分布（见 data/风格实测数据.json），
 * 取实测极值再留余量，不是主观设定。 */
const RULES = [
  { 项: '明度L中位', 目标: '15–80', 下限: 15, 上限: 80, 键: '明度L中位', 说明: '实测参考图 18.6–75.7。低于 15=整体过暗失去通透；高于 80=发飘无层次' },
  { 项: '饱和度S中位', 目标: '12–48', 下限: 12, 上限: 48, 键: '饱和度S中位', 说明: '实测 14.5–44.5（中位 26.6）。超上限=艳俗廉价；低于下限=灰死无气韵' },
  { 项: '高饱和像素占比', 目标: '≤20%', 下限: 0, 上限: 20, 键: '高饱和占比', 说明: '实测中位仅 3.0%（最大 16.7%）。过多=纯度撞色，灰调高级感消失' },
  { 项: '纯黑占比', 目标: '＜3%', 下限: 0, 上限: 3, 键: '纯黑占比', 说明: '实测最大 2.5%。超限=暗部死黑，失去通透与水汽感' },
  { 项: '高光溢出占比', 目标: '＜3%', 下限: 0, 上限: 3, 键: '高光溢出占比', 说明: '实测最大 2.1%。超限=亮部过曝，画面发飘' },
  { 项: '有色像素占比', 目标: '≥65%', 下限: 65, 上限: 100, 键: '有色像素占比', 说明: '实测 73.5–99.4%。过低=接近单色，失去色彩结构' },
  { 项: '冷暖共存（暖侧）', 目标: '0.3%–75%', 下限: 0.3, 上限: 75, 键: '暖色占比', 说明: '实测 0.5–59.3%（中位 16.4）。暖色占比过高=冷调基底丢失；过低=只剩单色温，冷暖结构瓦解' },
  { 项: '冷暖共存（冷侧）', 目标: '≥3%', 下限: 3, 上限: 100, 键: '冷色占比', 说明: '冷侧实测下限约 3%。冷色缺席=冷中蕴暖的关系不存在' },
];

function judge(stats) {
  const rows = [];
  let pass = 0;
  for (const r of RULES) {
    const v = stats[r.键];
    if (v === null || v === undefined) { rows.push({ ...r, 实测: '—', 结论: '无法判定' }); continue; }
    const ok = v >= r.下限 && v <= r.上限;
    if (ok) pass++;
    rows.push({ ...r, 实测: v, 结论: ok ? '通过' : (v < r.下限 ? '偏低' : '偏高') });
  }
  return { rows, pass, total: RULES.length };
}

/* ═══════════════ 主流程 ═══════════════ */
const argv = process.argv.slice(2);
const files = [], refDirs = [];
let jsonOut = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--json') jsonOut = true;
  else if (argv[i] === '--ref') refDirs.push(argv[++i]);
  else files.push(argv[i]);
}
if (!files.length) { console.log('用法: node style-check.mjs <图片...> [--ref <参考图目录>] [--json]'); process.exit(1); }

const results = [];
for (const f of files) {
  try {
    const buf = fs.readFileSync(f);
    const lower = f.toLowerCase();
    const img = lower.endsWith('.png') ? decodePNG(buf) : decodeJPEG_DC(buf);
    const stats = analyze(img);
    const verdict = judge(stats);

    // 可选：与参考图比对
    let refCmp = null;
    if (refDirs.length) {
      const refStats = [];
      for (const d of refDirs) {
        if (!fs.existsSync(d)) continue;
        for (const rf of fs.readdirSync(d).filter((x) => /\.(png|jpe?g)$/i.test(x) && !/thumbs/i.test(x)).slice(0, 40)) {
          try {
            const rb = fs.readFileSync(path.join(d, rf));
            const ri = /\.png$/i.test(rf) ? decodePNG(rb) : decodeJPEG_DC(rb);
            refStats.push(analyze(ri));
          } catch { /* 跳过无法解码的 */ }
        }
      }
      if (refStats.length) {
        const avg = (k) => +(refStats.reduce((a, b) => a + (b[k] || 0), 0) / refStats.length).toFixed(1);
        refCmp = {
          参考图数量: refStats.length,
          参考_明度L中位: avg('明度L中位'),
          参考_饱和度S中位: avg('饱和度S中位'),
          参考_有色像素色相中位: avg('有色像素色相中位'),
        };
        refCmp.明度差 = +(stats.明度L中位 - refCmp.参考_明度L中位).toFixed(1);
        refCmp.饱和度差 = +(stats.饱和度S中位 - refCmp.参考_饱和度S中位).toFixed(1);
        refCmp.色相差 = +((stats.有色像素色相中位 || 0) - refCmp.参考_有色像素色相中位).toFixed(1);
      }
    }
    results.push({ 文件: f, 统计: stats, 判定: verdict, 参考比对: refCmp });
  } catch (e) {
    results.push({ 文件: f, 错误: e.message });
  }
}

if (jsonOut) { console.log(JSON.stringify(results, null, 1)); }
else {
  for (const r of results) {
    console.log('\n════════ ' + path.basename(r.文件) + ' ════════');
    if (r.错误) { console.log('  ✗ 无法处理: ' + r.错误); continue; }
    const s = r.统计;
    console.log(`  尺寸 ${s.尺寸}   明度L中位 ${s.明度L中位}   饱和S中位 ${s.饱和度S中位}   色相中位 ${s.有色像素色相中位}°`);
    console.log(`  纯黑 ${s.纯黑占比}%   过曝 ${s.高光溢出占比}%   高饱和 ${s.高饱和占比}%   暖 ${s.暖色占比}% / 冷 ${s.冷色占比}%   有色像素 ${s.有色像素占比}%`);
    console.log(`  主色板 ${s.主色板.slice(0, 5).map((c) => c.hex + '(' + c.pct + '%)').join(' ')}`);
    console.log(`  ── 风格锁比对 ${r.判定.pass}/${r.判定.total} 通过 ──`);
    for (const row of r.判定.rows) {
      const mark = row.结论.startsWith('通过') ? '✓' : (row.结论 === '无法判定' ? '?' : '✗');
      console.log(`   ${mark} ${row.项}: 实测 ${row.实测}  目标 ${row.目标}  ${row.结论.startsWith('通过') ? '' : '→ ' + row.说明}`);
    }
    if (r.参考比对) {
      const c = r.参考比对;
      console.log(`  ── 与 ${c.参考图数量} 张参考图比对 ──`);
      console.log(`   参考: L=${c.参考_明度L中位} S=${c.参考_饱和度S中位} 色相=${c.参考_有色像素色相中位}°`);
      console.log(`   偏差: 明度${c.明度差 > 0 ? '+' : ''}${c.明度差}  饱和${c.饱和度差 > 0 ? '+' : ''}${c.饱和度差}  色相${c.色相差 > 0 ? '+' : ''}${c.色相差}°`);
    }
    const overall = r.判定.pass >= r.判定.total - 1 ? '风格锁基本锁住' : r.判定.pass >= r.判定.total - 3 ? '部分锁住，需按未通过项微调' : '偏离明显，建议按 06 文档逐项修正';
    console.log(`  → 结论: ${overall}`);
  }
}
