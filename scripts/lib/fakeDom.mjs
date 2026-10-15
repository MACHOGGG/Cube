/**
 * 一份只够「把一局开到发完牌」的假 DOM（10-15 补充 S1，给 check-seed-golden 用）。
 *
 * 为什么不读屏、不开浏览器：发牌金标要钉的是「同一串码 → 同一副牌（含反面颜色）」，屏幕上开局全是正面，读不到
 * dotColor；而且一开浏览器就是十几分钟。为什么不装 jsdom：package.json 里没有它，搭别的包的便车在 CI 按 lockfile
 * 装的时候会掉（CLAUDE.md 开头那条）。所以自己写一份，**只实现发牌之前界面会碰到的那些接口**：
 *   · 元素树、innerHTML 的读写（一个小解析器）、querySelector 的常用写法（标签、#id、.类、[属性]、后代 / 子代、逗号）；
 *   · 事件（addEventListener / dispatchEvent / click）、classList、style、dataset、hidden；
 *   · window 上的那一圈：matchMedia、requestAnimationFrame、定时器、localStorage / sessionStorage、ResizeObserver……
 *
 * **定时器和动画帧都是假的、不自己走**：只有门调 `flushFrames()` / `runTimers()` 时才跑。发牌是同步的（控制器
 * newGame → plantSeed → resetBoard），用不着真的时间；真定时器反倒会让门在发完牌之后还被各种动画拖着不退出。
 *
 * 门红「② 六十局都发得出来」并附上一句「fakeDom 没有 X」的时候，是界面在发牌之前用上了这儿没有的接口——补这个
 * 文件，**不要动金标**。不认识的选择器当场抛错（不静默当成「找不到」：那样会让某一副棋盘悄悄少量一段）。
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|times|middot|hellip|mdash|ndash|rarr|larr|harr|minus|thinsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', times: '×', middot: '·', hellip: '…', mdash: '—', ndash: '–', rarr: '→', larr: '←', harr: '↔', minus: '−', thinsp: ' ' }[k];
  });
}
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

let doc = null;

class FakeEventTarget {
  constructor() {
    this._listeners = new Map();
  }
  addEventListener(type, fn, opts) {
    if (!fn) return;
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    const list = this._listeners.get(type);
    if (!list.some((l) => l.fn === fn)) list.push({ fn, once: !!(opts && typeof opts === 'object' && opts.once) });
  }
  removeEventListener(type, fn) {
    const list = this._listeners.get(type);
    if (!list) return;
    const i = list.findIndex((l) => l.fn === fn);
    if (i >= 0) list.splice(i, 1);
  }
  _fire(ev) {
    const list = this._listeners.get(ev.type);
    if (!list) return;
    for (const l of [...list]) {
      if (ev._stopNow) break;
      ev.currentTarget = this;
      if (l.once) this.removeEventListener(ev.type, l.fn);
      if (typeof l.fn === 'function') l.fn.call(this, ev);
      else if (l.fn && typeof l.fn.handleEvent === 'function') l.fn.handleEvent(ev);
    }
    const on = this['on' + ev.type];
    if (typeof on === 'function') on.call(this, ev);
  }
  dispatchEvent(ev) {
    ev.target = ev.target ?? this;
    const path = [];
    for (let n = this; n; n = n.parentNode) path.push(n);
    if (ev.bubbles && doc && path[path.length - 1] === doc) path.push(globalThis.window);
    this._fire(ev);
    if (ev.bubbles) for (const n of path.slice(1)) {
      if (ev._stop) break;
      n._fire?.(ev);
    }
    return !ev.defaultPrevented;
  }
}

export class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this.timeStamp = 0;
    Object.assign(this, init);
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this._stop = true;
  }
  stopImmediatePropagation() {
    this._stop = true;
    this._stopNow = true;
  }
}

class FakeNode extends FakeEventTarget {
  constructor(nodeType) {
    super();
    this.nodeType = nodeType;
    this.parentNode = null;
    this.childNodes = [];
  }
  get ownerDocument() {
    return doc;
  }
  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling() {
    const p = this.parentNode;
    return p ? p.childNodes[p.childNodes.indexOf(this) + 1] ?? null : null;
  }
  get previousSibling() {
    const p = this.parentNode;
    return p ? p.childNodes[p.childNodes.indexOf(this) - 1] ?? null : null;
  }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === doc;
  }
  _adopt(child) {
    if (child.nodeType === 11) return [...child.childNodes].map((c) => this._adopt(c)).flat();
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    return [child];
  }
  appendChild(child) {
    for (const c of this._adopt(child)) this.childNodes.push(c);
    return child;
  }
  insertBefore(child, ref) {
    if (!ref) return this.appendChild(child);
    const adopted = this._adopt(child);
    const i = this.childNodes.indexOf(ref);
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, ...adopted);
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  replaceChild(next, old) {
    this.insertBefore(next, old);
    return this.removeChild(old);
  }
  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  get textContent() {
    if (this.nodeType === 3 || this.nodeType === 8) return this.data;
    return this.childNodes.map((c) => (c.nodeType === 8 ? '' : c.textContent)).join('');
  }
  set textContent(v) {
    if (this.nodeType === 3 || this.nodeType === 8) {
      this.data = String(v);
      return;
    }
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v !== '' && v != null) this.appendChild(new FakeText(String(v)));
  }
  get nodeValue() {
    return this.nodeType === 3 ? this.data : null;
  }
  cloneNode(deep) {
    if (this.nodeType === 3) return new FakeText(this.data);
    if (this.nodeType === 8) return new FakeComment(this.data);
    const el = new FakeElement(this.localName, this.namespaceURI);
    for (const [k, v] of this._attrs) el._attrs.set(k, v);
    if (deep) for (const c of this.childNodes) el.appendChild(c.cloneNode(true));
    return el;
  }
}

class FakeText extends FakeNode {
  constructor(data) {
    super(3);
    this.data = data;
  }
  get nodeName() {
    return '#text';
  }
}
class FakeComment extends FakeNode {
  constructor(data) {
    super(8);
    this.data = data;
  }
}
class FakeFragment extends FakeNode {
  constructor() {
    super(11);
  }
  get children() {
    return this.childNodes.filter((c) => c.nodeType === 1);
  }
  querySelector(sel) {
    return querySelectorAllIn(this, sel)[0] ?? null;
  }
  querySelectorAll(sel) {
    return querySelectorAllIn(this, sel);
  }
  append(...nodes) {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? new FakeText(n) : n);
  }
}

class ClassList {
  constructor(el) {
    this.el = el;
  }
  _get() {
    return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  }
  _set(list) {
    this.el.setAttribute('class', list.join(' '));
  }
  get length() {
    return this._get().length;
  }
  get value() {
    return this.el.getAttribute('class') || '';
  }
  item(i) {
    return this._get()[i] ?? null;
  }
  contains(c) {
    return this._get().includes(c);
  }
  add(...cs) {
    const l = this._get();
    for (const c of cs) if (!l.includes(c)) l.push(c);
    this._set(l);
  }
  remove(...cs) {
    this._set(this._get().filter((c) => !cs.includes(c)));
  }
  toggle(c, force) {
    const has = this.contains(c);
    const want = force === undefined ? !has : !!force;
    if (want && !has) this.add(c);
    if (!want && has) this.remove(c);
    return want;
  }
  replace(a, b) {
    if (!this.contains(a)) return false;
    this._set(this._get().map((c) => (c === a ? b : c)));
    return true;
  }
  forEach(fn) {
    this._get().forEach(fn);
  }
  [Symbol.iterator]() {
    return this._get()[Symbol.iterator]();
  }
  toString() {
    return this.value;
  }
}

function makeStyle(el) {
  const props = new Map();
  const toKebab = (k) => (k.startsWith('--') ? k : k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()));
  const api = {
    setProperty: (k, v) => {
      if (v === null || v === '') props.delete(toKebab(k));
      else props.set(toKebab(k), String(v));
    },
    getPropertyValue: (k) => props.get(toKebab(k)) ?? '',
    removeProperty: (k) => {
      const v = props.get(toKebab(k)) ?? '';
      props.delete(toKebab(k));
      return v;
    },
    get cssText() {
      return [...props].map(([k, v]) => `${k}: ${v};`).join(' ');
    },
    set cssText(v) {
      props.clear();
      for (const part of String(v).split(';')) {
        const i = part.indexOf(':');
        if (i > 0) props.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
      }
    },
    get length() {
      return props.size;
    },
  };
  return new Proxy(api, {
    get(t, k) {
      if (k in t) return Reflect.get(t, k);
      if (typeof k !== 'string') return undefined;
      return props.get(toKebab(k)) ?? '';
    },
    set(t, k, v) {
      if (k === 'cssText') {
        t.cssText = v;
        return true;
      }
      if (v === null || v === '' || v === undefined) props.delete(toKebab(k));
      else props.set(toKebab(k), String(v));
      return true;
    },
  });
}

function makeDataset(el) {
  const toAttr = (k) => 'data-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  return new Proxy(
    {},
    {
      get: (_, k) => (typeof k === 'string' ? el.getAttribute(toAttr(k)) ?? undefined : undefined),
      set: (_, k, v) => {
        el.setAttribute(toAttr(k), String(v));
        return true;
      },
      deleteProperty: (_, k) => {
        el.removeAttribute(toAttr(k));
        return true;
      },
      has: (_, k) => el.hasAttribute(toAttr(k)),
      ownKeys: () =>
        [...el._attrs.keys()].filter((a) => a.startsWith('data-')).map((a) => a.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    },
  );
}

class FakeAnimation extends FakeEventTarget {
  constructor() {
    super();
    this.playState = 'finished';
    this.currentTime = 0;
    this.effect = null;
    this.onfinish = null;
    this.finished = Promise.resolve(this);
    this.ready = Promise.resolve(this);
  }
  cancel() {}
  finish() {}
  play() {}
  pause() {}
  reverse() {}
  commitStyles() {}
  persist() {}
  updatePlaybackRate() {}
}

const RECT = { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };

export class FakeElement extends FakeNode {
  constructor(tag, ns) {
    super(1);
    this.namespaceURI = ns || HTML_NS;
    this.localName = ns === SVG_NS ? tag : tag.toLowerCase();
    this._attrs = new Map();
    this.classList = new ClassList(this);
    this.style = makeStyle(this);
    this.dataset = makeDataset(this);
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this._value = undefined;
    this.checked = false;
    this.disabled = false;
  }
  get tagName() {
    return this.namespaceURI === SVG_NS ? this.localName : this.localName.toUpperCase();
  }
  get nodeName() {
    return this.tagName;
  }
  getAttribute(k) {
    return this._attrs.has(k) ? this._attrs.get(k) : null;
  }
  setAttribute(k, v) {
    this._attrs.set(String(k), String(v));
  }
  setAttributeNS(_ns, k, v) {
    this.setAttribute(k, v);
  }
  removeAttribute(k) {
    this._attrs.delete(k);
  }
  hasAttribute(k) {
    return this._attrs.has(k);
  }
  toggleAttribute(k, force) {
    const want = force === undefined ? !this.hasAttribute(k) : !!force;
    if (want) this.setAttribute(k, '');
    else this.removeAttribute(k);
    return want;
  }
  getAttributeNames() {
    return [...this._attrs.keys()];
  }
  get attributes() {
    return [...this._attrs].map(([name, value]) => ({ name, value }));
  }
  get id() {
    return this.getAttribute('id') ?? '';
  }
  set id(v) {
    this.setAttribute('id', v);
  }
  get className() {
    return this.getAttribute('class') ?? '';
  }
  set className(v) {
    this.setAttribute('class', v);
  }
  get hidden() {
    return this.hasAttribute('hidden');
  }
  set hidden(v) {
    this.toggleAttribute('hidden', !!v);
  }
  get title() {
    return this.getAttribute('title') ?? '';
  }
  set title(v) {
    this.setAttribute('title', v);
  }
  get tabIndex() {
    return Number(this.getAttribute('tabindex') ?? -1);
  }
  set tabIndex(v) {
    this.setAttribute('tabindex', v);
  }
  get type() {
    return this.getAttribute('type') ?? (this.localName === 'button' ? 'submit' : 'text');
  }
  set type(v) {
    this.setAttribute('type', v);
  }
  get value() {
    return this._value ?? this.getAttribute('value') ?? '';
  }
  set value(v) {
    this._value = String(v);
  }
  get src() {
    return this.getAttribute('src') ?? '';
  }
  set src(v) {
    this.setAttribute('src', v);
  }
  get href() {
    return this.getAttribute('href') ?? '';
  }
  set href(v) {
    this.setAttribute('href', v);
  }
  get children() {
    return this.childNodes.filter((c) => c.nodeType === 1);
  }
  get childElementCount() {
    return this.children.length;
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  get lastElementChild() {
    const c = this.children;
    return c[c.length - 1] ?? null;
  }
  get nextElementSibling() {
    const p = this.parentNode;
    if (!p) return null;
    const sibs = p.childNodes.filter((c) => c.nodeType === 1);
    return sibs[sibs.indexOf(this) + 1] ?? null;
  }
  get previousElementSibling() {
    const p = this.parentNode;
    if (!p) return null;
    const sibs = p.childNodes.filter((c) => c.nodeType === 1);
    return sibs[sibs.indexOf(this) - 1] ?? null;
  }
  get innerHTML() {
    return this.childNodes.map(serialize).join('');
  }
  set innerHTML(html) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    for (const n of parseHtml(String(html), this.namespaceURI === SVG_NS && this.localName !== 'foreignObject')) this.appendChild(n);
  }
  get outerHTML() {
    return serialize(this);
  }
  get innerText() {
    return this.textContent;
  }
  set innerText(v) {
    this.textContent = v;
  }
  insertAdjacentHTML(pos, html) {
    const nodes = parseHtml(String(html), false);
    const p = pos.toLowerCase();
    if (p === 'beforeend') for (const n of nodes) this.appendChild(n);
    else if (p === 'afterbegin') for (const n of nodes.reverse()) this.insertBefore(n, this.firstChild);
    else if (p === 'beforebegin') for (const n of nodes) this.parentNode.insertBefore(n, this);
    else if (p === 'afterend') for (const n of nodes.reverse()) this.parentNode.insertBefore(n, this.nextSibling);
  }
  insertAdjacentElement(pos, el) {
    const p = pos.toLowerCase();
    if (p === 'beforeend') this.appendChild(el);
    else if (p === 'afterbegin') this.insertBefore(el, this.firstChild);
    else if (p === 'beforebegin') this.parentNode.insertBefore(el, this);
    else if (p === 'afterend') this.parentNode.insertBefore(el, this.nextSibling);
    return el;
  }
  append(...nodes) {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? new FakeText(n) : n);
  }
  prepend(...nodes) {
    const first = this.firstChild;
    for (const n of nodes) this.insertBefore(typeof n === 'string' ? new FakeText(n) : n, first);
  }
  before(...nodes) {
    for (const n of nodes) this.parentNode?.insertBefore(typeof n === 'string' ? new FakeText(n) : n, this);
  }
  after(...nodes) {
    const next = this.nextSibling;
    for (const n of nodes) this.parentNode?.insertBefore(typeof n === 'string' ? new FakeText(n) : n, next);
  }
  replaceWith(...nodes) {
    const p = this.parentNode;
    if (!p) return;
    for (const n of nodes) p.insertBefore(typeof n === 'string' ? new FakeText(n) : n, this);
    p.removeChild(this);
  }
  replaceChildren(...nodes) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  querySelector(sel) {
    return querySelectorAllIn(this, sel)[0] ?? null;
  }
  querySelectorAll(sel) {
    return querySelectorAllIn(this, sel);
  }
  getElementsByTagName(tag) {
    return querySelectorAllIn(this, tag);
  }
  getElementsByClassName(c) {
    return querySelectorAllIn(this, '.' + c.trim().split(/\s+/).join('.'));
  }
  matches(sel) {
    return matchesSelector(this, sel);
  }
  closest(sel) {
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matchesSelector(n, sel)) return n;
    return null;
  }
  click() {
    if (this.disabled) return;
    this.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  }
  focus() {}
  blur() {}
  select() {}
  scrollIntoView() {}
  scrollTo() {}
  scrollBy() {}
  getBoundingClientRect() {
    return { ...RECT };
  }
  getClientRects() {
    return [];
  }
  get offsetWidth() {
    return 0;
  }
  get offsetHeight() {
    return 0;
  }
  get offsetTop() {
    return 0;
  }
  get offsetLeft() {
    return 0;
  }
  get offsetParent() {
    return this.parentElement;
  }
  get clientWidth() {
    return 0;
  }
  get clientHeight() {
    return 0;
  }
  get scrollWidth() {
    return 0;
  }
  get scrollHeight() {
    return 0;
  }
  animate() {
    return new FakeAnimation();
  }
  getAnimations() {
    return [];
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }
  attachShadow() {
    return new FakeFragment();
  }
  // <canvas>：战绩图、分享卡在结算时才画，发牌之前碰到的只有「能不能拿到一个 context」。
  getContext() {
    return null;
  }
  toDataURL() {
    return 'data:,';
  }
  // <svg> 那几个量尺寸的接口
  getBBox() {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  getTotalLength() {
    return 0;
  }
  getPointAtLength() {
    return { x: 0, y: 0 };
  }
  // <dialog>
  showModal() {
    this.setAttribute('open', '');
  }
  show() {
    this.setAttribute('open', '');
  }
  close() {
    this.removeAttribute('open');
  }
  // <form>
  reset() {}
  requestSubmit() {}
  checkValidity() {
    return true;
  }
  reportValidity() {
    return true;
  }
  setCustomValidity() {}
  // <img>
  get complete() {
    return true;
  }
  decode() {
    return Promise.resolve();
  }
}

function serialize(n) {
  if (n.nodeType === 3) return escText(n.data);
  if (n.nodeType === 8) return `<!--${n.data}-->`;
  if (n.nodeType === 11) return n.childNodes.map(serialize).join('');
  const attrs = [...n._attrs].map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escAttr(v)}"`)).join('');
  const tag = n.localName;
  if (VOID.has(tag) && n.namespaceURI !== SVG_NS) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${n.childNodes.map(serialize).join('')}</${tag}>`;
}

/** 小解析器：标签、属性（带引号 / 不带）、注释、文字、空元素、自闭合（SVG 里那种）。容错只到「我们自己写的模板」那个程度。 */
function parseHtml(html, inSvg) {
  const root = new FakeFragment();
  const stack = [{ node: root, svg: inSvg }];
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      const j = end < 0 ? html.length : end;
      top().node.appendChild(new FakeComment(html.slice(i + 4, j)));
      i = j + 3;
      continue;
    }
    if (html[i] === '<' && html[i + 1] === '/') {
      const end = html.indexOf('>', i);
      const name = html.slice(i + 2, end).trim().toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].node.localName.toLowerCase() === name) {
          stack.length = k;
          break;
        }
      }
      i = end + 1;
      continue;
    }
    if (html[i] === '<' && /[A-Za-z!]/.test(html[i + 1] ?? '')) {
      if (html[i + 1] === '!') {
        i = html.indexOf('>', i) + 1;
        continue;
      }
      let j = i + 1;
      while (j < html.length && /[^\s/>]/.test(html[j])) j++;
      const rawName = html.slice(i + 1, j);
      const svg = top().svg || rawName.toLowerCase() === 'svg';
      const el = new FakeElement(svg ? rawName : rawName.toLowerCase(), svg ? SVG_NS : HTML_NS);
      let selfClose = false;
      for (;;) {
        while (j < html.length && /\s/.test(html[j])) j++;
        if (html[j] === '>') {
          j++;
          break;
        }
        if (html[j] === '/' && html[j + 1] === '>') {
          selfClose = true;
          j += 2;
          break;
        }
        if (j >= html.length) break;
        let k = j;
        while (k < html.length && /[^\s=/>]/.test(html[k])) k++;
        const name = html.slice(j, k);
        j = k;
        while (/\s/.test(html[j] ?? '')) j++;
        let value = '';
        if (html[j] === '=') {
          j++;
          while (/\s/.test(html[j] ?? '')) j++;
          const q = html[j];
          if (q === '"' || q === "'") {
            const end = html.indexOf(q, j + 1);
            value = html.slice(j + 1, end);
            j = end + 1;
          } else {
            let e = j;
            while (e < html.length && /[^\s>]/.test(html[e])) e++;
            value = html.slice(j, e);
            j = e;
          }
        }
        if (name) el._attrs.set(svg ? name : name.toLowerCase(), decodeEntities(value));
        else j++;
      }
      top().node.appendChild(el);
      const tagLower = rawName.toLowerCase();
      if (!selfClose && !(VOID.has(tagLower) && !svg)) {
        if (tagLower === 'script' || tagLower === 'style' || tagLower === 'textarea') {
          const end = html.toLowerCase().indexOf(`</${tagLower}`, j);
          const stop = end < 0 ? html.length : end;
          if (stop > j) el.appendChild(new FakeText(html.slice(j, stop)));
          j = end < 0 ? html.length : html.indexOf('>', end) + 1;
        } else {
          stack.push({ node: el, svg: svg && tagLower !== 'foreignobject' });
        }
      }
      i = j;
      continue;
    }
    let j = html.indexOf('<', i + 1);
    if (j < 0) j = html.length;
    top().node.appendChild(new FakeText(decodeEntities(html.slice(i, j))));
    i = j;
  }
  return [...root.childNodes];
}

