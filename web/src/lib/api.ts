// 前端 API 封装。API 地址是公开值；所有密钥只在后端。
// 401 统一跳回登录页 —— 权限判断永远以后端为准，前端只做引导。
import cardAssets from '../assets/card-assets.json';

const API_BASE = (import.meta.env.PUBLIC_API_BASE_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const SESSION_TOKEN_KEY = 'tq_session_token';

/**
 * 站点基础路径，统一归一化为「以 / 结尾」。
 * Astro 的 `import.meta.env.BASE_URL` 是 base 配置原样字符串；自定义根域名通常为
 * `/`，若未来改回子路径也可能不带尾斜杠。全站只在这里归一化一次。
 */
export const SITE_BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '') + '/';

const WEBP_CARDS = new Set<string>(Array.isArray(cardAssets?.webp) ? (cardAssets.webp as string[]) : []);

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    detail?: string;
  };
}

export class ApiError extends Error {
  code: string;
  status: number;
  detail?: string;
  constructor(status: number, code: string, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function getSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeSessionToken(value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) return;
  try {
    sessionStorage.setItem(SESSION_TOKEN_KEY, value);
  } catch {
    /* Safari 隐私模式下保持 Cookie 兼容路径 */
  }
}

export function clearSessionToken(): void {
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function sessionAuthHeaders(): Record<string, string> {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function redirectToLogin(): void {
  clearSessionToken();
  location.href = `${SITE_BASE}`;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}, opts: { redirectOn401?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getSessionToken();
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  if (res.status === 401 && opts.redirectOn401 !== false) {
    clearSessionToken();
    redirectToLogin();
    throw new ApiError(401, 'UNAUTHENTICATED', '请先登录');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* 空响应 */
  }
  if (!res.ok) {
    const err = (body as ApiErrorBody)?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `请求失败（${res.status}）`, err?.detail);
  }
  return body as T;
}

export { API_BASE };

/** 图片路径：清单内有 WebP 才请求 WebP，否则直接给占位 SVG（首帧不打 404） */
export function cardImageSrc(cardId: string): { src: string; fallback: string } {
  const fallback = `${SITE_BASE}cards/placeholders/${cardId}.svg`;
  const src = WEBP_CARDS.has(cardId) ? `${SITE_BASE}cards/${cardId}.webp` : fallback;
  return { src, fallback };
}

export function attachImageFallback(img: HTMLImageElement, fallback: string): void {
  img.addEventListener('error', () => {
    if (img.src !== fallback && !img.src.endsWith(fallback)) img.src = fallback;
  });
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
