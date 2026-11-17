import {
  ERR,
  isReadingMode,
  isSpreadId,
  parseDrawnCardsJson,
  validateCards,
  validateMoodTag,
  validateOptionalText,
  validateQuestion,
  validateTopicTag,
  type Reading,
  type ReadingInput,
} from '@tarot/shared';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { UserRow } from '../auth';
import type { Env } from '../env';

export const readingRoutes = new Hono<{ Bindings: Env; Variables: { user: UserRow } }>();

type AppContext = Context<{ Bindings: Env; Variables: { user: UserRow } }>;

function notFound(c: AppContext): Response {
  return c.json({ error: { code: ERR.NOT_FOUND, message: '记录不存在' } }, 404);
}

interface ReadingRow {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  mode: 'online' | 'offline';
  question: string;
  spread: string;
  cards: string;
  ai_interpretation: string | null;
  user_note: string | null;
  mood_tag: string | null;
  topic_tag: string | null;
}

function rowToReading(row: ReadingRow): Reading | null {
  const cards = parseDrawnCardsJson(row.cards);
  if (!cards) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    mode: row.mode,
    question: row.question,
    spread: row.spread as Reading['spread'],
    cards,
    ai_interpretation: row.ai_interpretation,
    user_note: row.user_note,
    mood_tag: row.mood_tag,
    topic_tag: row.topic_tag,
  };
}

// GET /api/readings?scope=self|all&limit=&offset=
// member 只能看到自己的；admin 可用 scope=all 查看全部。
readingRoutes.get('/', async (c) => {
  const user = c.get('user');
  const scope = c.req.query('scope') === 'all' && user.role === 'admin' ? 'all' : 'self';
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '50') || 50, 1), 200);
  const offset = Math.max(Number(c.req.query('offset') ?? '0') || 0, 0);
  const modeQuery = c.req.query('mode');
  const topicQuery = c.req.query('topic');
  if (modeQuery !== undefined && !isReadingMode(modeQuery)) {
    return c.json({ error: { code: ERR.VALIDATION, message: 'mode 筛选条件不合法' } }, 400);
  }
  const topic = topicQuery === undefined ? null : validateTopicTag(topicQuery);
  if (topicQuery !== undefined && !topic) {
    return c.json({ error: { code: ERR.VALIDATION, message: 'topic 筛选条件不合法' } }, 400);
  }

  const conditions: string[] = [];
  const args: string[] = [];
  if (scope === 'self') {
    conditions.push('user_id = ?');
    args.push(user.id);
  }
  if (modeQuery) {
    conditions.push('mode = ?');
    args.push(modeQuery);
  }
  if (topic) {
    conditions.push('topic_tag = ?');
    args.push(topic);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await c.env.DB.prepare(
    `SELECT * FROM readings ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...args, limit, offset)
    .all<ReadingRow>();
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM readings ${where}`)
    .bind(...args)
    .first<{ n: number }>();
  const items = (rows.results ?? []).map(rowToReading).filter((r): r is Reading => r !== null);
  return c.json({ items, total: totalRow?.n ?? 0, scope });
});

// POST /api/readings
readingRoutes.post('/', async (c) => {
  const user = c.get('user');
  let body: Partial<ReadingInput>;
  try {
    body = (await c.req.json()) as Partial<ReadingInput>;
  } catch {
    return c.json({ error: { code: ERR.VALIDATION, message: '请求体必须是 JSON' } }, 400);
  }
  const mode = body.mode;
  const spread = body.spread;
  if (!isReadingMode(mode)) return c.json({ error: { code: ERR.VALIDATION, message: 'mode 必须是 online 或 offline' } }, 400);
  if (!isSpreadId(spread)) return c.json({ error: { code: ERR.VALIDATION, message: '未知的牌阵' } }, 400);
  const question = validateQuestion(body.question);
  if (!question) return c.json({ error: { code: ERR.VALIDATION, message: '问题不能为空且不超过 500 字' } }, 400);
  const cardsResult = validateCards(spread, body.cards);
  if (!cardsResult.ok) return c.json({ error: { code: ERR.VALIDATION, message: cardsResult.reason } }, 400);
  const note = validateOptionalText(body.user_note);
  const mood = validateMoodTag(body.mood_tag);
  const topic = validateTopicTag(body.topic_tag);
  // 前端抽牌后保存时可能已获得 AI 解读，一并入库
  const aiText = validateOptionalText(body.ai_interpretation, 8000);

  const id = crypto.randomUUID();
  const ts = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO readings (id, user_id, created_at, updated_at, mode, question, spread, cards, ai_interpretation, user_note, mood_tag, topic_tag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, user.id, ts, ts, mode, question, spread, JSON.stringify(cardsResult.cards), aiText, note, mood, topic)
    .run();

  const reading: Reading = {
    id,
    user_id: user.id,
    created_at: ts,
    updated_at: ts,
    mode,
    question,
    spread,
    cards: cardsResult.cards,
    ai_interpretation: aiText,
    user_note: note,
    mood_tag: mood,
    topic_tag: topic,
  };
  return c.json({ reading }, 201);
});

// GET /api/readings/:id — 仅本人或 admin；他人记录一律 404，不泄露存在性。
readingRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM readings WHERE id = ?').bind(id).first<ReadingRow>();
  if (!row || (user.role !== 'admin' && row.user_id !== user.id)) {
    return notFound(c);
  }
  const reading = rowToReading(row);
  if (!reading) return notFound(c);
  return c.json({ reading });
});

// PATCH /api/readings/:id — 修改问题、备注、标签（牌面与牌阵不可改）。
readingRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM readings WHERE id = ?').bind(id).first<ReadingRow>();
  if (!row || (user.role !== 'admin' && row.user_id !== user.id)) {
    return notFound(c);
  }
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: { code: ERR.VALIDATION, message: '请求体必须是 JSON' } }, 400);
  }

  const updates: string[] = [];
  const values: (string | null)[] = [];
  if ('question' in body) {
    const q = validateQuestion(body.question);
    if (!q) return c.json({ error: { code: ERR.VALIDATION, message: '问题不能为空且不超过 500 字' } }, 400);
    updates.push('question = ?');
    values.push(q);
  }
  if ('user_note' in body) {
    const note = validateOptionalText(body.user_note);
    updates.push('user_note = ?');
    values.push(note);
  }
  if ('mood_tag' in body) {
    updates.push('mood_tag = ?');
    values.push(validateMoodTag(body.mood_tag));
  }
  if ('topic_tag' in body) {
    updates.push('topic_tag = ?');
    values.push(validateTopicTag(body.topic_tag));
  }
  if (updates.length === 0) {
    return c.json({ error: { code: ERR.VALIDATION, message: '没有可更新的字段' } }, 400);
  }
  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  await c.env.DB.prepare(`UPDATE readings SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  const fresh = await c.env.DB.prepare('SELECT * FROM readings WHERE id = ?').bind(id).first<ReadingRow>();
  const reading = fresh ? rowToReading(fresh) : null;
  if (!reading) return notFound(c);
  return c.json({ reading });
});

// DELETE /api/readings/:id — 本人或 admin。
readingRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT user_id FROM readings WHERE id = ?').bind(id).first<{ user_id: string }>();
  if (!row || (user.role !== 'admin' && row.user_id !== user.id)) {
    return notFound(c);
  }
  await c.env.DB.prepare('DELETE FROM readings WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});
