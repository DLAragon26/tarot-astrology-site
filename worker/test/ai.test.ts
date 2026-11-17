import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIUpstreamError, callAI, parseInterpretation, streamAI } from '../src/ai';
import { sseBody, THREE_CARDS_PAYLOAD } from './helpers/env';
import { makeEnv } from './helpers/env';
import type { DrawnCard, PromptInput } from '@tarot/shared';

const input: PromptInput = {
  mode: 'online',
  question: '工作状态如何？',
  spread: 'three-card',
  cards: THREE_CARDS_PAYLOAD.cards as DrawnCard[],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('B2 parseInterpretation 结构化解析', () => {
  it('合法 JSON → 结构化，位置/牌名/正逆位由权威数据回填', () => {
    const payload = parseInterpretation(
      JSON.stringify({
        cards: [
          { index: 2, analysis: '未来位分析' },
          { index: 0, analysis: '过去位分析' },
          { index: 1, analysis: '现在位分析' },
        ],
        synthesis: '综合解读',
        reflection: ['问题一？', '', '问题二？', '问题三？', '问题四？'],
      }),
      input
    );
    expect(payload.format).toBe('structured');
    if (payload.format !== 'structured') return;
    expect(payload.cards).toHaveLength(3);
    expect(payload.cards[0]).toMatchObject({ position: '过去', name: '愚者', orientation: '正位' });
    expect(payload.cards[1]).toMatchObject({ position: '现在', name: '命运之轮', orientation: '逆位' });
    expect(payload.cards[2]).toMatchObject({ position: '未来', name: '太阳', orientation: '正位' });
    expect(payload.reflection).toEqual(['问题一？', '问题二？', '问题三？']);
  });

  it('index 越界/重复/缺失、非 JSON、空 synthesis → 纯文本降级', () => {
    const cases = [
      '不是 JSON',
      JSON.stringify({ cards: [], synthesis: 'x' }),
      JSON.stringify({ cards: [{ index: 0, analysis: 'a' }], synthesis: 'x' }),
      JSON.stringify({
        cards: [{ index: 0, analysis: 'a' }, { index: 0, analysis: 'b' }, { index: 2, analysis: 'c' }],
        synthesis: 'x',
      }),
      JSON.stringify({
        cards: [{ index: 0, analysis: 'a' }, { index: 1, analysis: 'b' }, { index: 3, analysis: 'c' }],
        synthesis: 'x',
      }),
      JSON.stringify({
        cards: [{ index: 0, analysis: 'a' }, { index: 1, analysis: 'b' }, { index: 2, analysis: '' }],
        synthesis: 'x',
      }),
      JSON.stringify({
        cards: [{ index: 0, analysis: 'a' }, { index: 1, analysis: 'b' }, { index: 2, analysis: 'c' }],
        synthesis: '',
      }),
    ];
    for (const c of cases) {
      expect(parseInterpretation(c, input).format, c.slice(0, 40)).toBe('text');
    }
  });
});

describe('B4 重试', () => {
  it('5xx 自动重试一次，第二次成功则成功', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    cards: [
                      { index: 0, analysis: 'a' },
                      { index: 1, analysis: 'b' },
                      { index: 2, analysis: 'c' },
                    ],
                    synthesis: '重试后成功',
                    reflection: [],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    const result = await callAI(makeEnv(), input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.payload.format).toBe('structured');
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it('两次 5xx 后抛 AIUpstreamError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(callAI(makeEnv(), input)).rejects.toBeInstanceOf(AIUpstreamError);
  });

  it('4xx（非 429）不重试', async () => {
    const fetchMock = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(callAI(makeEnv(), input)).rejects.toBeInstanceOf(AIUpstreamError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('A4 streamAI 增量回调', () => {
  it('按块拼接增量，最终解析结构化', async () => {
    const content = JSON.stringify({
      cards: [
        { index: 0, analysis: '流式一' },
        { index: 1, analysis: '流式二' },
        { index: 2, analysis: '流式三' },
      ],
      synthesis: '流式综合',
      reflection: ['反思？'],
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseBody(content, { prompt_tokens: 30, completion_tokens: 20 }), { status: 200 })));
    const deltas: string[] = [];
    const result = await streamAI(makeEnv(), input, undefined, (d) => {
      deltas.push(d);
    });
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe(content);
    expect(result.payload.format).toBe('structured');
    expect(result.usage).toEqual({ promptTokens: 30, completionTokens: 20 });
  });
});
