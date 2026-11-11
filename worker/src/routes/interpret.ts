import {
  ERR,
  isReadingMode,
  isSpreadId,
  validateCards,
  validateMoodTag,
  validateQuestion,
  validateTopicTag,
  type InterpretRequest,
} from '@tarot/shared';
import { Hono } from 'hono';
import { AIUpstreamError, callAI } from '../ai';
import type { UserRow } from '../auth';
import type { Env } from '../env';
import {
  getGlobalDailyLimit,
  getGlobalUsage,
  getUserDailyLimit,
  getUserUsage,
  incrementUsage,
  decrementUsage,
  resetAtISO,
} from '../quota';

export const interpretRoutes = new Hono<{ Bindings: Env; Variables: { user: UserRow } }>();

/**
 * POST /api/interpret
 * 强制顺序：登录(requireAuth) → 角色 → 个人额度 → 全局额度 → 输入校验 → 计数 → 调 AI。
 * 额度耗尽或 AI 失败：返回明确错误码与原因，绝不降级输出伪装解读。
 */
interpretRoutes.post('/', async (c) => {
  const user = c.get('user');
  const isAdmin = user.role === 'admin';
  const today = new Date();
  const dailyLimit = await getUserDailyLimit(c.env.DB, user.daily_ai_limit);
  const globalLimit = await getGlobalDailyLimit(c.env.DB);

  // 个人额度（admin 无上限）
  let usedToday = 0;
  if (!isAdmin) {
    usedToday = await getUserUsage(c.env.DB, user.id);
    if (usedToday >= dailyLimit) {
      return c.json(
        {
          error: {
            code: ERR.QUOTA_USER,
            message: `今日个人 AI 解读额度已用完（${usedToday}/${dailyLimit}），额度将于每日午夜（Asia/Shanghai）重置。`,
          },
          quota: { daily_limit: dailyLimit, used_today: usedToday, remaining: 0, global_limit: globalLimit, reset_at: resetAtISO() },
        },
        429
      );
    }
  }

  // 全局额度（admin 也占用，但 admin 个人不受限；全站上限始终生效）
  const globalUsed = await getGlobalUsage(c.env.DB);
  if (globalUsed >= globalLimit) {
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

  // 输入校验
  let body: Partial<InterpretRequest>;
  try {
    body = (await c.req.json()) as Partial<InterpretRequest>;
  } catch {
    return c.json({ error: { code: ERR.VALIDATION, message: '请求体必须是 JSON' } }, 400);
  }
  const mode = body.mode;
  if (!isReadingMode(mode)) return c.json({ error: { code: ERR.VALIDATION, message: 'mode 必须是 online 或 offline' } }, 400);
  const spread = body.spread;
  if (!isSpreadId(spread)) return c.json({ error: { code: ERR.VALIDATION, message: '未知的牌阵' } }, 400);
  const question = validateQuestion(body.question);
  if (!question) return c.json({ error: { code: ERR.VALIDATION, message: '问题不能为空且不超过 500 字' } }, 400);
  const cardsResult = validateCards(spread, body.cards);
  if (!cardsResult.ok) return c.json({ error: { code: ERR.VALIDATION, message: cardsResult.reason } }, 400);
  const mood = validateMoodTag(body.mood_tag);
  const topic = validateTopicTag(body.topic_tag);

  // 计数后调用 AI；失败则退还并返回明确错误。
  await incrementUsage(c.env.DB, user.id);
  try {
    const { content, model } = await callAI(c.env, {
      mode,
      question,
      spread,
      cards: cardsResult.cards,
      mood_tag: mood,
      topic_tag: topic,
    });
    const finalUsed = await getUserUsage(c.env.DB, user.id);
    const finalLimit = isAdmin ? Number.POSITIVE_INFINITY : dailyLimit;
    return c.json({
      interpretation: content,
      model,
      quota: {
        daily_limit: isAdmin ? null : dailyLimit,
        used_today: finalUsed,
        remaining: isAdmin ? null : Math.max(Number(finalLimit) - finalUsed, 0),
      },
    });
  } catch (e) {
    await decrementUsage(c.env.DB, user.id);
    const detail = e instanceof AIUpstreamError ? e.detail : '未知错误';
    return c.json(
      {
        error: {
          code: ERR.AI_UPSTREAM,
          message: 'AI 解读服务暂时不可用，本次调用未计入额度。基础牌义仍可查看，请稍后重试。',
          detail,
        },
      },
      502
    );
  }
});
