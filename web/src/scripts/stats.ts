import { getSpread } from '@tarot/shared';
import type { AdminStats, CountRow, QuotaInfo, ReadingStats } from '@tarot/shared';
import { ApiError, api, el, fmtDate } from '../lib/api';

const content = document.getElementById('content') as HTMLDivElement;
const quotaLine = document.getElementById('quota-line') as HTMLDivElement;
const adminBlock = document.getElementById('admin-block') as HTMLDivElement;
const adminContent = document.getElementById('admin-content') as HTMLDivElement;
const scopeTitle = document.getElementById('scope-title') as HTMLHeadingElement;
const errBox = document.getElementById('err') as HTMLDivElement;

function err(err_: unknown): void {
  errBox.textContent = err_ instanceof ApiError ? err_.message : '加载失败';
  errBox.hidden = false;
}

function h2(text: string): HTMLElement {
  return el('h2', undefined, text);
}

function tableScroll(table: HTMLTableElement, wide = false): HTMLElement {
  const wrap = el('div', 'table-scroll');
  if (wide) table.classList.add('wide');
  wrap.appendChild(table);
  return wrap;
}

function barRows(title: string, rows: CountRow[], labelFn: (r: CountRow) => string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.appendChild(h2(title));
  const max = Math.max(...rows.map((r) => r.count), 1);
  if (rows.length === 0) {
    wrap.appendChild(el('p', 'muted', '暂无数据'));
    return wrap;
  }
  for (const r of rows) {
    const row = el('div', 'bar-row');
    row.appendChild(el('span', 'label', labelFn(r)));
    const bar = el('div', 'bar');
    bar.style.width = `${Math.round((r.count / max) * 100)}%`;
    row.appendChild(bar);
    row.appendChild(el('span', 'num', String(r.count)));
    wrap.appendChild(row);
  }
  return wrap;
}

function renderStats(stats: ReadingStats): void {
  scopeTitle.textContent = stats.scope === 'all' ? '统计（全站）' : '统计';

  const top = el('div', 'panel');
  top.appendChild(el('p'));
  top.lastChild?.appendChild(el('strong', undefined, `总解读次数：${stats.total}`));
  top.appendChild(document.createTextNode('  '));
  top.appendChild(el('span', 'muted', `AI 解读累计 ${stats.ai_used_total} 次`));
  if (stats.ai_tokens_total > 0) {
    top.appendChild(document.createTextNode('  '));
    top.appendChild(el('span', 'muted', `Token 累计 ${stats.ai_tokens_total.toLocaleString()}`));
  }
  content.appendChild(top);

  // 月度趋势
  const months = el('div');
  months.appendChild(h2('月度趋势（近 12 个月）'));
  const chart = el('div', 'month-chart');
  const maxMonth = Math.max(...stats.by_month.map((m) => m.count), 1);
  for (const m of stats.by_month) {
    const col = el('div', 'col');
    const slot = el('div', 'slot');
    const v = el('div', 'v');
    v.style.height = `${Math.round((m.count / maxMonth) * 100)}%`;
    v.title = `${m.key}：${m.count} 次`;
    slot.appendChild(v);
    col.appendChild(slot);
    const label = el('span', undefined, `${Number(m.key.slice(5))}月`);
    label.title = m.key;
    col.appendChild(label);
    chart.appendChild(col);
  }
  months.appendChild(chart);
  content.appendChild(months);

  // 线上/线下
  const modes = stats.by_mode.map((r) => ({
    ...r,
    key: r.key === 'online' ? '线上' : '线下',
  }));
  content.appendChild(barRows('线上 / 线下', modes, (r) => r.key));

  // 正逆位比例
  const ori = el('div');
  ori.appendChild(h2('正逆位比例'));
  const totalOri = stats.orientations.upright + stats.orientations.reversed;
  if (totalOri === 0) {
    ori.appendChild(el('p', 'muted', '暂无数据'));
  } else {
    const pUp = Math.round((stats.orientations.upright / totalOri) * 100);
    const row = el('div', 'bar-row');
    const bar = el('div', 'bar');
    bar.style.width = `${pUp}%`;
    row.appendChild(el('span', 'label', '正位'));
    row.appendChild(bar);
    row.appendChild(el('span', 'num', `${stats.orientations.upright} / ${totalOri}（${pUp}%）`));
    ori.appendChild(row);
  }
  content.appendChild(ori);

  content.appendChild(
    barRows(
      '主题分布',
      stats.by_topic,
      (r) => r.key
    )
  );
  content.appendChild(
    barRows(
      '牌阵分布',
      stats.by_spread,
      (r) => getSpread(r.key)?.nameZh ?? r.key
    )
  );

  // 高频牌
  const topCards = el('div');
  topCards.appendChild(h2('高频牌 TOP 10'));
  if (stats.top_cards.length === 0) {
    topCards.appendChild(el('p', 'muted', '暂无数据'));
  } else {
    const table = el('table', 'data');
    const thead = el('thead');
    const trh = el('tr');
    for (const t of ['牌', '次数']) trh.appendChild(el('th', undefined, t));
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const c of stats.top_cards) {
      const tr = el('tr');
      tr.appendChild(el('td', undefined, c.nameZh));
      tr.appendChild(el('td', undefined, String(c.count)));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    topCards.appendChild(tableScroll(table));
  }
  content.appendChild(topCards);
}

