import {
  ERR,
  isReadingMode,
  isSpreadId,
  shanghaiDate,
  validateCards,
  validateMoodTag,
  validateQuestion,
  validateTopicTag,
  type DrawnCard,
  type InterpretRequest,
  type InterpretResponse,
  type ReadingMode,
  type SpreadId,
} from '@tarot/shared';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { AIUpstreamError, callAI, streamAI } from '../ai';
import type { UserRow } from '../auth';
import type { Env } from '../env';
import {
  getGlobalDailyLimit,
  getGlobalUsage,
  getUserDailyLimit,
  getUserUsage,
  recordTokenUsage,
  releaseQuota,
  releaseUserQuota,
  resetAtISO,
  tryConsumeGlobalQuota,
  tryConsumeUserQuota,
} from '../quota';

export const interpretRoutes = new Hono<{ Bindings: Env; Variables: { user: UserRow } }>();

type AppContext = Context<{ Bindings: Env; Variables: { user: UserRow } }>;

interface ValidatedInput {
  mode: ReadingMode;
  question: string;
  spread: SpreadId;
  cards: DrawnCard[];
  mood_tag: string | null;
  topic_tag: string | null;
  include_context: boolean;
}

/**
 * 强制顺序：登录(requireAuth) → 个人额度(原子) → 全站额度(原子) → 输入校验 → 调 AI。
 * 额度占用失败或 AI 失败：明确错误码；AI 失败时双表退还，绝不降级输出伪装解读。
 */
async function prepare(c: AppContext): Promise<{ input: ValidatedInput; date: string; dailyLimit: number; globalLimit: number; recentContext: string[] } | Response> {
  const user = c.get('user');
  const date = shanghaiDate();
  const dailyLimit = await getUserDailyLimit(c.env.DB, user.daily_ai_limit);
  const globalLimit = await getGlobalDailyLimit(c.env.DB, c.env);

  // 个人额度：原子自增，count < limit 才成功。所有角色都必须由管理员显式分配，0 额度不能调用 AI。
  if (!(await tryConsumeUserQuota(c.env.DB, user.id, dailyLimit, date))) {
    const usedToday = await getUserUsage(c.env.DB, user.id, date);
    return c.json(
      {
        error: {
          code: ERR.QUOTA_USER,
          message:
            dailyLimit === 0
              ? '管理员尚未为你分配 AI 解读额度，请联系管理员。'
              : `今日个人 AI 解读额度已用完（${usedToday}/${dailyLimit}），额度将于每日午夜（Asia/Shanghai）重置。`,
        },
        quota: { daily_limit: dailyLimit, used_today: usedToday, remaining: 0, global_limit: globalLimit, reset_at: resetAtISO() },
      },
      429
    );
  }

  // 全站额度：原子自增；失败时只退还刚占用的个人额度（全站未自增）。
  if (!(await tryConsumeGlobalQuota(c.env.DB, globalLimit, date))) {
    await releaseUserQuota(c.env.DB, user.id, date);
    const globalUsed = await getGlobalUsage(c.env.DB, date);
    return c.json(
      {
        error: {
          code: ERR.QUOTA_GLOBAL,
          message: `今日全站 AI 解读额度已用完（${globalUsed}/${globalLimit}），额度将于每日午夜（Asia/Shanghai）重置。`,
        },
      },
      429
    );
  }

  // 输入校验（额度之后，保持既有顺序契约：额度耗尽时非法输入也返回 429）
  let body: Partial<InterpretRequest>;
  try {
    body = (await c.req.json()) as Partial<InterpretRequest>;
  } catch {
    await releaseQuota(c.env.DB, user.id, date);
    return c.json({ error: { code: ERR.VALIDATION, message: '请求体必须是 JSON' } }, 400);
  }
  const mode = body.mode;
  if (!isReadingMode(mode)) {
    await releaseQuota(c.env.DB, user.id, date);
    return c.json({ error: { code: ERR.VALIDATION, message: 'mode 必须是 online 或 offline' } }, 400);
  }
  const spread = body.spread;
  if (!isSpreadId(spread)) {
    await releaseQuota(c.env.DB, user.id, date);
    return c.json({ error: { code: ERR.VALIDATION, message: '未知的牌阵' } }, 400);
  }
  const question = validateQuestion(body.question);
  if (!question) {
    await releaseQuota(c.env.DB, user.id, date);
    return c.json({ error: { code: ERR.VALIDATION, message: '问题不能为空且不超过 500 字' } }, 400);
  }
  const cardsResult = validateCards(spread, body.cards);
  if (!cardsResult.ok) {
    await releaseQuota(c.env.DB, user.id, date);
    return c.json({ error: { code: ERR.VALIDATION, message: cardsResult.reason } }, 400);
  }
  const mood = validateMoodTag(body.mood_tag);
  const topic = validateTopicTag(body.topic_tag);
  const includeContext = body.include_context === true;

  // B3：仅当用户显式同意时，取其最近 5 条记录的问题/主题摘要（不含解读内容）注入 prompt
  let recentContext: string[] = [];
  if (includeContext) {
    const rows = await c.env.DB.prepare(
      'SELECT question, topic_tag FROM readings WHERE user_id = ? ORDER BY created_at DESC LIMIT 5'
    )
      .bind(user.id)
      .all<{ question: string; topic_tag: string | null }>();
    recentContext = (rows.results ?? []).map((r) => `（${r.topic_tag ?? '未分类'}）${(r.question ?? '').slice(0, 80)}`);
  }

  return {
    date,
    dailyLimit,
    globalLimit,
    recentContext,
    input: {
      mode,
      question,
      spread,
      cards: cardsResult.cards,
      mood_tag: mood,
      topic_tag: topic,
      include_context: includeContext,
    },
  };
}

