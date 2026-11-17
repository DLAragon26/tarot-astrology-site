// Wikimedia Commons Rider-Waite 文件名 ↔ 项目稳定卡牌 ID 的纯映射逻辑。

export const MAJOR = [
  ['00', 'fool', 'The Fool'],
  ['01', 'magician', 'The Magician'],
  ['02', 'high-priestess', 'The High Priestess'],
  ['03', 'empress', 'The Empress'],
  ['04', 'emperor', 'The Emperor'],
  ['05', 'hierophant', 'The Hierophant'],
  ['06', 'lovers', 'The Lovers'],
  ['07', 'chariot', 'The Chariot'],
  ['08', 'strength', 'Strength'],
  ['09', 'hermit', 'The Hermit'],
  ['10', 'wheel-of-fortune', 'Wheel of Fortune'],
  ['11', 'justice', 'Justice'],
  ['12', 'hanged-man', 'The Hanged Man'],
  ['13', 'death', 'Death'],
  ['14', 'temperance', 'Temperance'],
  ['15', 'devil', 'The Devil'],
  ['16', 'tower', 'The Tower'],
  ['17', 'star', 'The Star'],
  ['18', 'moon', 'The Moon'],
  ['19', 'sun', 'The Sun'],
  ['20', 'judgement', 'Judgement'],
  ['21', 'world', 'The World'],
];

export const NUM_SLUG = [
  'ace',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'page',
  'knight',
  'queen',
  'king',
];

export const SUIT_MAP = {
  Wands: 'wands',
  Cups: 'cups',
  Swords: 'swords',
  Pentacles: 'pentacles',
  Pents: 'pentacles',
};

export function expectedCardTitles() {
  const cards = [];
  for (const [number, slug, title] of MAJOR) {
    cards.push({ id: `rw-${number}-${slug}`, title: `File:RWS Tarot 1910 - ${number} ${title}.png` });
  }
  for (const [suitTitle, suit] of Object.entries(SUIT_MAP).filter(([name]) => name !== 'Pents')) {
    NUM_SLUG.forEach((slug, index) => {
      const number = String(index + 1).padStart(2, '0');
      const rank =
        index === 0
          ? ' (Ace)'
          : index === 10
            ? ' (Page)'
            : index === 11
              ? ' (Knight)'
              : index === 12
                ? ' (Queen)'
                : index === 13
                  ? ' (King)'
                  : '';
      cards.push({
        id: `rw-${number}-${slug}-${suit}`,
        title: `File:RWS Tarot 1910 - ${suitTitle} ${number}${rank}.png`,
      });
    });
  }
  return cards;
}

function normalizedWords(value) {
  return value
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function mapCommonsTitleToCardId(title) {
  const clean = title
    .replace(/^File:/i, '')
    .replace(/\.(?:png|jpe?g)$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const suitMatch = clean.match(
    /^(?:RWS Tarot(?: 1910)?(?:\s*-\s*|\s+))?(Wands|Cups|Swords|Pentacles|Pents)\s+(\d{2})(?:\s+\([^)]+\))?$/i
  );
  if (suitMatch) {
    const suitKey = Object.keys(SUIT_MAP).find((name) => name.toLowerCase() === suitMatch[1].toLowerCase());
    const number = Number(suitMatch[2]);
    if (suitKey && number >= 1 && number <= 14) {
      return `rw-${String(number).padStart(2, '0')}-${NUM_SLUG[number - 1]}-${SUIT_MAP[suitKey]}`;
    }
  }

  const numbered = clean.match(/^(?:RWS Tarot(?: 1910)?(?:\s*-\s*|\s+))?(\d{2})\s+(.+)$/i);
  if (numbered) {
    const fileNum = Number(numbered[1]);
    const tail = numbered[2].trim();
    const major = MAJOR.find(([number]) => Number(number) === fileNum);
    if (major && normalizedWords(tail) === normalizedWords(major[1])) {
      return `rw-${major[0]}-${major[1]}`;
    }

    const suitKey = Object.keys(SUIT_MAP).find((name) => normalizedWords(name) === normalizedWords(tail));
    if (suitKey && fileNum >= 1 && fileNum <= 14) {
      return `rw-${String(fileNum).padStart(2, '0')}-${NUM_SLUG[fileNum - 1]}-${SUIT_MAP[suitKey]}`;
    }
  }
  return null;
}
