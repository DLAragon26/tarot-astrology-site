import type { AdminStats } from '@tarot/shared';
import { ApiError, api, el, fmtDate } from '../lib/api';

const content = document.getElementById('content') as HTMLDivElement;
const denied = document.getElementById('denied') as HTMLDivElement;
const overview = document.getElementById('overview') as HTMLDivElement;
const userTable = document.getElementById('user-table') as HTMLDivElement;
const inviteList = document.getElementById('invite-list') as HTMLDivElement;
const inviteNew = document.getElementById('invite-new') as HTMLDivElement;
const nuMsg = document.getElementById('nu-msg') as HTMLDivElement;

function fail(err: unknown, box: HTMLElement = nuMsg): void {
  box.textContent = err instanceof ApiError ? err.message : '操作失败';
  box.classList.add('error');
  box.hidden = false;
}

async function loadUsers(): Promise<void> {
  const { users } = await api<{ users: import('@tarot/shared').AdminUserRow[] }>('/api/admin/users');
  userTable.innerHTML = '';
  const table = el('table', 'data');
  const thead = el('thead');
  const trh = el('tr');
  for (const t of ['用户', '角色', '今日 AI', '额度剩余', '状态', '操作']) trh.appendChild(el('th', undefined, t));
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const u of users) {
    const tr = el('tr');
    tr.appendChild(el('td', undefined, u.username));
    tr.appendChild(el('td', undefined, u.role === 'admin' ? '管理员' : '成员'));
    tr.appendChild(el('td', undefined, String(u.used_today)));
    tr.appendChild(el('td', undefined, u.remaining === -1 ? '无上限' : String(u.remaining)));
    tr.appendChild(el('td', undefined, u.is_active ? '正常' : '已停用'));

    const ops = el('td');
    // 调整额度
    const limitBtn = el('button', 'linklike', '调额度');
    limitBtn.addEventListener('click', async () => {
      const input = prompt(`为 ${u.username} 设置每日 AI 额度（当前 ${u.remaining === -1 ? '无上限' : `剩余 ${u.remaining}`}），留空恢复默认 20：`);
      if (input === null) return;
      const value = input.trim() === '' ? null : Number(input);
      try {
        await api(`/api/admin/users/${u.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ daily_ai_limit: value }),
        });
        void loadUsers();
      } catch (err) {
        fail(err);
      }
    });
    ops.appendChild(limitBtn);
    ops.appendChild(document.createTextNode(' · '));
    // 重置密码
    const pwBtn = el('button', 'linklike', '重置密码');
    pwBtn.addEventListener('click', async () => {
      const pw = prompt(`为 ${u.username} 设置新密码（至少 8 位，重置后其所有登录会话将失效）：`);
      if (!pw) return;
      try {
        await api(`/api/admin/users/${u.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ new_password: pw }),
        });
        alert(`已重置。新密码：${pw}\n请立即复制并安全地告知对方（页面不会再次显示）。`);
      } catch (err) {
        fail(err);
      }
    });
    ops.appendChild(pwBtn);
    if (u.role !== 'admin') {
      ops.appendChild(document.createTextNode(' · '));
      const toggleBtn = el('button', 'linklike', u.is_active ? '停用' : '启用');
      toggleBtn.addEventListener('click', async () => {
        try {
          await api(`/api/admin/users/${u.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_active: !u.is_active }),
          });
          void loadUsers();
        } catch (err) {
          fail(err);
        }
      });
      ops.appendChild(toggleBtn);
    }
    tr.appendChild(ops);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  userTable.appendChild(table);
}

async function loadInvites(): Promise<void> {
  const { invite_codes } = await api<{ invite_codes: import('@tarot/shared').AdminInviteRow[] }>('/api/admin/invite-codes');
  inviteList.innerHTML = '';
  if (invite_codes.length === 0) {
    inviteList.appendChild(el('p', 'muted', '还没有邀请码。'));
    return;
  }
  const table = el('table', 'data');
  const thead = el('thead');
  const trh = el('tr');
  for (const t of ['邀请码', '状态', '使用者', '创建时间']) trh.appendChild(el('th', undefined, t));
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const c of invite_codes) {
    const tr = el('tr');
    tr.appendChild(el('td', undefined, c.code));
    tr.appendChild(
      el('td', undefined, c.status === 'active' ? '未使用' : c.status === 'redeemed' ? '已使用' : '已撤销')
    );
    tr.appendChild(el('td', undefined, c.redeemed_by ?? '—'));
    tr.appendChild(el('td', undefined, fmtDate(c.created_at)));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  inviteList.appendChild(table);
}

async function loadOverview(): Promise<void> {
  const { stats } = await api<{ stats: AdminStats }>('/api/admin/stats');
  overview.className = '';
  overview.textContent = `全站解读 ${stats.total_readings} 次 · 今日 AI 使用 ${stats.global_used_today}/${stats.global_limit} · 用户 ${stats.users.length} 人`;
}

async function boot(): Promise<void> {
  try {
    const me = await api<{ user: { role: string } }>('/api/me');
    if (me.user.role !== 'admin') {
      denied.hidden = false;
      return;
    }
    content.hidden = false;
    await Promise.all([loadOverview(), loadUsers(), loadInvites()]);
  } catch {
    denied.hidden = false;
  }
}

document.getElementById('nu-submit')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  nuMsg.hidden = true;
  btn.setAttribute('disabled', 'true');
  const get = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();
  const limitRaw = get('nu-limit');
  try {
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        username: get('nu-username'),
        password: get('nu-password'),
        role: (document.getElementById('nu-role') as HTMLSelectElement).value,
        daily_ai_limit: limitRaw === '' ? null : Number(limitRaw),
      }),
    });
    nuMsg.textContent = '用户已创建。';
    nuMsg.classList.remove('error');
    nuMsg.hidden = false;
    (document.getElementById('nu-username') as HTMLInputElement).value = '';
    (document.getElementById('nu-password') as HTMLInputElement).value = '';
    (document.getElementById('nu-limit') as HTMLInputElement).value = '';
    void loadUsers();
    void loadOverview();
  } catch (err) {
    fail(err);
  } finally {
    btn.removeAttribute('disabled');
  }
});

document.getElementById('invite-btn')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  btn.setAttribute('disabled', 'true');
  try {
    const res = await api<{ invite_code: { code: string } }>('/api/admin/invite-codes', { method: 'POST' });
    inviteNew.textContent = `新邀请码：${res.invite_code.code}（复制后发给受邀人，一次性使用）`;
    inviteNew.hidden = false;
    void loadInvites();
  } catch (err) {
    fail(err, inviteNew);
  } finally {
    btn.removeAttribute('disabled');
  }
});

void boot();
