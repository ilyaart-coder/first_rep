import { APIRequestContext, expect } from '@playwright/test';

import { env } from './env';
import { AuthTokens, readTokens, saveTokens, tokenFileExists } from './tokens';

type RefreshResponse = {
  access?: string;
  refresh?: string;
  access_token?: string;
  refresh_token?: string;
};

function decodeJwtPayload(token: string): any | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isJwtExpired(token: string, skewSeconds = 30): boolean {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  if (typeof exp !== 'number') return false;
  const now = Math.floor(Date.now() / 1000);
  return exp <= now + skewSeconds;
}

async function refreshTokens(request: APIRequestContext, tokens: AuthTokens): Promise<AuthTokens> {
  const url = `${env.apiUrl}/auth/update-token/`;
  const resp = await request.post(url, {
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    data: { refresh: tokens.refresh_token },
  });

  if (resp.status() === 401) {
    throw new Error('Refresh token истек/невалиден. Запусти tests/auth/login.spec.ts для получения новых токенов.');
  }

  expect([200, 201]).toContain(resp.status());
  const body = (await resp.json()) as RefreshResponse;
  const access = body.access ?? body.access_token;
  const refresh = body.refresh ?? body.refresh_token;
  if (!access || !refresh) {
    throw new Error('Неожиданный ответ /auth/update-token/: нет access/refresh токенов.');
  }

  const updated: AuthTokens = { access_token: access, refresh_token: refresh };
  saveTokens(updated);
  return updated;
}

// Возвращает валидный access_token (если истек — обновляет по refresh_token и сохраняет в .auth/tokens.json)
export async function getValidAccessToken(request: APIRequestContext): Promise<string> {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  const tokens = readTokens();
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('tokens.json поврежден или неполный. Перелогинься через tests/auth/login.spec.ts');
  }

  if (isJwtExpired(tokens.access_token)) {
    const updated = await refreshTokens(request, tokens);
    return updated.access_token;
  }

  return tokens.access_token;
}

