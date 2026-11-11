import { buildInterpretSystemPrompt, buildInterpretUserPrompt } from '@tarot/shared';
import type { PromptInput } from '@tarot/shared';
import type { Env } from './env';

// AI 调用：OpenAI-compatible /chat/completions。
// API_KEY 只存在于 Worker 环境变量（Cloudflare Secrets），前端永不接触。

export class AIUpstreamError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super('AI 上游请求失败');
    this.detail = detail;
  }
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

export async function callAI(env: Env, input: PromptInput): Promise<{ content: string; model: string }> {
  const base = env.API_BASE_URL.replace(/\/+$/, '');
  const model = env.MODEL_NAME;
  const maxTokens = Number(env.MAX_TOKENS ?? '900') || 900;
  const temperature = Number(env.TEMPERATURE ?? '0.8');

  let resp: Response;
  try {
    resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.API_KEY}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: 'system', content: buildInterpretSystemPrompt() },
          { role: 'user', content: buildInterpretUserPrompt(input) },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new AIUpstreamError(e instanceof Error ? e.message : '网络错误');
  }

  if (!resp.ok) {
    let body = '';
    try {
      body = (await resp.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new AIUpstreamError(`HTTP ${resp.status} ${body}`);
  }

  let data: ChatCompletionResponse;
  try {
    data = (await resp.json()) as ChatCompletionResponse;
  } catch {
    throw new AIUpstreamError('响应不是合法 JSON');
  }
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new AIUpstreamError('AI 返回内容为空');
  return { content, model };
}
