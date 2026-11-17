import { buildInterpretSystemPrompt, buildInterpretUserPrompt, getCard, getSpread } from '@tarot/shared';
import type { InterpretationPayload, PromptInput } from '@tarot/shared';
import type { Env } from './env';

// AI 调用：OpenAI-compatible /chat/completions。
// API_KEY 只存在于 Worker 环境变量（Cloudflare Secrets），前端永不接触。
//
// B2：约定模型输出严格 JSON（system prompt 固化契约），此处解析并校验，
//     位置/牌名/正逆位用请求里的权威数据回填，不信任模型复述；
//     解析失败 → 降级 { format: 'text' }，绝不伪装成结构化解读。
// B4：网络错误/超时/上游 429/5xx 自动重试一次（800ms 退避）；其余 4xx 不重试。
// B5：捕获响应 usage（prompt/completion tokens）交由调用方记账。
// A4：streamAI 以增量回调输出原始增量文本，最终仍走同一 JSON 解析。

export class AIUpstreamError extends Error {
  readonly detail: string;
  readonly retryable: boolean;
  constructor(detail: string, retryable = false) {
    super('AI 上游请求失败');
    this.detail = detail;
    this.retryable = retryable;
  }
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface StreamChunk {
  choices?: { delta?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface AIResult {
  payload: InterpretationPayload;
  model: string;
  usage: AIUsage | null;
}

const RETRY_DELAY_MS = 800;
const NON_STREAM_TIMEOUT_MS = 30000;
const STREAM_TIMEOUT_MS = 60000;

function buildBody(env: Env, input: PromptInput, recentContext: string[] | undefined, stream: boolean): string {
  return JSON.stringify({
    model: env.MODEL_NAME,
    max_tokens: Number(env.MAX_TOKENS ?? '900') || 900,
    temperature: Number(env.TEMPERATURE ?? '0.8') || 0.8,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildInterpretSystemPrompt() },
      { role: 'user', content: buildInterpretUserPrompt(input, recentContext) },
    ],
  });
}

async function postUpstream(env: Env, body: string, timeoutMs: number): Promise<Response> {
  const base = env.API_BASE_URL.replace(/\/+$/, '');
  try {
    return await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.API_KEY}`,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new AIUpstreamError(e instanceof Error ? e.message : '网络错误', true);
  }
}

/** B4：可重试错误（网络/超时/429/5xx）自动重试一次；其余 4xx 直接失败 */
async function postWithRetry(env: Env, body: string, timeoutMs: number): Promise<Response> {
  let first: Response;
  try {
    first = await postUpstream(env, body, timeoutMs);
  } catch (e) {
    if (e instanceof AIUpstreamError && e.retryable) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return postUpstream(env, body, timeoutMs);
    }
    throw e;
  }
  if (first.status === 429 || first.status >= 500) {
    const firstStatus = first.status;
    try {
      first.body?.cancel();
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    const second = await postUpstream(env, body, timeoutMs);
    if (second.status === 429 || second.status >= 500) {
      let bodyText = '';
      try {
        bodyText = (await second.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      throw new AIUpstreamError(`HTTP ${firstStatus} → 重试仍失败 HTTP ${second.status} ${bodyText}`);
    }
    return second;
  }
  if (!first.ok) {
    let bodyText = '';
    try {
      bodyText = (await first.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new AIUpstreamError(`HTTP ${first.status} ${bodyText}`);
  }
  return first;
}

/**
 * 解析模型输出为结构化解读。
 * index → 位置/牌名/正逆位 用请求里的权威数据回填；模型只贡献 analysis/synthesis/reflection。
 * 任何校验失败 → 纯文本降级。
 */
export function parseInterpretation(content: string, input: PromptInput): InterpretationPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { format: 'text', text: content };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { format: 'text', text: content };
  }
  const obj = parsed as Record<string, unknown>;
  const spread = getSpread(input.spread);
  if (!spread) return { format: 'text', text: content };

  const rawCards = Array.isArray(obj.cards) ? obj.cards : null;
  const synthesis = typeof obj.synthesis === 'string' ? obj.synthesis.trim() : '';
  if (!rawCards || rawCards.length !== input.cards.length || !synthesis) {
    return { format: 'text', text: content };
  }

  const seen = new Set<number>();
  const analysisByIndex: string[] = new Array(input.cards.length).fill('');
  for (let i = 0; i < rawCards.length; i++) {
    const item = rawCards[i] as Record<string, unknown> | null;
    if (!item || typeof item !== 'object') return { format: 'text', text: content };
    const idx = Number(item.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= input.cards.length || seen.has(idx)) {
      return { format: 'text', text: content };
    }
    seen.add(idx);
    const analysis = typeof item.analysis === 'string' ? item.analysis.trim() : '';
    if (!analysis) return { format: 'text', text: content };
    analysisByIndex[idx] = analysis;
  }

  // 展示顺序永远跟随牌阵位置顺序（index 0..n-1），不受模型返回顺序影响
  const cards = analysisByIndex.map((analysis, idx) => {
    const drawn = input.cards[idx]!;
    const card = getCard(drawn.card);
    const pos = spread.positions[idx];
    return {
      position: pos?.labelZh ?? drawn.position,
      name: card?.nameZh ?? drawn.card,
      orientation: drawn.orientation === 'upright' ? '正位' : '逆位',
      analysis,
    };
  });

  const reflection = Array.isArray(obj.reflection)
    ? obj.reflection
        .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        .map((r) => r.trim())
        .slice(0, 3)
    : [];

  return { format: 'structured', cards, synthesis, reflection };
}

function extractUsage(data: ChatCompletionResponse): AIUsage | null {
  const u = data.usage;
  if (!u || typeof u !== 'object') return null;
  const p = Number(u.prompt_tokens);
  const c = Number(u.completion_tokens);
  if (!Number.isFinite(p) && !Number.isFinite(c)) return null;
  return { promptTokens: Number.isFinite(p) ? p : 0, completionTokens: Number.isFinite(c) ? c : 0 };
}

/** 非流式调用：返回解析后的解读与 usage */
export async function callAI(env: Env, input: PromptInput, recentContext?: string[]): Promise<AIResult> {
  const body = buildBody(env, input, recentContext, false);
  const resp = await postWithRetry(env, body, NON_STREAM_TIMEOUT_MS);

  let data: ChatCompletionResponse;
  try {
    data = (await resp.json()) as ChatCompletionResponse;
  } catch {
    throw new AIUpstreamError('响应不是合法 JSON');
  }
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new AIUpstreamError('AI 返回内容为空');
  return { payload: parseInterpretation(content, input), model: env.MODEL_NAME, usage: extractUsage(data) };
}

/**
 * 流式调用（A4）：
 * - onDelta(delta) 在每个上游增量到达时回调（delta 为增量文本，非全量）；
 * - 只有在尚未收到任何增量前的失败才允许重试（已开始输出的流无法安全重来）；
 * - 结束后走与 callAI 相同的 JSON 解析；usage 取自流内带 usage 的块。
 */
export async function streamAI(
  env: Env,
  input: PromptInput,
  recentContext: string[] | undefined,
  onDelta: (delta: string) => void | Promise<void>
): Promise<AIResult> {
  const body = buildBody(env, input, recentContext, true);
  const resp = await postWithRetry(env, body, STREAM_TIMEOUT_MS);
  if (!resp.body) throw new AIUpstreamError('上游流式响应为空');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let usage: AIUsage | null = null;
  let gotDelta = false;

  const handleChunkLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const dataStr = trimmed.slice(5).trim();
    if (!dataStr || dataStr === '[DONE]') return;
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(dataStr) as StreamChunk;
    } catch {
      return;
    }
    if (chunk.usage) usage = extractUsage({ usage: chunk.usage });
    const delta = chunk.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) {
      gotDelta = true;
      accumulated += delta;
      void onDelta(delta);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        handleChunkLine(line);
      }
    }
    if (buffer.length > 0) handleChunkLine(buffer);
  } catch (e) {
    // 已开始输出后中断：不能再重试，按上游错误处理
    const msg = e instanceof Error ? e.message : '网络错误';
    throw new AIUpstreamError(gotDelta ? `流式输出中断：${msg}` : msg, !gotDelta);
  }

  const content = accumulated.trim();
  if (!content) throw new AIUpstreamError('AI 返回内容为空');
  return { payload: parseInterpretation(content, input), model: env.MODEL_NAME, usage };
}