const AI_FAIL_MESSAGE = 'AI 解读服务暂时不可用，本次调用未计入额度。基础牌义仍可查看，请稍后重试。';

// POST /api/interpret — 非流式（保留给兼容与测试；前端主用 /stream）
interpretRoutes.post('/', async (c) => {
  const prepared = await prepare(c);
  if (prepared instanceof Response) return prepared;
  const { input, date, dailyLimit, recentContext } = prepared;
  const user = c.get('user');

  try {
    const { payload, model, usage } = await callAI(
      c.env,
      {
        mode: input.mode,
        question: input.question,
        spread: input.spread,
        cards: input.cards,
        mood_tag: input.mood_tag,
        topic_tag: input.topic_tag,
      },
      recentContext.length > 0 ? recentContext : undefined
    );
    if (usage) await recordTokenUsage(c.env.DB, user.id, usage.promptTokens, usage.completionTokens, date);
    const finalUsed = await getUserUsage(c.env.DB, user.id, date);
    const body: InterpretResponse = {
      interpretation: payload,
      model,
      quota: {
        daily_limit: dailyLimit,
        used_today: finalUsed,
        remaining: Math.max(dailyLimit - finalUsed, 0),
      },
    };
    return c.json(body);
  } catch (e) {
    await releaseQuota(c.env.DB, user.id, date);
    const detail = e instanceof AIUpstreamError ? e.detail : '未知错误';
    console.error('AI upstream request failed:', detail);
    return c.json({ error: { code: ERR.AI_UPSTREAM, message: AI_FAIL_MESSAGE } }, 502);
  }
});

// POST /api/interpret/stream — SSE 流式（A4 打字机效果）
// 事件：delta {t} / done {InterpretResponse} / error {error}
interpretRoutes.post('/stream', async (c) => {
  const prepared = await prepare(c);
  if (prepared instanceof Response) return prepared;
  const { input, date, dailyLimit, recentContext } = prepared;
  const user = c.get('user');

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true; // 客户端已断开：停止发送，但继续读完上游以保证记账正确
        }
      };
      try {
        const { payload, model, usage } = await streamAI(
          c.env,
          {
            mode: input.mode,
            question: input.question,
            spread: input.spread,
            cards: input.cards,
            mood_tag: input.mood_tag,
            topic_tag: input.topic_tag,
          },
          recentContext.length > 0 ? recentContext : undefined,
          (delta) => send('delta', { t: delta })
        );
        if (usage) await recordTokenUsage(c.env.DB, user.id, usage.promptTokens, usage.completionTokens, date);
        const finalUsed = await getUserUsage(c.env.DB, user.id, date);
        const body: InterpretResponse = {
          interpretation: payload,
          model,
          quota: {
            daily_limit: dailyLimit,
            used_today: finalUsed,
            remaining: Math.max(dailyLimit - finalUsed, 0),
          },
        };
        send('done', body);
      } catch (e) {
        await releaseQuota(c.env.DB, user.id, date);
        const detail = e instanceof AIUpstreamError ? e.detail : '未知错误';
        console.error('AI upstream stream failed:', detail);
        send('error', { error: { code: ERR.AI_UPSTREAM, message: AI_FAIL_MESSAGE } });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return c.body(stream, 200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });
});