// ── 选择器 ───────────────────────────────────────────────────────────────────────────
const selectorCache = new Map();

function splitTop(s, sep) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

function parseCompound(src) {
  const c = { tag: null, ids: [], classes: [], attrs: [], pseudos: [] };
  let i = 0;
  const ident = () => {
    let j = i;
    while (j < src.length && /[\w\- -￿\\]/.test(src[j])) j++;
    const v = src.slice(i, j).replace(/\\(.)/g, '$1');
    i = j;
    return v;
  };
  if (src[0] === '*') i = 1;
  else if (/[A-Za-z]/.test(src[0] ?? '')) c.tag = ident().toLowerCase();
  while (i < src.length) {
    const ch = src[i];
    if (ch === '#') {
      i++;
      c.ids.push(ident());
    } else if (ch === '.') {
      i++;
      c.classes.push(ident());
    } else if (ch === '[') {
      const end = src.indexOf(']', i);
      const body = src.slice(i + 1, end).trim();
      const m = /^([\w\-:]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))(\s+i)?)?$/.exec(body);
      if (!m) throw new Error(`fakeDom 不认得这个属性选择器：[${body}]`);
      c.attrs.push({ name: m[1], op: m[2] || null, value: m[3] ?? m[4] ?? m[5] ?? '' });
      i = end + 1;
    } else if (ch === ':') {
      i++;
      if (src[i] === ':') throw new Error(`fakeDom 不认得伪元素：${src}`);
      const name = ident();
      let arg = null;
      if (src[i] === '(') {
        let depth = 0;
        let j = i;
        for (; j < src.length; j++) {
          if (src[j] === '(') depth++;
          else if (src[j] === ')' && --depth === 0) break;
        }
        arg = src.slice(i + 1, j);
        i = j + 1;
      }
      c.pseudos.push({ name, arg });
    } else {
      throw new Error(`fakeDom 不认得这个选择器：${src}`);
    }
  }
  return c;
}

