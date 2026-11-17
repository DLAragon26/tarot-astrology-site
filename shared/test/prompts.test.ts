import { describe, expect, it } from 'vitest';
import { buildInterpretSystemPrompt, buildInterpretUserPrompt } from '../src/prompts';

describe('AI prompt 构造', () => {
  it('system prompt 固化全部安全边界与 JSON 输出契约', () => {
    const p = buildInterpretSystemPrompt();
    expect(p).toContain('心理反思');
    expect(p).toContain('医疗');
    expect(p).toContain('投资');
    expect(p).toContain('法律');
    expect(p).toContain('宿命论');
    expect(p).toContain('简体中文');
    expect(p).toContain('正位或逆位');
    expect(p).toContain('JSON');
    expect(p).toContain('"cards"');
    expect(p).toContain('"synthesis"');
    expect(p).toContain('"reflection"');
    expect(p).toContain('index');
  });

  it('user prompt 引用问题、位置、牌名与正逆位，并带 index 序号', () => {
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
    expect(p).toContain('index 0');
    expect(p).toContain('index 2');
  });

  it('未开启上下文时不注入最近记录背景', () => {
    const p = buildInterpretUserPrompt({
      mode: 'online',
      question: '测试',
      spread: 'single',
      cards: [{ position: 'focus', card: 'rw-00-fool', orientation: 'upright' }],
    });
    expect(p).not.toContain('最近记录背景');
  });

  it('传入 recentContext 时注入背景段落', () => {
    const p = buildInterpretUserPrompt(
      {
        mode: 'online',
        question: '测试',
        spread: 'single',
        cards: [{ position: 'focus', card: 'rw-00-fool', orientation: 'upright' }],
      },
      ['（事业）最近的工作状态如何？', '（感情）与家人的沟通。']
    );
    expect(p).toContain('最近记录背景');
    expect(p).toContain('（事业）最近的工作状态如何？');
    expect(p).toContain('不要逐条复述');
  });
});
