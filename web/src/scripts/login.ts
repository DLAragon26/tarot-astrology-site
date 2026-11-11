import { ApiError, api, redirectToLogin } from '../lib/api';

interface AuthUser {
  user: { username: string; role: string; must_change_password: boolean };
}

function show(id: string, message: string): void {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
}

function hide(id: string): void {
  const node = document.getElementById(id);
  if (node) node.hidden = true;
}

async function busy<T>(btnId: string, fn: () => Promise<T>): Promise<T | undefined> {
  const btn = document.getElementById(btnId) as HTMLButtonElement | null;
  btn?.setAttribute('disabled', 'true');
  try {
    return await fn();
  } finally {
    btn?.removeAttribute('disabled');
  }
}

// 已登录直接进入
try {
  await api<AuthUser>('/api/me', {}, { redirectOn401: false });
  location.href = `${import.meta.env.BASE_URL}draw`;
} catch {
  /* 未登录，停留登录页 */
}

document.getElementById('toggle-redeem')?.addEventListener('click', () => {
  const f = document.getElementById('redeem-form') as HTMLFormElement | null;
  if (f) f.hidden = !f.hidden;
});

document.getElementById('login-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  hide('login-error');
  busy('submit-btn', async () => {
    const get = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    try {
      const res = await api<AuthUser>('/api/login', {
        method: 'POST',
        body: JSON.stringify({
          site_access_key: get('site-key'),
          username: get('username'),
          password: get('password'),
        }),
      });
      if (res.user.must_change_password) {
        // 引导密码登录成功：先进入，再在抽牌页提示改密
        sessionStorage.setItem('must_change_password', '1');
      }
      location.href = `${import.meta.env.BASE_URL}draw`;
    } catch (err) {
      show('login-error', err instanceof ApiError ? err.message : '登录失败，请稍后重试');
    }
  });
});

document.getElementById('redeem-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  hide('redeem-error');
  const get = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
  const btn = (e.submitter as HTMLButtonElement) ?? (document.getElementById('redeem-form') as HTMLFormElement).querySelector('button');
  btn?.setAttribute('disabled', 'true');
  api<AuthUser>('/api/redeem', {
    method: 'POST',
    body: JSON.stringify({
      invite_code: get('r-invite').trim(),
      site_access_key: get('r-site-key'),
      username: get('r-username'),
      password: get('r-password'),
    }),
  })
    .then(() => {
      location.href = `${import.meta.env.BASE_URL}draw`;
    })
    .catch((err) => {
      show('redeem-error', err instanceof ApiError ? err.message : '激活失败，请稍后重试');
    })
    .finally(() => {
      btn?.removeAttribute('disabled');
    });
});

void redirectToLogin;
