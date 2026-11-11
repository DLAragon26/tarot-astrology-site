import { SHANGHAI_TZ } from './constants';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHANGHAI_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 当前时刻对应的 Asia/Shanghai 日期，YYYY-MM-DD（额度按此重置） */
export function shanghaiDate(d: Date = new Date()): string {
  return fmt.format(d);
}

/** 下一重置时刻（下一 Shanghai 午夜）的 UTC ISO 字符串 */
export function nextShanghaiMidnightISO(d: Date = new Date()): string {
  const today = shanghaiDate(d);
  const [y, m, day] = today.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, day + 1, 0, 0, 0) - 8 * 3600 * 1000);
  return next.toISOString();
}