function parseSelector(sel) {
  if (selectorCache.has(sel)) return selectorCache.get(sel);
  const groups = splitTop(sel, ',').map((g) => {
    const tokens = [];
    const s = g.trim().replace(/\s*([>+~])\s*/g, ' $1 ');
    for (const part of splitTop(s, ' ').filter(Boolean)) {
      if (part === '>' || part === '+' || part === '~') tokens.push({ comb: part });
      else tokens.push({ comp: parseCompound(part) });
    }
    // 拼成「从右往左」那一串：[{comp, comb(到左边那一个的关系)}]
    const chain = [];
    let comb = ' ';
    for (const t of tokens) {
      if (t.comb) comb = t.comb;
      else {
        chain.push({ comp: t.comp, comb });
        comb = ' ';
      }
    }
    return chain;
  });
  selectorCache.set(sel, groups);
  return groups;
}

function matchCompound(el, c, scope) {
  if (!el || el.nodeType !== 1) return false;
  if (c.tag && el.localName.toLowerCase() !== c.tag) return false;
  for (const id of c.ids) if (el.getAttribute('id') !== id) return false;
  if (c.classes.length) {
    const cls = (el.getAttribute('class') || '').split(/\s+/);
    for (const k of c.classes) if (!cls.includes(k)) return false;
  }
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null) return false;
    if (!a.op) continue;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.value)) return false;
    if (a.op === '^=' && !v.startsWith(a.value)) return false;
    if (a.op === '$=' && !v.endsWith(a.value)) return false;
    if (a.op === '*=' && !v.includes(a.value)) return false;
    if (a.op === '|=' && !(v === a.value || v.startsWith(a.value + '-'))) return false;
  }
  for (const p of c.pseudos) {
    const sibs = el.parentNode ? el.parentNode.childNodes.filter((n) => n.nodeType === 1) : [el];
    switch (p.name) {
      case 'not':
        if (matchesSelector(el, p.arg, scope)) return false;
        break;
      case 'is':
      case 'where':
        if (!matchesSelector(el, p.arg, scope)) return false;
        break;
      case 'scope':
        if (el !== scope) return false;
        break;
      case 'first-child':
        if (sibs[0] !== el) return false;
        break;
      case 'last-child':
        if (sibs[sibs.length - 1] !== el) return false;
        break;
      case 'only-child':
        if (sibs.length !== 1) return false;
        break;
      case 'checked':
        if (!el.checked) return false;
        break;
      case 'disabled':
        if (!el.disabled && !el.hasAttribute('disabled')) return false;
        break;
      case 'empty':
        if (el.childNodes.length) return false;
        break;
      case 'focus':
      case 'hover':
      case 'focus-visible':
      case 'active':
        return false;
      default:
        throw new Error(`fakeDom 不认得这个伪类：:${p.name}`);
    }
  }
  return true;
}

