/**
 * 登录／改密那几扇窗里的两个小零件：六段完成度表和六格验证码。
 *
 * 都只是**表现层**：底下那一串 `name` / `autocomplete` / `type` 一个字没动，密码管理器
 * 看到的还是原来那张表（那一串是精心标注过的，见 subscribe.ts 的 credentialForm）。
 * 两个零件都由 JS 在现成的 input 旁边／外面搭，不改 field() 生成的结构。
 */
import { meterFill, splitPastedCode } from '../engine/kinetics';
import { shakeReject } from '../engine/juice';
import { STRINGS, type Lang } from '../i18n';

/** 密码正好六位（api/_accounts.js 和 subscribe.ts 的 isPin 是同一条规矩）。 */
const PW_LEN = 6;

/**
 * 输入框底下六小段，打一位填一段。
 *
 * **不是强度表，是完成度表。** 密码策略是「正好六位」，定长的东西谈不上强弱——四档强度
 * 表摆在这儿是一块自相矛盾的仪表。它回答的是唯一还没答案的那个问题：「我打了几位了？」
 * 六位密码没有回显，人数不清自己打了几下（尤其在手机上按错一下就少一位）。
 *
 * 只挂在**设新密码**那几处（注册、改密、解锁）。登录那张表不挂：那儿不需要仪表，他打的
 * 是一个自己早就知道的密码，数它几位没有意义。
 *
 * 段数由纯函数 meterFill 算（门钉着它的钳制和线性，见 scripts/check-kinetics.mjs）。
 * 满六段时整排轻轻鼓一下（过冲曲线），那一下就是「够了」。
 *
 * 无障碍：旁边挂一行实时文案（`aria-describedby` ＋ `role="status"`），读屏软件读得到
 * 「6 位密码，已输入 n 位」——六小段对看不见屏幕的人等于不存在。
 */
export function mountPwMeter(input: HTMLInputElement, lang: Lang): void {
  const s = STRINGS[lang];
  const field = input.closest<HTMLElement>('.auth-field');
  if (!field) return;

  const wrap = document.createElement('div');
  wrap.className = 'pw-meter';
  wrap.setAttribute('aria-hidden', 'true');
  const segs: HTMLElement[] = [];
  for (let i = 0; i < PW_LEN; i++) {
    const seg = document.createElement('i');
    seg.className = 'pw-meter-seg';
    // 相邻段之间 30ms 错峰：一下填三位（粘贴、输入法上屏）时读起来是「一段接一段」，
    // 不是「整排一起亮」。
    seg.style.transitionDelay = i * 30 + 'ms';
    wrap.appendChild(seg);
    segs.push(seg);
  }
  const say = document.createElement('p');
  say.className = 'pw-meter-say';
  say.id = input.id + 'Say';
  say.setAttribute('role', 'status');
  input.setAttribute('aria-describedby', say.id);
  // 防超输。有几处本来就写着 maxlength="6"，有一处（改密那扇窗的新密码）漏了。
  input.setAttribute('maxlength', String(PW_LEN));

  field.insertAdjacentElement('afterend', wrap);
  wrap.insertAdjacentElement('afterend', say);

  const paint = () => {
    const n = meterFill(input.value.length);
    segs.forEach((seg, i) => seg.classList.toggle('on', i < n));
    say.textContent = s.pwMeterSay.replace('{n}', String(n));
    // 满了才鼓那一下，而且只在**刚满**的那一刻鼓——每按一下都鼓就成了噪音。
    if (n === PW_LEN) {
      if (!wrap.classList.contains('pw-meter--full')) wrap.classList.add('pw-meter--full');
    } else {
      wrap.classList.remove('pw-meter--full');
    }
  };
  input.addEventListener('input', paint);
  paint();
}

/**
 * 六格验证码：底下一个真输入框，上面六个只管显示的格子。
 *
 * **真输入框留着，盖在格子上（opacity: 0，占满整行）。** 焦点、粘贴、输入法、iOS 短信
 * 自动填充全走原生那一套——这一条是重点：六个各自独立的 input 是这类控件最常见的做法，
 * 也是最常出问题的做法（粘贴只进第一格、退格跳不回去、输入法上屏丢字、密码管理器和短
 * 信自动填充全部失灵）。这儿一格都没新建 input，`autocomplete="one-time-code"` 那一位
 * 也原样留在它本来的框上。
 *
 * 格子只做三件事：显示已经打进去的那几位、给当前那一位描一圈、新填一位时鼓一下。
 *
 * 粘贴走纯函数 splitPastedCode（去掉非数字、取前 n 位）：码是从聊天软件复制来的，带着
 * 空格、连字符、甚至「验证码：」三个字，人肉挑数字正是这个框存在的全部意义的反面。
 */
export interface PinBox {
  /** 填错了：格子行抖一下 ＋ 拒绝音 ＋ 清空 ＋ 回到第一格。 */
  reject(): void;
  destroy(): void;
}

export function mountPin(input: HTMLInputElement, onFull?: (code: string) => void): PinBox {
  const len = Number(input.getAttribute('maxlength')) || PW_LEN;
  const field = input.closest<HTMLElement>('.auth-field');
  if (!field) return { reject: () => {}, destroy: () => {} };

  field.classList.add('auth-field--pin');
  const row = document.createElement('div');
  row.className = 'pin-row';
  row.setAttribute('aria-hidden', 'true');
  const cells: HTMLElement[] = [];
  for (let i = 0; i < len; i++) {
    const cell = document.createElement('i');
    cell.className = 'pin-cell';
    row.appendChild(cell);
    cells.push(cell);
  }
  // 格子排在真输入框**前面**，输入框靠 CSS 盖在它上面（见 style.css 的
  // .auth-field--pin input）。不用 z-index 打架：后面的元素本来就压在前面的上头。
  input.insertAdjacentElement('beforebegin', row);

  /** 上一次画的是几位——用来认「这一下是新填了一位」（只有新填的那一格才鼓）。 */
  let was = 0;
  const paint = () => {
    const v = input.value;
    cells.forEach((cell, i) => {
      cell.textContent = v[i] ?? '';
      cell.classList.toggle('on', i < v.length);
      // 当前那一位：下一个要填的格子。满了就不描——没有「下一位」了。
      cell.classList.toggle('pin-cell--at', i === v.length && v.length < len);
    });
    if (v.length > was && v.length <= len) {
      // 只鼓刚填上的那一格。retrigger 那一套：先摘再挂、中间逼一次重排，连着填两位时
      // 第二下才盖得掉还没放完的第一下。
      const cell = cells[v.length - 1];
      cell.classList.remove('pin-cell--pop');
      void cell.offsetWidth;
      cell.classList.add('pin-cell--pop');
    }
    was = v.length;
    if (v.length === len) onFull?.(v);
  };

  const onInput = () => paint();
  const onPaste = (e: ClipboardEvent) => {
    const raw = e.clipboardData?.getData('text') ?? '';
    if (!raw) return;
    e.preventDefault();
    input.value = splitPastedCode(raw, len);
    paint();
  };
  input.addEventListener('input', onInput);
  input.addEventListener('paste', onPaste);
  input.addEventListener('focus', () => row.classList.add('pin-row--on'));
  input.addEventListener('blur', () => row.classList.remove('pin-row--on'));
  paint();

  return {
    reject() {
      shakeReject(row);
      input.value = '';
      was = 0;
      paint();
      input.focus();
    },
    destroy() {
      input.removeEventListener('input', onInput);
      input.removeEventListener('paste', onPaste);
      row.remove();
      field.classList.remove('auth-field--pin');
    },
  };
}
