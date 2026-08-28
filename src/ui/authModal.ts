export type AuthTab = 'register' | 'login';

const TAB_LABEL: Record<AuthTab, string> = { register: '注册', login: '登录' };

/** Blank register/login popup — reachable from the home avatar and from the 天才入口 page's "成为Slides天才" link. Overlays whatever screen is currently showing rather than replacing it, and tears itself down on close. */
export function showAuthModal(initialTab: AuthTab = 'login'): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'overlay show';
  overlay.innerHTML = `
    <div class="modal auth-modal">
      <div class="auth-tabs">
        <button class="auth-tab" data-tab="register">${TAB_LABEL.register}</button>
        <button class="auth-tab" data-tab="login">${TAB_LABEL.login}</button>
      </div>
      <div class="auth-body">
        <p class="tag-line">敬请期待</p>
      </div>
      <div class="btn-row"><button class="secondary" id="authCloseBtn">关闭</button></div>
    </div>
  `;
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }

  const tabs = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.auth-tab'));
  function setTab(tab: AuthTab) {
    for (const t of tabs) t.classList.toggle('active', t.dataset.tab === tab);
  }
  for (const t of tabs) {
    t.addEventListener('click', () => setTab(t.dataset.tab as AuthTab));
  }
  setTab(initialTab);

  overlay.querySelector<HTMLButtonElement>('#authCloseBtn')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return close;
}
