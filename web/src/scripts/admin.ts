import type { AdminInviteRow, AdminStats, AdminUserRow } from '@tarot/shared';
import { ApiError, api, el, fmtDate } from '../lib/api';

const content = document.getElementById('content') as HTMLDivElement;
const denied = document.getElementById('denied') as HTMLDivElement;
const overview = document.getElementById('overview') as HTMLDivElement;
const userTable = document.getElementById('user-table') as HTMLDivElement;
const userMsg = document.getElementById('user-msg') as HTMLDivElement;
const inviteList = document.getElementById('invite-list') as HTMLDivElement;
const inviteNew = document.getElementById('invite-new') as HTMLDivElement;
const nuMsg = document.getElementById('nu-msg') as HTMLDivElement;
const dialog = document.getElementById('admin-dialog') as HTMLDialogElement;
const dialogForm = document.getElementById('admin-dialog-form') as HTMLFormElement;
const dialogTitle = document.getElementById('admin-dialog-title') as HTMLHeadingElement;
const dialogDescription = document.getElementById('admin-dialog-description') as HTMLParagraphElement;
const dialogLabel = document.getElementById('admin-dialog-label') as HTMLLabelElement;
const dialogInput = document.getElementById('admin-dialog-input') as HTMLInputElement;
const dialogReveal = document.getElementById('admin-dialog-reveal') as HTMLInputElement;
const dialogRevealWrap = document.getElementById('admin-dialog-reveal-wrap') as HTMLLabelElement;
const dialogCancel = document.getElementById('admin-dialog-cancel') as HTMLButtonElement;

function fail(err: unknown, box: HTMLElement = nuMsg): void {
  box.textContent = err instanceof ApiError ? err.message : '操作失败';
  box.classList.add('error');
  box.hidden = false;
}

function showUserMessage(message: string, isError = false): void {
  userMsg.textContent = message;
  userMsg.classList.toggle('error', isError);
  userMsg.hidden = false;
}

function tableScroll(table: HTMLTableElement, wide = false): HTMLElement {
  const wrap = el('div', 'table-scroll');
  if (wide) table.classList.add('wide');
  wrap.appendChild(table);
  return wrap;
}

interface ValueDialogOptions {
  title: string;
  description: string;
  label: string;
  type: 'text' | 'password' | 'number';
  value?: string;
  placeholder?: string;
  confirmText?: string;
}

let dialogResolve: ((value: string | null) => void) | null = null;

function settleDialog(value: string | null): void {
  const resolve = dialogResolve;
  dialogResolve = null;
  if (dialog.open) dialog.close();
  resolve?.(value);
}

function askValue(options: ValueDialogOptions): Promise<string | null> {
  dialogTitle.textContent = options.title;
  dialogDescription.textContent = options.description;
  dialogLabel.textContent = options.label;
  dialogInput.type = options.type;
  dialogInput.value = options.value ?? '';
  dialogInput.placeholder = options.placeholder ?? '';
  dialogInput.min = options.type === 'number' ? '0' : '';
  dialogInput.max = options.type === 'number' ? '10000' : '';
  dialogInput.step = options.type === 'number' ? '1' : '';
  dialogInput.inputMode = options.type === 'number' ? 'numeric' : 'text';
  dialogReveal.checked = false;
  dialogRevealWrap.hidden = options.type !== 'password';
  const confirm = document.getElementById('admin-dialog-confirm') as HTMLButtonElement;
  confirm.textContent = options.confirmText ?? '确认';
  dialog.showModal();
  dialogInput.focus();
  dialogInput.select();
  return new Promise((resolve) => {
    dialogResolve = resolve;
  });
}

dialogReveal.addEventListener('change', () => {
  if (!dialogRevealWrap.hidden) {
    dialogInput.type = dialogReveal.checked ? 'text' : 'password';
  }
});
dialogForm.addEventListener('submit', (event) => {
  event.preventDefault();
  settleDialog(dialogInput.value);
});
dialogCancel.addEventListener('click', () => settleDialog(null));
dialog.addEventListener('close', () => {
  if (dialogResolve) {
    const resolve = dialogResolve;
    dialogResolve = null;
    resolve(null);
  }
});

