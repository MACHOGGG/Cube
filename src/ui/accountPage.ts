export type AuthTab = 'register' | 'login';

const TAB_LABEL: Record<AuthTab, string> = { register: '注册', login: '登录' };

const LOCK_GLYPH =
  '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11 V8 a4 4 0 0 1 8 0 v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

const PRIVILEGES = [
  '解锁更多配色',
  '更多关卡',
  '更多得分目标',
  '更多布局',
  '更多玩法',
  '更多竞赛',
  '世界排名和好友排名',
  'Apple Watch 特别版',
];

/** The account/sign-in page and the "天才入口" privileges list, merged into
 *  one destination — reachable from the home page's avatar/exclusive-pill
 *  buttons and the bottom nav's account tab alike, rather than being two
 *  separate screens a player has to know to look for individually. */
export function renderAccountPage(container: HTMLElement, initialTab: AuthTab, onBack: () => void) {
  container.innerHTML = `
    <div class="app">
      <h1>账户</h1>
      <div class="auth-tabs">
        <button class="auth-tab" data-tab="register">${TAB_LABEL.register}</button>
        <button class="auth-tab" data-tab="login">${TAB_LABEL.login}</button>
      </div>
      <div class="auth-body">
        <p class="tag-line">敬请期待完整的账户系统</p>
      </div>

      <hr class="menu-divider" />

      <div class="menu-section-label">Slides 天才专属特权</div>
      <div class="privilege-list">
        ${PRIVILEGES.map((p) => `<div class="privilege-item"><span class="glyph">${LOCK_GLYPH}</span><span class="label">${p}</span></div>`).join('')}
        <div class="privilege-item soon">……敬请期待</div>
      </div>
      <button class="home-how-to" id="becomeGeniusBtn">成为 Slides 天才</button>

      <div class="controls">
        <button class="icon-btn" id="backBtn">返回</button>
      </div>
    </div>
  `;

  const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('.auth-tab'));
  function setTab(tab: AuthTab) {
    for (const t of tabs) t.classList.toggle('active', t.dataset.tab === tab);
  }
  for (const t of tabs) {
    t.addEventListener('click', () => setTab(t.dataset.tab as AuthTab));
  }
  setTab(initialTab);

  container.querySelector<HTMLButtonElement>('#becomeGeniusBtn')?.addEventListener('click', () => setTab('register'));
  container.querySelector<HTMLButtonElement>('#backBtn')?.addEventListener('click', onBack);
}
