import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type ApiKeyItem = {
  id?: string;
  created_at?: string;
  public_id?: string;
  name?: string;
  allowed_ip?: string | null;
  checks?: number;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// GET /api-keys/all/ с авторизацией
async function getApiKeys(request: APIRequestContext) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/api-keys/all/`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

test.describe('API Keys /api-keys/all/', () => {
  // Базовая проверка структуры списка ключей
  test('возвращает список ключей с обязательными полями', async ({ request }) => {
    const response = await getApiKeys(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ApiKeyItem[];
    expect(Array.isArray(body)).toBeTruthy();

    const item = body[0];
    if (!item) return;

    expect(item.id).toBeTruthy();
    expect(item.created_at).toBeTruthy();
    expect(item.public_id).toBeTruthy();
    expect(item.name).toBeTruthy();
    const allowedIpOk = item.allowed_ip === null || typeof item.allowed_ip === 'string' || item.allowed_ip === undefined;
    expect(allowedIpOk).toBeTruthy();
    const checksOk = typeof item.checks === 'number' || item.checks === undefined;
    expect(checksOk).toBeTruthy();
  });

  // Проверка типов полей во всех ключах
  test('поля ключей имеют корректные типы', async ({ request }) => {
    const response = await getApiKeys(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ApiKeyItem[];
    for (const item of body) {
      expect(item.id).toBeTruthy();
      expect(item.created_at).toBeTruthy();
      expect(item.public_id).toBeTruthy();
      expect(item.name).toBeTruthy();
      const allowedIpOk = item.allowed_ip === null || typeof item.allowed_ip === 'string' || item.allowed_ip === undefined;
      expect(allowedIpOk).toBeTruthy();
      const checksOk = typeof item.checks === 'number' || item.checks === undefined;
      expect(checksOk).toBeTruthy();
    }
  });
});