async function loadUsers(): Promise<void> {
  const { users } = await api<{ users: AdminUserRow[] }>('/api/admin/users');
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
    tr.appendChild(el('td', undefined, String(u.remaining)));
    tr.appendChild(el('td', undefined, u.is_active ? '正常' : '已停用'));

    const ops = el('td');
    // 调整额度
    const limitBtn = el('button', 'linklike', '调额度');
    limitBtn.addEventListener('click', async () => {
      const input = await askValue({
        title: `调整 ${u.username} 的额度`,
        description: '可输入 0–10000 的整数；0 表示暂停该用户的 AI 解读。',
        label: '每日 AI 解读额度',
        type: 'number',
        value: String(u.daily_ai_limit ?? 0),
        placeholder: '0',
      });
      if (input === null) return;
      const value = input.trim() === '' ? null : Number(input);
      if (value !== null && (!Number.isInteger(value) || value < 0 || value > 10000)) {
        showUserMessage('每日额度必须是 0–10000 的整数。0 表示不可使用 AI。', true);
        return;
      }
      try {
        await api(`/api/admin/users/${u.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ daily_ai_limit: value }),
        });
        void loadUsers();
      } catch (err) {
        fail(err, userMsg);
      }
    });
    ops.appendChild(limitBtn);
    ops.appendChild(document.createTextNode(' · '));
    // 重置密码
    const pwBtn = el('button', 'linklike', '重置密码');
    pwBtn.addEventListener('click', async () => {
      const pw = await askValue({
        title: `重置 ${u.username} 的密码`,
        description: '至少 8 位。确认后该用户所有现有会话会立即失效，新密码不会在页面再次显示。',
        label: '新密码',
        type: 'password',
        confirmText: '重置密码',
      });
      if (pw === null) return;
      if (pw.length < 8) {
        showUserMessage('新密码至少需要 8 位。', true);
        return;
      }
      try {
        await api(`/api/admin/users/${u.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ new_password: pw }),
        });
        showUserMessage(`已重置 ${u.username} 的密码。新密码不会在页面再次显示，请安全地通知对方。`);
      } catch (err) {
        fail(err, userMsg);
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
          fail(err, userMsg);
        }
      });
      ops.appendChild(toggleBtn);
    }
    tr.appendChild(ops);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  userTable.appendChild(tableScroll(table, true));
}

function inviteStatusText(c: AdminInviteRow): string {
  if (c.status === 'active') return '有效';
  if (c.status === 'redeemed') return '已使用';
  if (c.status === 'expired') return '已过期';
  return '已撤销';
}

async function loadInvites(): Promise<void> {
  const { invite_codes } = await api<{ invite_codes: AdminInviteRow[] }>('/api/admin/invite-codes');
  inviteList.innerHTML = '';
  if (invite_codes.length === 0) {
    inviteList.appendChild(el('p', 'muted', '还没有邀请码。'));
    return;
  }
  const table = el('table', 'data');
  const thead = el('thead');
  const trh = el('tr');
  for (const t of ['邀请码', '状态', '有效期至', '使用者', '创建时间', '操作']) trh.appendChild(el('th', undefined, t));
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const c of invite_codes) {
    const tr = el('tr');
    tr.appendChild(el('td', undefined, c.code));
    tr.appendChild(el('td', undefined, inviteStatusText(c)));
    tr.appendChild(el('td', undefined, c.expires_at ? fmtDate(c.expires_at) : '长期有效'));
    tr.appendChild(el('td', undefined, c.redeemed_by ?? '—'));
    tr.appendChild(el('td', undefined, fmtDate(c.created_at)));
    const ops = el('td');
    if (c.status === 'active') {
      const revoke = el('button', 'linklike', '撤销') as HTMLButtonElement;
      revoke.addEventListener('click', async () => {
        try {
          await api(`/api/admin/invite-codes/${encodeURIComponent(c.code)}`, {
            method: 'PATCH',
            body: JSON.stringify({ action: 'revoke' }),
          });
          void loadInvites();
          void loadOverview();
        } catch (err) {
          fail(err, inviteNew);
        }
      });
      ops.appendChild(revoke);
    } else {
      ops.textContent = '—';
    }
    tr.appendChild(ops);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  inviteList.appendChild(tableScroll(table, true));
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
    let dailyLimit: number | null = null;
    if (limitRaw !== '') {
      dailyLimit = Number(limitRaw);
      if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 10000) {
        nuMsg.textContent = '每日额度必须是 0–10000 的整数。0 表示不可使用 AI。';
        nuMsg.classList.add('error');
        nuMsg.hidden = false;
        return;
      }
    }
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        username: get('nu-username'),
        password: get('nu-password'),
        role: (document.getElementById('nu-role') as HTMLSelectElement).value,
        daily_ai_limit: dailyLimit,
      }),
    });
    nuMsg.textContent = '用户已创建。';
    nuMsg.classList.remove('error');
    nuMsg.hidden = false;
    (document.getElementById('nu-username') as HTMLInputElement).value = '';
    (document.getElementById('nu-password') as HTMLInputElement).value = '';
    (document.getElementById('nu-limit') as HTMLInputElement).value = '0';
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
    const res = await api<{ invite_code: { code: string; expires_at: string } }>('/api/admin/invite-codes', {
      method: 'POST',
    });
    inviteNew.classList.remove('error');
    inviteNew.textContent = `新邀请码：${res.invite_code.code}（7 天内有效、一次性使用）`;
    inviteNew.hidden = false;
    void loadInvites();
  } catch (err) {
    fail(err, inviteNew);
  } finally {
    btn.removeAttribute('disabled');
  }
});

void boot();
