/**
 * 用抓下来的那些屏，拼出「界面模拟器」这一个网页。
 *
 *   node scripts/ui-screens.mjs http://localhost:8815 design/screens.json
 *   node scripts/build-simulator.mjs
 *
 * 它是一个工具，不是设计稿：左边挑屏，中间是真页面，点任何一处就选中它，
 * 右边调颜色、大小、位置、文字，改动立刻生效。下面攒着一份改动清单，一键
 * 复制发回来，我照着改代码——所以在这里怎么试都不会碰到线上。
 *
 * 每一屏都装在自己的 iframe 里：应用的 CSS 那 2000 多行只在框里生效，碰不到
 * 工具自己的界面；框有多宽媒体查询就按多宽走，手机版和电脑版不用各写一套。
 */
import { readFile, writeFile } from 'node:fs/promises';

const data = JSON.parse(await readFile('design/screens.json', 'utf-8'));
/** JSON 塞进 <script> 里，字符串内部的 < 必须转义，否则 </script> 会提前收尾。 */
const embed = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const page = `<title>Slides 界面模拟器</title>
<style>
  :root {
    --bg: #14110F; --panel: #1E1A17; --line: #332C27; --ink: #EFE9E3;
    --ink-soft: #A79C93; --accent: #E25000; --accent-soft: #2A1D16;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 13px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    height: 100dvh; display: grid;
    grid-template-columns: 190px 1fr 264px;
    grid-template-rows: 1fr 168px;
    grid-template-areas: "rail stage props" "list list list";
  }
  @media (max-width: 900px) {
    body { grid-template-columns: 1fr; grid-template-rows: auto 1fr auto auto;
           grid-template-areas: "rail" "stage" "props" "list"; height: auto; }
  }
  h2 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
       color: var(--ink-soft); margin: 14px 12px 6px; font-weight: 600; }

  /* ---- 左：屏幕列表 ---- */
  #rail { grid-area: rail; border-right: 1px solid var(--line); overflow-y: auto; padding-bottom: 20px; }
  @media (max-width: 900px) {
    #rail { border-right: 0; border-bottom: 1px solid var(--line); display: flex;
            gap: 6px; overflow-x: auto; padding: 10px; }
    #rail h2 { display: none; }
  }
  .screen-btn {
    display: block; width: 100%; text-align: left; background: none; border: 0;
    color: var(--ink); padding: 7px 12px; cursor: pointer; font: inherit;
    border-left: 3px solid transparent; white-space: nowrap;
  }
  .screen-btn:hover { background: #241F1B; }
  .screen-btn[aria-current="true"] { background: var(--accent-soft); border-left-color: var(--accent); }
  .screen-btn .n { color: var(--ink-soft); font-size: 11px; margin-left: 6px;
                   font-variant-numeric: tabular-nums; }
  /* 改过几处，直接标在名字后面：哪几屏动过手，扫一眼就知道，不用翻清单。 */
  .screen-btn .badge {
    float: right; min-width: 18px; text-align: center; background: var(--accent);
    color: #fff; border-radius: 999px; font-size: 10px; line-height: 16px;
    padding: 0 5px; font-variant-numeric: tabular-nums;
  }
  .screen-btn:focus-visible, #stageBar button:focus-visible, #listHead button:focus-visible,
  .row input:focus-visible, .row select:focus-visible, .chg button:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px;
  }
  #stageBar button:hover, #listHead button:hover { filter: brightness(1.15); }
  .chg:hover { background: #201B18; }
  @media (max-width: 900px) {
    .screen-btn { width: auto; border-left: 0; border-radius: 999px; padding: 6px 12px;
                  border: 1px solid var(--line); }
    .screen-btn[aria-current="true"] { border-color: var(--accent); }
  }

  /* ---- 中：舞台 ---- */
  #stage { grid-area: stage; overflow: auto; display: flex; flex-direction: column;
           align-items: center; padding: 16px; gap: 10px; }
  #stageBar { display: flex; gap: 8px; align-items: center; color: var(--ink-soft); font-size: 12px; }
  #stageBar button { background: #241F1B; color: var(--ink); border: 1px solid var(--line);
                     border-radius: 6px; padding: 3px 9px; cursor: pointer; font: inherit; }
  #frameWrap { background: #fff; border-radius: 14px; overflow: hidden;
               box-shadow: 0 18px 50px rgba(0,0,0,.5); transform-origin: top center; }
  iframe { display: block; border: 0; }

  /* ---- 右：属性 ---- */
  #props { grid-area: props; border-left: 1px solid var(--line); overflow-y: auto; padding-bottom: 24px; }
  @media (max-width: 900px) { #props { border-left: 0; border-top: 1px solid var(--line); } }
  #sel { margin: 10px 12px; padding: 8px 10px; background: #241F1B; border-radius: 8px;
         font: 11px/1.45 ui-monospace, Menlo, monospace; color: #F0A882; word-break: break-all; }
  .row { display: grid; grid-template-columns: 62px 1fr; gap: 8px; align-items: center;
         margin: 6px 12px; }
  .row label { color: var(--ink-soft); font-size: 12px; }
  .row input[type=range] { width: 100%; accent-color: var(--accent); }
  .row input[type=text], .row input[type=number], .row select {
    width: 100%; background: #241F1B; color: var(--ink); border: 1px solid var(--line);
    border-radius: 6px; padding: 4px 7px; font: inherit;
  }
  .row .pair { display: flex; gap: 6px; align-items: center; }
  .row input[type=color] { width: 34px; height: 26px; padding: 0; border: 1px solid var(--line);
                           border-radius: 6px; background: none; cursor: pointer; }
  .num { display: flex; gap: 6px; align-items: center; }
  .num output { min-width: 44px; text-align: right; color: var(--ink-soft);
                font: 11px ui-monospace, "SF Mono", Menlo, monospace;
                font-variant-numeric: tabular-nums; }
  #props .hint { color: var(--ink-soft); margin: 10px 12px; font-size: 12px; }

  /* ---- 下：改动清单 ---- */
  #list { grid-area: list; border-top: 1px solid var(--line); overflow-y: auto; }
  #listHead { display: flex; align-items: center; gap: 8px; padding: 8px 12px;
              position: sticky; top: 0; background: var(--bg); border-bottom: 1px solid var(--line); }
  #listHead strong { font-size: 12px; font-weight: 600; }
  #listHead .grow { flex: 1; }
  #listHead .note { color: var(--ink-soft); font-size: 11.5px; }
  @media (max-width: 900px) { #listHead .note { display: none; } }
  #listHead button { background: var(--accent); color: #fff; border: 0; border-radius: 7px;
                     padding: 5px 12px; cursor: pointer; font: inherit; }
  #listHead button.ghost { background: none; color: var(--ink-soft); border: 1px solid var(--line); }
  .chg { display: flex; gap: 8px; align-items: baseline; padding: 5px 12px;
         font: 11.5px/1.5 ui-monospace, Menlo, monospace; border-bottom: 1px solid #221D1A; }
  .chg .s { color: #7FB3E8; }
  .chg .q { color: #F0A882; }
  .chg .p { color: var(--ink-soft); }
  .chg .v { color: #9BD48A; }
  .chg button { margin-left: auto; background: none; border: 0; color: var(--ink-soft);
                cursor: pointer; font: inherit; }
  #empty { color: var(--ink-soft); padding: 12px; font-size: 12px; }
</style>

<nav id="rail"></nav>

<main id="stage">
  <div id="stageBar">
    <span id="stageName"></span>
    <button id="zoomOut">−</button><span id="zoomVal">100%</span><button id="zoomIn">+</button>
    <button id="clearSel">取消选中</button>
  </div>
  <div id="frameWrap"><iframe id="frame" title="预览"></iframe></div>
</main>

<aside id="props">
  <h2>选中的东西</h2>
  <div id="sel">点一下页面里的任何一块</div>
  <div id="controls"></div>
</aside>

<section id="list">
  <div id="listHead">
    <strong>改动清单</strong><span id="count" class="p"></span>
    <span class="grow"></span>
    <span class="note">存在这台设备上，关掉再打开还在。调好之后复制发给我，我照着改代码。</span>
    <button class="ghost" id="clearAll">全部清空</button>
    <button id="copy">复制清单</button>
  </div>
  <div id="rows"><div id="empty">还没有改动。选中一块，然后在右边调。</div></div>
</section>

<script id="screens" type="application/json">__DATA__</script>
<script>
const DATA = JSON.parse(document.getElementById('screens').textContent);
const SCREENS = DATA.screens;
const APP_CSS = DATA.css;
const STORE = 'slides_sim_changes';

/** 改动：{ 屏id: { 选择器: { 属性: 值 } } }。工具的全部状态就这一份。 */
let changes = (() => {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
})();
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(changes)); } catch {} };

let current = SCREENS[0];
let selected = null;      // iframe 里选中的那个元素
let selector = '';        // 它的选择器
let zoom = 1;

// ---- 左边的列表 ----------------------------------------------------------
const rail = document.getElementById('rail');
const groups = [];
for (const s of SCREENS) {
  let g = groups.find((x) => x.name === s.group);
  if (!g) groups.push((g = { name: s.group, items: [] }));
  g.items.push(s);
}
for (const g of groups) {
  const h = document.createElement('h2');
  h.textContent = g.name;
  rail.append(h);
  for (const s of g.items) {
    const b = document.createElement('button');
    b.className = 'screen-btn';
    b.dataset.id = s.id;
    b.innerHTML = s.name + '<span class="n">' + s.w + '×' + s.h + '</span>';
    b.addEventListener('click', () => show(s));
    rail.append(b);
  }
}

// ---- 中间的舞台 ----------------------------------------------------------
const frame = document.getElementById('frame');
const wrap = document.getElementById('frameWrap');

/** 选中框和悬停框，画在 iframe 里，用极不可能撞名的类名。 */
const PICK_CSS = \`
  .simx-hover { outline: 2px dashed rgba(226,80,0,.75) !important; outline-offset: -2px !important; }
  .simx-pick  { outline: 2px solid #E25000 !important; outline-offset: -2px !important; }
\`;

function show(s) {
  current = s;
  selected = null;
  selector = '';
  document.getElementById('stageName').textContent = s.name;
  for (const b of rail.querySelectorAll('.screen-btn')) {
    b.setAttribute('aria-current', String(b.dataset.id === s.id));
  }
  frame.style.width = s.w + 'px';
  frame.style.height = s.h + 'px';
  wrap.style.width = s.w + 'px';
  wrap.style.height = s.h + 'px';
  frame.srcdoc =
    '<!doctype html><html><head><meta charset="utf-8"><style>' + APP_CSS + PICK_CSS +
    '</style></head><body>' + s.html + '</body></html>';
  frame.onload = () => { wireFrame(); applyAll(); };
  renderProps();
  fit();
}

/** 一个够稳的选择器：有 id 就用 id，否则标签 + 类名 + 第几个同类。 */
function pathOf(el, root) {
  const bits = [];
  let node = el;
  while (node && node !== root && node.nodeType === 1) {
    if (node.id) { bits.unshift('#' + node.id); break; }
    let bit = node.tagName.toLowerCase();
    const cls = [...node.classList].filter((c) => !c.startsWith('simx-'));
    if (cls.length) bit += '.' + cls.join('.');
    const sibs = [...(node.parentElement?.children || [])].filter(
      (n) => n.tagName === node.tagName &&
        [...n.classList].filter((c) => !c.startsWith('simx-')).join('.') === cls.join('.'),
    );
    if (sibs.length > 1) bit += ':nth-of-type(' + ([...node.parentElement.children].indexOf(node) + 1) + ')';
    bits.unshift(bit);
    node = node.parentElement;
  }
  return bits.join(' > ');
}

function wireFrame() {
  const doc = frame.contentDocument;
  if (!doc) return;
  let hovered = null;
  doc.addEventListener('mousemove', (e) => {
    const el = e.target;
    if (el === hovered) return;
    hovered?.classList.remove('simx-hover');
    hovered = el && el.nodeType === 1 ? el : null;
    if (hovered && hovered !== doc.body) hovered.classList.add('simx-hover');
  });
  doc.addEventListener('mouseleave', () => { hovered?.classList.remove('simx-hover'); hovered = null; });
  doc.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    pick(e.target);
  }, true);
  // 页面里的按钮不该真的被按下去——这是一张画，不是应用。
  for (const ev of ['submit', 'keydown']) doc.addEventListener(ev, (e) => e.preventDefault(), true);
}

function pick(el) {
  const doc = frame.contentDocument;
  if (!el || el.nodeType !== 1 || el === doc.body) return;
  doc.querySelectorAll('.simx-pick').forEach((n) => n.classList.remove('simx-pick'));
  el.classList.add('simx-pick');
  selected = el;
  selector = pathOf(el, doc.body);
  document.getElementById('sel').textContent = selector || '(整页)';
  renderProps();
}

document.getElementById('clearSel').addEventListener('click', () => {
  frame.contentDocument?.querySelectorAll('.simx-pick').forEach((n) => n.classList.remove('simx-pick'));
  selected = null; selector = '';
  document.getElementById('sel').textContent = '点一下页面里的任何一块';
  renderProps();
});

// ---- 缩放：手机上看电脑版那一屏时用得上 ----------------------------------
function fit() {
  const room = document.getElementById('stage').clientWidth - 32;
  const auto = Math.min(1, room / current.w);
  setZoom(zoom > 0 ? Math.min(zoom, auto) : auto);
}
function setZoom(z) {
  zoom = Math.max(0.2, Math.min(2, z));
  wrap.style.transform = 'scale(' + zoom + ')';
  wrap.style.marginBottom = (current.h * (zoom - 1)) + 'px';
  document.getElementById('zoomVal').textContent = Math.round(zoom * 100) + '%';
}
document.getElementById('zoomIn').addEventListener('click', () => setZoom(zoom + 0.1));
document.getElementById('zoomOut').addEventListener('click', () => setZoom(zoom - 0.1));
addEventListener('resize', fit);

// ---- 右边的属性面板 ------------------------------------------------------
/**
 * 每一条控件：属性名、显示名、类型。
 * 只放真的常调的那些——调色板里塞满 CSS 属性只会让人找不到要的那一个。
 */
const CONTROLS = [
  { p: 'background-color', label: '底色', type: 'color' },
  { p: 'color', label: '文字色', type: 'color' },
  { p: 'fill', label: '图形色', type: 'color', svgOnly: true },
  { p: 'font-size', label: '字号', type: 'px', min: 8, max: 96 },
  { p: 'font-weight', label: '字重', type: 'enum', options: ['', '400', '500', '600', '700', '800'] },
  { p: 'width', label: '宽', type: 'px', min: 0, max: 1200 },
  { p: 'height', label: '高', type: 'px', min: 0, max: 1200 },
  { p: 'padding', label: '内边距', type: 'px', min: 0, max: 80 },
  { p: 'gap', label: '间距', type: 'px', min: 0, max: 80 },
  { p: 'border-radius', label: '圆角', type: 'px', min: 0, max: 200 },
  { p: 'margin-top', label: '上下移', type: 'px', min: -200, max: 200 },
  { p: 'margin-left', label: '左右移', type: 'px', min: -200, max: 200 },
  { p: 'opacity', label: '透明度', type: 'ratio' },
];

const controlsEl = document.getElementById('controls');

function renderProps() {
  controlsEl.innerHTML = '';
  if (!selected) {
    controlsEl.innerHTML = '<p class="hint">选中之后，这里会出现底色、字号、宽高、圆角、位置这些。改动立刻能看到，并且会记在下面的清单里。</p>';
    return;
  }
  const cs = frame.contentWindow.getComputedStyle(selected);
  const isSvg = selected.ownerSVGElement !== undefined && selected.ownerSVGElement !== null
    || selected.tagName.toLowerCase() === 'svg';
  const mine = (changes[current.id] || {})[selector] || {};

  for (const c of CONTROLS) {
    if (c.svgOnly && !isSvg) continue;
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = c.label;
    row.append(lab);
    const now = mine[c.p] ?? cs.getPropertyValue(c.p);

    if (c.type === 'color') {
      const pair = document.createElement('div');
      pair.className = 'pair';
      const sw = document.createElement('input');
      sw.type = 'color';
      sw.value = toHex(now);
      const tx = document.createElement('input');
      tx.type = 'text';
      tx.value = mine[c.p] ?? toHex(now);
      sw.addEventListener('input', () => { tx.value = sw.value; set(c.p, sw.value); });
      tx.addEventListener('change', () => set(c.p, tx.value.trim()));
      pair.append(sw, tx);
      row.append(pair);
    } else if (c.type === 'px') {
      const num = document.createElement('div');
      num.className = 'num';
      const r = document.createElement('input');
      r.type = 'range'; r.min = c.min; r.max = c.max; r.step = 1;
      r.value = String(Math.round(parseFloat(now) || 0));
      const o = document.createElement('output');
      o.textContent = r.value + 'px';
      r.addEventListener('input', () => { o.textContent = r.value + 'px'; set(c.p, r.value + 'px'); });
      num.append(r, o);
      row.append(num);
    } else if (c.type === 'ratio') {
      const num = document.createElement('div');
      num.className = 'num';
      const r = document.createElement('input');
      r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.05;
      r.value = String(parseFloat(now) || 1);
      const o = document.createElement('output');
      o.textContent = r.value;
      r.addEventListener('input', () => { o.textContent = r.value; set(c.p, r.value); });
      num.append(r, o);
      row.append(num);
    } else {
      const sel = document.createElement('select');
      for (const opt of c.options) {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt || '（不改）';
        sel.append(o);
      }
      sel.value = mine[c.p] ?? '';
      sel.addEventListener('change', () => set(c.p, sel.value));
      row.append(sel);
    }
    controlsEl.append(row);
  }

  // 文字：只有当这一块里就是一段字的时候才给改
  const kids = [...selected.childNodes];
  if (kids.length && kids.every((n) => n.nodeType === 3)) {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = '文字';
    const tx = document.createElement('input');
    tx.type = 'text';
    tx.value = mine['__text'] ?? selected.textContent.trim();
    tx.addEventListener('change', () => set('__text', tx.value));
    row.append(lab, tx);
    controlsEl.append(row);
  }

  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = '显示';
  const sel = document.createElement('select');
  for (const [v, t] of [['', '正常'], ['none', '藏起来']]) {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    sel.append(o);
  }
  sel.value = mine['display'] === 'none' ? 'none' : '';
  sel.addEventListener('change', () => set('display', sel.value));
  row.append(lab, sel);
  controlsEl.append(row);
}

/** 颜色控件只吃 #rrggbb，computed 出来的是 rgb()。 */
function toHex(v) {
  const m = String(v).match(/rgba?\\(([^)]+)\\)/);
  if (!m) return /^#[0-9a-f]{6}$/i.test(String(v).trim()) ? String(v).trim() : '#000000';
  const [r, g, b] = m[1].split(',').map((n) => Math.round(parseFloat(n)));
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function set(prop, value) {
  if (!selector) return;
  changes[current.id] ??= {};
  changes[current.id][selector] ??= {};
  if (value === '' || value == null) delete changes[current.id][selector][prop];
  else changes[current.id][selector][prop] = value;
  if (!Object.keys(changes[current.id][selector]).length) delete changes[current.id][selector];
  if (!Object.keys(changes[current.id]).length) delete changes[current.id];
  save();
  applyAll();
  renderList();
}

/** 把这一屏的全部改动重新刷一遍。改一处刷全屏，是为了删掉一条时能真的还原。 */
function applyAll() {
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.querySelectorAll('[data-simx-styled]').forEach((el) => {
    el.removeAttribute('style');
    el.removeAttribute('data-simx-styled');
    if (el.dataset.simxText !== undefined) {
      el.textContent = el.dataset.simxText;
      delete el.dataset.simxText;
    }
  });
  for (const [sel, props] of Object.entries(changes[current.id] || {})) {
    let els;
    try { els = doc.querySelectorAll(sel); } catch { continue; }
    for (const el of els) {
      el.setAttribute('data-simx-styled', '');
      for (const [p, v] of Object.entries(props)) {
        if (p === '__text') {
          if (el.dataset.simxText === undefined) el.dataset.simxText = el.textContent;
          el.textContent = v;
        } else {
          el.style.setProperty(p, v, 'important');
        }
      }
    }
  }
}

// ---- 下边的清单 ----------------------------------------------------------
const rowsEl = document.getElementById('rows');

function renderList() {
  const lines = [];
  for (const [sid, bySel] of Object.entries(changes)) {
    const s = SCREENS.find((x) => x.id === sid);
    for (const [sel, props] of Object.entries(bySel)) {
      for (const [p, v] of Object.entries(props)) lines.push({ sid, name: s?.name || sid, sel, p, v });
    }
  }
  document.getElementById('count').textContent = lines.length ? '（' + lines.length + ' 条）' : '';
  // 每一屏改了几处，标在左栏那一行上。
  const per = {};
  for (const l of lines) per[l.sid] = (per[l.sid] || 0) + 1;
  for (const b of rail.querySelectorAll('.screen-btn')) {
    b.querySelector('.badge')?.remove();
    const n = per[b.dataset.id];
    if (!n) continue;
    const tag = document.createElement('span');
    tag.className = 'badge';
    tag.textContent = String(n);
    b.append(tag);
  }
  if (!lines.length) {
    rowsEl.innerHTML = '<div id="empty">还没有改动。选中一块，然后在右边调。</div>';
    return;
  }
  rowsEl.innerHTML = '';
  for (const l of lines) {
    const d = document.createElement('div');
    d.className = 'chg';
    d.innerHTML =
      '<span class="s">' + esc(l.name) + '</span>' +
      '<span class="q">' + esc(l.sel) + '</span>' +
      '<span class="p">' + esc(l.p === '__text' ? '文字' : l.p) + '</span>' +
      '<span class="v">' + esc(l.v) + '</span>';
    const del = document.createElement('button');
    del.textContent = '删除';
    del.addEventListener('click', () => {
      delete changes[l.sid][l.sel][l.p];
      if (!Object.keys(changes[l.sid][l.sel]).length) delete changes[l.sid][l.sel];
      if (!Object.keys(changes[l.sid]).length) delete changes[l.sid];
      save();
      if (l.sid === current.id) applyAll();
      renderList();
      renderProps();
    });
    d.append(del);
    rowsEl.append(d);
  }
}
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

document.getElementById('copy').addEventListener('click', async () => {
  const out = [];
  for (const [sid, bySel] of Object.entries(changes)) {
    const s = SCREENS.find((x) => x.id === sid);
    out.push('## ' + (s?.name || sid) + '  [' + sid + ']');
    for (const [sel, props] of Object.entries(bySel)) {
      for (const [p, v] of Object.entries(props)) {
        out.push('- ' + sel + '  →  ' + (p === '__text' ? '文字' : p) + ': ' + v);
      }
    }
  }
  const text = out.join('\\n') || '（没有改动）';
  const btn = document.getElementById('copy');
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = '复制好了';
  } catch {
    // 剪贴板被挡住时，退回到选中——总比什么都没有强。
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:10%;left:5%;width:90%;height:60%;z-index:9;font:12px monospace';
    document.body.append(ta);
    ta.select();
    btn.textContent = '手动复制';
    ta.addEventListener('blur', () => ta.remove());
  }
  setTimeout(() => { btn.textContent = '复制清单'; }, 1800);
});

document.getElementById('clearAll').addEventListener('click', () => {
  if (!confirm('清空全部改动？')) return;
  changes = {};
  save();
  applyAll();
  renderList();
  renderProps();
});

show(SCREENS[0]);
renderList();
</script>
`;

await writeFile('slides-simulator.html', page.replace('__DATA__', embed(data)), 'utf-8');
const bytes = Buffer.byteLength(page) + JSON.stringify(data).length;
console.log(`slides-simulator.html  约 ${(bytes / 1024 / 1024).toFixed(1)} MB  ·  ${data.screens.length} 屏`);
