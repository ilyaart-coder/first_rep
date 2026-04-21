import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type ApiKeyCreateResponse = {
  id?: string;
  created_at?: string;
  public_id?: string;
  secret?: string;
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

// POST /api-keys/create/
async function createApiKey(request: APIRequestContext, name: string, allowedIp: string | null) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/api-keys/create/`;

  return request.post(url, {
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
    data: { name, allowed_ip: allowedIp },
  });
}

// DELETE /api-keys/{id}/delete/ чтобы очистить тестовые данные
async function deleteApiKey(request: APIRequestContext, id: string) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/api-keys/${id}/delete/`;

  const deleteResponse = await request.delete(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });

  if ([200, 204].includes(deleteResponse.status())) {
    return deleteResponse;
  }

  return request.post(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

test.describe('API Keys /api-keys/create/', () => {
  // Создает ключ API и проверяет основные поля ответа (включая secret)
  test('создает ключ и возвращает secret', async ({ request }) => {
    const name = `autotest-key-${Date.now()}`;
    const response = await createApiKey(request, name, null);
    expect([200, 201]).toContain(response.status());

    const body = (await response.json()) as ApiKeyCreateResponse;
    expect(body.id).toBeTruthy();
    expect(body.created_at).toBeTruthy();
    expect(body.public_id).toBeTruthy();
    expect(body.secret).toBeTruthy();
    expect(body.name).toBe(name);
    const allowedIpOk = body.allowed_ip === null || typeof body.allowed_ip === 'string' || body.allowed_ip === undefined;
    expect(allowedIpOk).toBeTruthy();
    const checksOk = typeof body.checks === 'number' || body.checks === undefined;
    expect(checksOk).toBeTruthy();

    // Чистим тестовые данные
    if (body.id) {
      const deleteResponse = await deleteApiKey(request, body.id);
      expect([200, 204]).toContain(deleteResponse.status());
    }
  });
});