function matchChain(el, chain, idx, scope) {
  const { comp, comb } = chain[idx];
  if (!matchCompound(el, comp, scope)) return false;
  if (idx === 0) return true;
  if (comb === '>') return matchChain(el.parentElement, chain, idx - 1, scope);
  if (comb === '+') return matchChain(el.previousElementSibling, chain, idx - 1, scope);
  if (comb === '~') {
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (matchChain(s, chain, idx - 1, scope)) return true;
    return false;
  }
  for (let p = el.parentElement; p; p = p.parentElement) if (matchChain(p, chain, idx - 1, scope)) return true;
  return false;
}

function matchesSelector(el, sel, scope) {
  return parseSelector(sel).some((chain) => matchChain(el, chain, chain.length - 1, scope));
}

function querySelectorAllIn(root, sel) {
  const groups = parseSelector(sel);
  const out = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      if (groups.some((chain) => matchChain(c, chain, chain.length - 1, root))) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

// ── window 那一圈 ─────────────────────────────────────────────────────────────────────
class FakeStorage {
  constructor(init) {
    this._m = new Map(Object.entries(init || {}));
  }
  get length() {
    return this._m.size;
  }
  key(i) {
    return [...this._m.keys()][i] ?? null;
  }
  getItem(k) {
    return this._m.has(String(k)) ? this._m.get(String(k)) : null;
  }
  setItem(k, v) {
    this._m.set(String(k), String(v));
  }
  removeItem(k) {
    this._m.delete(String(k));
  }
  clear() {
    this._m.clear();
  }
}

class FakeDocument extends FakeNode {
  constructor() {
    super(9);
    this.documentElement = new FakeElement('html');
    this.head = new FakeElement('head');
    this.body = new FakeElement('body');
    this.documentElement.parentNode = this;
    this.childNodes = [this.documentElement];
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.visibilityState = 'visible';
    this.hidden = false;
    this.readyState = 'complete';
    this.title = '';
    this.cookie = '';
    this.activeElement = this.body;
    this.fonts = { ready: Promise.resolve(), load: () => Promise.resolve([]), check: () => true, addEventListener() {}, removeEventListener() {} };
  }
  createElement(tag) {
    return new FakeElement(String(tag), HTML_NS);
  }
  createElementNS(ns, tag) {
    return new FakeElement(String(tag), ns);
  }
  createTextNode(t) {
    return new FakeText(String(t));
  }
  createComment(t) {
    return new FakeComment(String(t));
  }
  createDocumentFragment() {
    return new FakeFragment();
  }
  getElementById(id) {
    return querySelectorAllIn(this, '#' + id)[0] ?? null;
  }
  querySelector(sel) {
    return querySelectorAllIn(this, sel)[0] ?? null;
  }
  querySelectorAll(sel) {
    return querySelectorAllIn(this, sel);
  }
  getElementsByTagName(tag) {
    return querySelectorAllIn(this, tag);
  }
  elementFromPoint() {
    return null;
  }
  elementsFromPoint() {
    return [];
  }
  hasFocus() {
    return true;
  }
  execCommand() {
    return false;
  }
  get defaultView() {
    return globalThis.window;
  }
}

/**
 * 装上假 DOM。`media` 是一张「这一条媒体查询答真还是答假」的函数（默认：竖着的触屏手机）。
 * 返回一组给门用的把手：跑动画帧、跑定时器、换一份本机存储、拆掉。
 */
export function installFakeDom({ width = 390, height = 844, media, storage } = {}) {
  doc = new FakeDocument();
  const frames = [];
  const timers = new Map();
  let timerSeq = 1;
  const g = globalThis;
  const answer =
    media ||
    ((q) => {
      const s = q.toLowerCase();
      if (/prefers-reduced-motion:\s*reduce/.test(s)) return true; // 动画全按「减弱」走：发牌之后少挂一堆
      if (/prefers-color-scheme:\s*dark/.test(s)) return false;
      if (/orientation:\s*portrait/.test(s)) return height >= width;
      if (/orientation:\s*landscape/.test(s)) return width > height;
      if (/pointer:\s*coarse|hover:\s*none/.test(s)) return true;
      if (/pointer:\s*fine|hover:\s*hover/.test(s)) return false;
      if (/display-mode:\s*standalone/.test(s)) return false;
      const minW = /min-width:\s*(\d+)/.exec(s);
      const maxW = /max-width:\s*(\d+)/.exec(s);
      const minH = /min-height:\s*(\d+)/.exec(s);
      const maxH = /max-height:\s*(\d+)/.exec(s);
      if (minW || maxW || minH || maxH) {
        return (!minW || width >= +minW[1]) && (!maxW || width <= +maxW[1]) && (!minH || height >= +minH[1]) && (!maxH || height <= +maxH[1]);
      }
      return false;
    });
  const win = {
    document: doc,
    innerWidth: width,
    innerHeight: height,
    outerWidth: width,
    outerHeight: height,
    devicePixelRatio: 2,
    scrollX: 0,
    scrollY: 0,
    pageXOffset: 0,
    pageYOffset: 0,
    screen: { width, height, availWidth: width, availHeight: height, orientation: { type: height >= width ? 'portrait-primary' : 'landscape-primary', angle: 0, addEventListener() {}, removeEventListener() {} } },
    visualViewport: Object.assign(new FakeEventTarget(), { width, height, offsetTop: 0, offsetLeft: 0, pageTop: 0, scale: 1 }),
    navigator: { userAgent: 'Mozilla/5.0 (fakeDom; seed-golden) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', language: 'zh-CN', languages: ['zh-CN'], maxTouchPoints: 5, onLine: true, platform: 'Linux', vibrate: () => true, clipboard: { writeText: () => Promise.resolve() }, standalone: false },
    location: { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} },
    history: { length: 1, state: null, pushState() {}, replaceState() {}, back() {}, forward() {}, go() {} },
    localStorage: new FakeStorage(storage),
    sessionStorage: new FakeStorage(),
    matchMedia: (q) => Object.assign(new FakeEventTarget(), { media: q, matches: answer(q), onchange: null, addListener() {}, removeListener() {} }),
    requestAnimationFrame: (fn) => {
      frames.push(fn);
      return frames.length;
    },
    cancelAnimationFrame: (id) => {
      if (frames[id - 1]) frames[id - 1] = null;
    },
    setTimeout: (fn, ms = 0, ...args) => {
      const id = timerSeq++;
      timers.set(id, { fn, ms: Number(ms) || 0, args });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms = 0, ...args) => {
      const id = timerSeq++;
      timers.set(id, { fn, ms: Number(ms) || 0, args, every: true });
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    queueMicrotask: g.queueMicrotask,
    getComputedStyle: (el) => {
      const st = el?.style;
      return new Proxy(
        { getPropertyValue: (k) => st?.getPropertyValue(k) ?? '' },
        { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? (st ? st[k] : '') || '' : undefined) },
      );
    },
    getSelection: () => ({ removeAllRanges() {}, addRange() {}, toString: () => '' }),
    scrollTo() {},
    scrollBy() {},
    scroll() {},
    focus() {},
    blur() {},
    open: () => null,
    close() {},
    print() {},
    alert() {},
    confirm: () => false,
    prompt: () => null,
    postMessage() {},
    fetch: () => Promise.reject(new Error('fakeDom：门里不发网络请求')),
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
    // 没有 MessageChannel：教学呼吸灯的搜索在 node 里会排在真的消息队列上、把进程拖住不退出；没有它就退回
    // setTimeout(0)（engine/coachHint.ts 那条退路），而这儿的定时器不自己走。
    MessageChannel: undefined,
    BroadcastChannel: undefined,
    AudioContext: undefined,
    webkitAudioContext: undefined,
    Image: class extends FakeElement {
      constructor() {
        super('img');
      }
    },
    CSS: { supports: () => true, escape: (s) => String(s) },
    Event: FakeEvent,
    CustomEvent: FakeEvent,
    KeyboardEvent: FakeEvent,
    PointerEvent: FakeEvent,
    MouseEvent: FakeEvent,
    TouchEvent: FakeEvent,
    FocusEvent: FakeEvent,
    PopStateEvent: FakeEvent,
    StorageEvent: FakeEvent,
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeElement,
    SVGElement: FakeElement,
    HTMLButtonElement: FakeElement,
    HTMLInputElement: FakeElement,
    HTMLImageElement: FakeElement,
    HTMLCanvasElement: FakeElement,
    DocumentFragment: FakeFragment,
    Text: FakeText,
    EventTarget: FakeEventTarget,
    DOMParser: class {
      parseFromString(html) {
        const d = new FakeDocument();
        for (const n of parseHtml(html, false)) d.body.appendChild(n);
        return d;
      }
    },
  };
  const winTarget = new FakeEventTarget();
  for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent', '_fire', '_listeners']) {
    win[k] = typeof winTarget[k] === 'function' ? winTarget[k].bind(winTarget) : winTarget[k];
  }
  // window 就是 globalThis：代码里 `window.setTimeout` 和光写 `setTimeout` 拿到的是同一个（假的那一个），
  // `window.localStorage` 和 `localStorage` 也是同一份。
  for (const k of ['window', 'self', 'top', 'parent', 'frames']) win[k] = g;
  const saved = new Map();
  for (const [k, v] of Object.entries(win)) {
    saved.set(k, Object.getOwnPropertyDescriptor(g, k));
    Object.defineProperty(g, k, { value: v, writable: true, configurable: true, enumerable: true });
  }
  return {
    document: doc,
    window: g,
    /** 跑掉此刻排着的动画帧（帧里又排的下一帧留到下一次）。 */
    flushFrames(n = 1) {
      for (let k = 0; k < n; k++) {
        const now = frames.splice(0);
        for (const fn of now) if (fn) fn(performance.now());
      }
    },
    /** 跑掉等待时间不超过 `upToMs` 的定时器（不推进真的时间；setInterval 只跑一趟）。 */
    runTimers(upToMs = 0) {
      for (const [id, t] of [...timers]) {
        if (t.ms > upToMs) continue;
        timers.delete(id);
        t.fn(...t.args);
      }
    },
    /** 一局拆掉之后把排着的帧和定时器全扔掉：下一局从干净的队列开始。 */
    dropPending() {
      frames.length = 0;
      timers.clear();
    },
    pendingTimers: () => timers.size,
    setStorage(init) {
      g.localStorage = new FakeStorage(init);
      g.sessionStorage = new FakeStorage();
    },
    uninstall() {
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(g, k, d);
        else delete g[k];
      }
      doc = null;
    },
  };
}
