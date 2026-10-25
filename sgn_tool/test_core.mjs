// test_core.mjs — SGN 工具核心断言 (node, 零依赖)
// 提取 index.html 的 sgn-core 段为唯一真理源; 全过 = 核心 OK。
// 用法: node test_core.mjs
import { readFileSync } from 'fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const m = html.match(/sgn-core-start -->\s*<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('!! 未找到 sgn-core 段'); process.exit(1); }
const mod = { exports: {} };
new Function('module', 'exports', m[1])(mod, mod.exports);
const { SS, quantizeRect, buildSgn, parseSgn, renderSgn, writeSav, removeSgn, isKey, whiteKey } = mod.exports;

let pass = 0, fail = 0;
function T(name, cond, info = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  !!! ${name} ${info}`); }
}
const mk = (w, h, fn) => { const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(d, (y * w + x) * 4, x, y);
  return d; };
const psnr = (a, b) => { let s = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) { if (a[i + 3] === 0) continue;
    s += (a[i]-b[i])**2 + (a[i+1]-b[i+1])**2 + (a[i+2]-b[i+2])**2; n += 3; }
  return n ? 10 * Math.log10(65025 / (s / n)) : 99; };

console.log('== T1 常量自洽 ==');
T('LEN = TILES_OFF + 168×32', SS.LEN === SS.TILES_OFF + SS.TW * SS.TH * 32);
T('MAP_OFF = HDR + 5×32', SS.MAP_OFF === SS.HDR + SS.BANKS * 32);
T('槽位几何 112×96', SS.TW * 8 === 112 && SS.TH * 8 === 96);

console.log('== T2 纯色量化 ==');
{
  const src = mk(112, 96, (d, o) => { d[o] = 30; d[o+1] = 144; d[o+2] = 200; d[o+3] = 255; });
  const q = quantizeRect(src, null);
  const sgn = buildSgn(q), p = parseSgn(sgn);
  T('roundtrip valid', p.valid);
  const r = renderSgn(p);
  const ps = psnr(r, src);
  T(`PSNR ${ps.toFixed(1)} ≥ 35 (RGB15 5-bit 地板 ≈37)`, ps >= 35);
  T('tile 索引全部 ≤ 15', p.tilesData.every((b) => (b & 0xF) <= 15 && (b >> 4) <= 15));
}

console.log('== T3 双色 (绿底黑字实况) ==');
{
  const src = mk(112, 96, (d, o, x, y) => {
    const blk = (x > 8 && x < 100 && y > 20 && y < 70 && (x + y) % 7 !== 0);
    d[o] = blk ? 10 : 60; d[o+1] = blk ? 12 : 170; d[o+2] = blk ? 10 : 50; d[o+3] = 255; });
  const q = quantizeRect(src, whiteKey());
  const ps = psnr(renderSgn(parseSgn(buildSgn(q))), src);
  T(`PSNR ${ps.toFixed(1)} ≥ 35`, ps >= 35);
}

console.log('== T4 渐变 ==');
{
  const src = mk(112, 96, (d, o, x, y) => { d[o] = x * 2; d[o+1] = y * 2; d[o+2] = 128; d[o+3] = 255; });
  const ps = psnr(renderSgn(parseSgn(buildSgn(quantizeRect(src, null)))), src);
  T(`PSNR ${ps.toFixed(1)} ≥ 18`, ps >= 18);
}

console.log('== T5 背景色透明 (键色泛化) ==');
{
  const src = mk(112, 96, (d, o, x, y) => { const in_ = x > 40 && x < 70 && y > 40 && y < 60;
    d[o] = in_ ? 200 : 255; d[o+1] = in_ ? 30 : 255; d[o+2] = in_ ? 30 : 255; d[o+3] = 255; });
  const wk = whiteKey();
  const r = renderSgn(parseSgn(buildSgn(quantizeRect(src, wk))));
  let whiteTransparent = true;
  for (let i = 0; i < r.length; i += 4) {
    const x = (i / 4) % 112, y = (i / 4 / 112) | 0;
    if (!(x > 40 && x < 70 && y > 40 && y < 60) && r[i + 3] !== 0) whiteTransparent = false;
  }
  T('白键底全透明 (alpha=0)', whiteTransparent);
  T('isKey 判定 (白键 ±12)', isKey([255, 255, 255], wk) && !isKey([200, 30, 30], wk) && !isKey([235, 235, 250], wk));
  // 自定义绿键: 绿底透明, 键外白字保留
  const gk = { r: 60, g: 170, b: 50, tol: 12 };
  const src2 = mk(112, 96, (d, o, x, y) => { const in_ = x > 30 && x < 80;
    d[o] = in_ ? 255 : 60; d[o+1] = in_ ? 255 : 170; d[o+2] = in_ ? 255 : 50; d[o+3] = 255; });
  const r2 = renderSgn(parseSgn(buildSgn(quantizeRect(src2, gk))));
  let gTr = true, wKeep = true;
  for (let i = 0; i < r2.length; i += 4) {
    const x = (i / 4) % 112;
    if (x <= 30 || x >= 80) { if (r2[i + 3] !== 0) gTr = false; }
    else if (r2[i + 3] === 0) wKeep = false;
  }
  T('自定义绿键 → 绿底透明', gTr);
  T('键外白字保留不透明', wKeep);
  // 键关 (null): 纯白也不透明
  const r3 = renderSgn(parseSgn(buildSgn(quantizeRect(src, null))));
  T('null 键 = 全不透明', r3.every((v, i) => i % 4 !== 3 || v === 255));
}

console.log('== T6 map/pal 结构 ==');
{
  const src = mk(112, 96, (d, o, x, y) => { d[o] = (x * 7) % 256; d[o+1] = (y * 5) % 256; d[o+2] = 90; d[o+3] = 255; });
  const p = parseSgn(buildSgn(quantizeRect(src, null)));
  const dv = new DataView(p.map.buffer, p.map.byteOffset);
  let okIdx = true, okBank = true, multiBank = false;
  const banks = new Set();
  for (let li = 0; li < 168; li++) {
    const e = dv.getUint16(li * 2, true);
    const tidx = e & 0x3FF, bank = (e >> 12) & 0xF;
    if (tidx !== 145 + li) okIdx = false;
    if (bank < 9 || bank > 13) okBank = false;
    banks.add(bank);
  }
  T('tile 序号 = 145+li', okIdx);
  T('bank ∈ 9..13', okBank);
  T(`多板利用 (${banks.size} 板)`, banks.size >= 2);
  const dvP = new DataView(p.pal.buffer, p.pal.byteOffset);
  const v15 = dvP.getUint16(30, true);
  T('板内索引15 = 数字保留色', v15 === (((243 >> 3) | ((243 >> 3) << 5) | ((243 >> 3) << 10)) & 0x7FFF));
}

console.log('== T7 .sav 读写 ==');
{
  const sav8k = new Uint8Array(0x2000).fill(0xAB);
  sav8k.set([0x53, 0x72, 0x47, 0x41], 0x10);
  const src = mk(112, 96, (d, o) => { d[o] = 90; d[o+1] = 40; d[o+2] = 200; d[o+3] = 255; });
  const sgn = buildSgn(quantizeRect(src, null));
  const out = writeSav(sav8k, sgn);
  T('扩展到 64KB', out.length === 0x10000);
  T('游戏区零接触', out.slice(0, 0x2000).every((b, i) => b === sav8k[i]));
  T('签名 @0x8000', parseSgn(out, SS.OFF).valid);
  const rm = removeSgn(out);
  T('移除后失效', !parseSgn(rm, SS.OFF).valid);
  T('移除区 0xFF', rm.slice(0x8000, 0x8000 + SS.LEN).every((b) => b === 0xFF));
}

console.log('== T9 透明像素 + 框线保护区 ==');
{
  // alpha=0 像素 (白键关): 全透明 + 调色板不被透明色污染
  const src = mk(112, 96, (d, o, x, y) => {
    if (x >= 30 && x < 50) { d[o + 3] = 0; return; }
    d[o] = 200; d[o+1] = 40; d[o+2] = 40; d[o+3] = 255; });
  const q = quantizeRect(src, null);
  const r = renderSgn(parseSgn(buildSgn(q)));
  let holeOk = true;
  for (let y = 0; y < 96; y++) for (let x = 30; x < 50; x++)
    if (r[(y * 112 + x) * 4 + 3] !== 0) holeOk = false;
  T('alpha=0 像素全透明 (键关)', holeOk);
  // 全透明 tile 会自成一群占黑占位板 (不可见, 无害) — 可见像素正确性为准
  const ps = psnr(r, src);
  T(`可见像素 PSNR ${ps.toFixed(1)} ≥ 35 (透明不污染可见色)`, ps >= 35);
  T('内容区 111×95 (槽 112×96 减右列/底行)',
    SS.CONTENT_W === SS.TW * 8 - 1 && SS.CONTENT_H === SS.TH * 8 - 1);
}

console.log('== T10 平滑量化 (共基 + 抖动) ==');
{
  const src = mk(112, 96, (d, o, x, y) => {            // 对角渐变 (平滑过渡区, 换板缝高发)
    const g = (x + y) * 1.6;
    d[o] = g | 0; d[o+1] = 120 + (g / 3 | 0); d[o+2] = 240 - g; d[o+3] = 255; });
  const rd = renderSgn(parseSgn(buildSgn(quantizeRect(src, null, { dither: true }))));
  const qn = quantizeRect(src, null, { dither: false });
  const rn = renderSgn(parseSgn(buildSgn(qn)));
  T('抖动渲染无异常 (168 tile 全程)', rd.length === 112 * 96 * 4);
  T(`抖动 PSNR ${psnr(rd, src).toFixed(1)} ≥ 15`, psnr(rd, src) >= 15);
  T(`非抖动 PSNR ${psnr(rn, src).toFixed(1)} ≥ 18`, psnr(rn, src) >= 18);
  // 共基: 被使用的板共享相同颜色 ≥ 4 (RGB15 域逐位一致 → 主色换板无缝)
  const p = parseSgn(buildSgn(qn));
  const dvP = new DataView(p.pal.buffer, p.pal.byteOffset);
  const dvM = new DataView(p.map.buffer, p.map.byteOffset);
  const used = new Set();
  for (let li = 0; li < 168; li++) used.add((dvM.getUint16(li * 2, true) >> 12) & 0xF);
  const sets = [];
  for (let k = 0; k < SS.BANKS; k++) {
    const s = new Set();
    for (let i = 1; i <= 14; i++) s.add(dvP.getUint16(k * 32 + i * 2, true));
    if (used.has(SS.BANK_OFF + k)) sets.push(s);
  }
  let shared = 0;
  if (sets.length >= 2) for (const v of sets[0]) if (sets.every((s) => s.has(v))) shared++;
  T(`共基色 ${shared} ≥ 4 (跨 ${sets.length} 板)`, shared >= 4);
  // 抖动开关确有差异 (非同一路径)
  T('抖动开/关输出不同', Buffer.compare(Buffer.from(rd), Buffer.from(rn)) !== 0);
  const r05 = renderSgn(parseSgn(buildSgn(quantizeRect(src, null, { dither: true, dstr: 0.5 }))));
  const r00 = renderSgn(parseSgn(buildSgn(quantizeRect(src, null, { dither: true, dstr: 0 }))));
  T('强度 50% ≠ 100%', Buffer.compare(Buffer.from(rd), Buffer.from(r05)) !== 0);
  T('强度 0% ≡ 抖动关 (部分误差扩散边界)', Buffer.compare(Buffer.from(r00), Buffer.from(rn)) === 0);
}

console.log('== T11 精确色回写 (截图回灌无损) ==');
{
  // 30 唯一色全在 5bit 网格, 每 tile ≤2 色 (游戏截图理想形态)
  const cols = [];
  for (let i = 0; i < 30; i++) cols.push([((i * 5 + 3) % 32) * 8, ((i * 11 + 7) % 32) * 8, ((i * 17 + 13) % 32) * 8]);
  const src = mk(112, 96, (d, o, x, y) => {
    const t = (y >> 3) * 14 + (x >> 3);
    const c = cols[(t * 2 + ((x & 4) ? 1 : 0)) % 30];
    d[o] = c[0]; d[o+1] = c[1]; d[o+2] = c[2]; d[o+3] = 255;
  });
  const r = renderSgn(parseSgn(buildSgn(quantizeRect(src, null))));
  let exactPix = true;
  for (let i = 0; i < r.length; i += 4) {
    if (r[i+3] === 0 || r[i] !== src[i] || r[i+1] !== src[i+1] || r[i+2] !== src[i+2]) { exactPix = false; break; }
  }
  T('网格色源 → 逐像素无损回写 (精确色路径)', exactPix);
  // 非网格色 (截图滤波形态, 单调 +0..3 偏移): 四舍五入吸附恢复原 5bit 值
  const src2 = mk(112, 96, (d, o) => { d[o] = 243; d[o+1] = 235; d[o+2] = 219; d[o+3] = 255; });
  const r2 = renderSgn(parseSgn(buildSgn(quantizeRect(src2, null))));
  T('非网格色吸附 ≤4/通道 (243,235,219 → 240,232,216)',
    Math.abs(r2[0] - 243) <= 4 && Math.abs(r2[1] - 235) <= 4 && Math.abs(r2[2] - 219) <= 4);
  // 确定性无解形态: 5 个 mega-tile 各含 14 色恰满 5 板 + 1 tile 混两板色 → 必无解
  // (DFS 穷尽/SA 兜底不崩, 产物仍合法)
  const col = (v) => [v * 3 % 256, (v * 5 + 30) % 256, (v * 7 + 60) % 256];
  const src3 = mk(112, 96, (d, o, x, y) => {
    const t = (y >> 3) * 14 + (x >> 3);
    let v;
    if (t < 5) v = t * 14 + ((x + y) % 14);           // mega-tile: 14 色恰满一板
    else if (t === 167) v = (x & 4) ? 0 : 14;         // 混色 tile (g0 色 + g1 色)
    else v = t % 70;
    const c = col(v);
    d[o] = c[0]; d[o+1] = c[1]; d[o+2] = c[2]; d[o+3] = 255;
  });
  const q3 = quantizeRect(src3, null);
  T('无解形态 cover=false (兜底路径)', q3.cover === false);
  const p3 = parseSgn(buildSgn(q3));
  T('兜底产物合法 (tile 索引 ≤15)', p3.valid && p3.tilesData.every((b) => (b & 0xF) <= 15 && (b >> 4) <= 15));
}

console.log('== T8 跨端格式对拍 (Python write_sgn 产物) ==');
{
  try {
    let sav = null;
    for (const p of ['G:/new_work_env/temp/game_zh_sgn_test.sav',
                     '../new_work_env/temp/game_zh_sgn_test.sav',
                     '../temp/game_zh_sgn_test.sav'])
      try { sav = readFileSync(p); break; } catch {}
    if (!sav) throw new Error('fixture sav 未找到');
    const p = parseSgn(new Uint8Array(sav.buffer, sav.byteOffset, sav.length), SS.OFF);
    T('Python SGN2 被 JS 解析器认出', p.valid);
    const r = renderSgn(p);
    T('渲染无异常 (168 tile 全程)', r.length === 112 * 96 * 4);
    const dv = new DataView(p.map.buffer, p.map.byteOffset);
    let ok = true;
    for (let li = 0; li < 168; li++) {
      const e = dv.getUint16(li * 2, true);
      if ((e & 0x3FF) !== 145 + li || ((e >> 12) & 0xF) < 9) ok = false;
    }
    T('Python map 段结构同构', ok);
  } catch (e) {
    console.log(`  (跳过: ${e.message.slice(0, 60)})`);
  }
}

console.log(fail ? `\n==== FAIL (${fail} 项) ====` : `\n==== PASS (${pass} 项) ====`);
process.exit(fail ? 1 : 0);
