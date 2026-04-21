import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type ApiKeyItem = {
  id?: string;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// POST /api-keys/create/ чтобы создать ключ для удаления
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

// DELETE /api-keys/{id}/delete/ (если 405, пробуем POST)
async function deleteApiKey(request: APIRequestContext, id: string) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/api-keys/${id}/delete/`;

  const deleteResponse = await request.delete(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });

  if (deleteResponse.status() !== 405) {
    return deleteResponse;
  }

  return request.post(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

test.describe('API Keys /api-keys/{id}/delete/', () => {
  // Удаляет существующий ключ API
  test('удаляет ключ', async ({ request }) => {
    const createName = `autotest-delete-${Date.now()}`;
    const createResponse = await createApiKey(request, createName, null);
    expect([200, 201]).toContain(createResponse.status());
    const created = (await createResponse.json()) as ApiKeyItem;
    if (!created?.id) test.skip(true, 'Не удалось создать ключ для удаления');

    const response = await deleteApiKey(request, created.id);
    expect([200, 204]).toContain(response.status());

    // Проверяем, что ключ действительно удален
    const listUrl = `${env.apiUrl}/api-keys/all/`;
    const listResponse = await request.get(listUrl, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${getTokensOrThrow().access_token}`,
      },
    });
    expect(listResponse.status()).toBe(200);
    const list = (await listResponse.json()) as ApiKeyItem[];
    const stillExists = list.some(k => k.id === created.id);
    expect(stillExists).toBeFalsy();
  });
});
