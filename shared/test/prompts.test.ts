import { describe, expect, it } from 'vitest';
import { buildInterpretSystemPrompt, buildInterpretUserPrompt } from '../src/prompts';

describe('AI prompt 构造', () => {
  it('system prompt 固化全部安全边界', () => {
    const p = buildInterpretSystemPrompt();
    expect(p).toContain('心理反思');
    expect(p).toContain('医疗');
    expect(p).toContain('投资');
    expect(p).toContain('法律');
    expect(p).toContain('宿命论');
    expect(p).toContain('简体中文');
    expect(p).toContain('正位或逆位');
    expect(p).toContain('300');
  });

  it('user prompt 引用问题、位置、牌名与正逆位', () => {
    const p = buildInterpretUserPrompt({
      mode: 'offline',
      question: '我该如何面对这次变动？',
      spread: 'three-card',
      cards: [
        { position: 'past', card: 'rw-13-death', orientation: 'upright' },
        { position: 'present', card: 'rw-16-tower', orientation: 'reversed' },
        { position: 'future', card: 'rw-17-star', orientation: 'upright' },
      ],
      topic_tag: '事业',
      mood_tag: '焦虑',
    });
    expect(p).toContain('我该如何面对这次变动？');
    expect(p).toContain('过去');
    expect(p).toContain('死神');
    expect(p).toContain('正位');
    expect(p).toContain('高塔');
    expect(p).toContain('逆位');
    expect(p).toContain('星星');
    expect(p).toContain('线下手动录入');
    expect(p).toContain('事业');
    expect(p).toContain('焦虑');
  });
});