async function renderAdmin(): Promise<void> {
  try {
    const { stats } = await api<{ stats: AdminStats }>('/api/admin/stats');
    adminBlock.hidden = false;
    adminContent.className = '';
    adminContent.innerHTML = '';

    const head = el('div', 'panel');
    head.appendChild(
      el(
        'p',
        undefined,
        `全站解读 ${stats.total_readings} 次 · 今日 AI 使用 ${stats.global_used_today}/${stats.global_limit} 次 · 今日 Token ${(stats.ai_tokens_today ?? 0).toLocaleString()} · 累计 Token ${(stats.ai_tokens_total ?? 0).toLocaleString()}`
      )
    );
    adminContent.appendChild(head);

    // 用户表
    const usersTitle = h2('用户与额度');
    adminContent.appendChild(usersTitle);
    const table = el('table', 'data');
    const thead = el('thead');
    const trh = el('tr');
    for (const t of ['用户', '角色', '今日 AI', '额度剩余', '记录数', '状态']) trh.appendChild(el('th', undefined, t));
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const u of stats.users) {
      const tr = el('tr');
      tr.appendChild(el('td', undefined, u.username));
      tr.appendChild(el('td', undefined, u.role === 'admin' ? '管理员' : '成员'));
      tr.appendChild(el('td', undefined, String(u.used_today)));
      tr.appendChild(el('td', undefined, String(u.remaining)));
      tr.appendChild(el('td', undefined, String(u.readings_count)));
      tr.appendChild(el('td', undefined, u.is_active ? '正常' : '已停用'));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    adminContent.appendChild(tableScroll(table, true));

    // 邀请码状态
    adminContent.appendChild(h2('邀请码状态'));
    const active = stats.invite_codes.filter((c) => c.status === 'active').length;
    const redeemed = stats.invite_codes.filter((c) => c.status === 'redeemed').length;
    const closed = stats.invite_codes.filter((c) => c.status === 'expired' || c.status === 'revoked').length;
    adminContent.appendChild(
      el('p', 'muted', `有效 ${active} · 已使用 ${redeemed} · 已过期/撤销 ${closed} · 完整管理请到「管理」页`)
    );
    if (stats.invite_codes.length > 0) {
      const last = stats.invite_codes[0];
      const statusText =
        last.status === 'active'
          ? '有效'
          : last.status === 'redeemed'
            ? `已被 ${last.redeemed_by} 使用`
            : last.status === 'expired'
              ? '已过期'
              : '已撤销';
      adminContent.appendChild(
        el('p', 'muted', `最近一个码：${last.code}（${statusText}，创建于 ${fmtDate(last.created_at)}）`)
      );
    }
  } catch {
    // member 无权访问，静默
  }
}

Promise.all([
  api<{ stats: ReadingStats }>('/api/stats'),
  api<{ quota: QuotaInfo }>('/api/quota'),
  api<{ user: { role: string } }>('/api/me'),
])
  .then(([statsRes, quotaRes, meRes]) => {
    const { quota } = quotaRes;
    quotaLine.textContent =
      quota.daily_limit === 0 && quota.used_today === 0
        ? `今日 AI 额度尚未分配（0/0）· 请联系管理员 · 全站 ${quota.global_used_today}/${quota.global_limit}`
        : `今日 AI 额度：已用 ${quota.used_today}/${quota.daily_limit} · 剩余 ${quota.remaining} · 全站 ${quota.global_used_today}/${quota.global_limit} · 每日午夜（Asia/Shanghai）重置`;
    renderStats(statsRes.stats);
    if (meRes.user.role === 'admin') void renderAdmin();
  })
  .catch((e) => err(e));
