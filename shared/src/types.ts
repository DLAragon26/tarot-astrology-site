// 领域类型：卡牌、牌阵、记录、用户、请求/响应 DTO。
// 前后端共享，权限判断永远只发生在后端。

export type Role = 'admin' | 'member';
export type Orientation = 'upright' | 'reversed';
export type ReadingMode = 'online' | 'offline';
export type Arcana = 'major' | 'minor';
export type Suit = 'wands' | 'cups' | 'swords' | 'pentacles';
export type SpreadId = 'single' | 'three-card' | 'five-question';

export interface TarotCard {
  /** 稳定图片/数据 ID，如 rw-00-fool */
  id: string;
  name: string;
  nameZh: string;
  arcana: Arcana;
  suit: Suit | null;
  /** 大阿卡纳 0–21；小阿卡纳 1=Ace … 14=King */
  number: number;
  keywords: string[];
  upright: string;
  reversed: string;
  /** 相对前端 public 的路径，如 cards/rw-00-fool.webp */
  image: string;
}

export interface SpreadPosition {
  index: number;
  key: string;
  labelZh: string;
  hintZh?: string;
}

export interface Spread {
  id: SpreadId;
  nameZh: string;
  descriptionZh: string;
  positions: SpreadPosition[];
}

/** 一条记录中的一张牌 */
export interface DrawnCard {
  /** 牌阵位置 key，须与所属牌阵一致 */
  position: string;
  /** 卡牌 ID，如 rw-00-fool */
  card: string;
  orientation: Orientation;
}

export interface Reading {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  mode: ReadingMode;
  question: string;
  spread: SpreadId;
  cards: DrawnCard[];
  ai_interpretation: string | null;
  user_note: string | null;
  mood_tag: string | null;
  topic_tag: string | null;
}

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  /** null = 使用默认额度 */
  daily_ai_limit: number | null;
  must_change_password: boolean;
  created_at: string;
}

export interface AdminUserRow extends PublicUser {
  is_active: boolean;
  used_today: number;
  readings_count: number;
  /** member = 剩余额度；admin = -1（无上限） */
  remaining: number;
}

// ---------- 请求 ----------

export interface LoginRequest {
  site_access_key: string;
  username: string;
  password: string;
}

export interface RedeemRequest {
  invite_code: string;
  site_access_key: string;
  username: string;
  password: string;
}

export interface ReadingInput {
  mode: ReadingMode;
  question: string;
  spread: SpreadId;
  cards: DrawnCard[];
  user_note?: string | null;
  mood_tag?: string | null;
  topic_tag?: string | null;
  /** 保存时一并写入的 AI 解读文本（登录用户自己的记录） */
  ai_interpretation?: string | null;
}

export interface InterpretRequest {
  mode: ReadingMode;
  question: string;
  spread: SpreadId;
  cards: DrawnCard[];
  mood_tag?: string | null;
  topic_tag?: string | null;
}

export interface AdminCreateUserRequest {
  username: string;
  password: string;
  role?: Role;
  daily_ai_limit?: number | null;
}

export interface AdminPatchUserRequest {
  role?: Role;
  daily_ai_limit?: number | null;
  is_active?: boolean;
  new_password?: string;
}

// ---------- 响应 ----------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface InterpretResponse {
  interpretation: string;
  model: string;
  quota: {
    daily_limit: number;
    used_today: number;
    remaining: number;
  };
}

export interface QuotaInfo {
  daily_limit: number;
  used_today: number;
  remaining: number;
  global_limit: number;
  global_used_today: number;
  /** 下一重置时间（ISO，Asia/Shanghai 午夜） */
  reset_at: string;
}

export interface CountRow {
  key: string;
  count: number;
}

export interface ReadingStats {
  scope: 'self' | 'all';
  total: number;
  by_month: CountRow[];
  by_mode: CountRow[];
  by_topic: CountRow[];
  by_spread: CountRow[];
  top_cards: { card: string; nameZh: string; count: number }[];
  orientations: { upright: number; reversed: number };
  ai_used_total: number;
  ai_used_today: number;
}

export interface AdminInviteRow {
  code: string;
  created_at: string;
  status: 'active' | 'redeemed' | 'revoked';
  redeemed_by: string | null;
  redeemed_at: string | null;
}

export interface AdminStats {
  total_readings: number;
  global_limit: number;
  global_used_today: number;
  users: AdminUserRow[];
  invite_codes: AdminInviteRow[];
}
