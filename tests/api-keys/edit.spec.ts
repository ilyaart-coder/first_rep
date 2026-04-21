import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type ApiKeyItem = {
  id?: string;
  name?: string;
  allowed_ip?: string | null;
  public_id?: string;
  secret?: string;
  created_at?: string;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// POST /api-keys/create/ чтобы создать новый ключ для редактирования
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

// POST /api-keys/{id}/edit/ (если 405, пробуем PUT/PATCH)
async function editApiKey(request: APIRequestContext, id: string, name: string, allowedIp: string | null) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/api-keys/${id}/edit/`;

  const postResponse = await request.post(url, {
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
    data: { name, allowed_ip: allowedIp },
  });

  if (postResponse.status() !== 405) {
    return postResponse;
  }

  const putResponse = await request.put(url, {
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
    data: { name, allowed_ip: allowedIp },
  });

  if (putResponse.status() !== 405) {
    return putResponse;
  }

  return request.patch(url, {
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

test.describe('API Keys /api-keys/{id}/edit/', () => {
  // Обновляет name и allowed_ip у существующего ключа
  test('обновляет name и allowed_ip', async ({ request }) => {
    const createName = `autotest-edit-${Date.now()}`;
    const createResponse = await createApiKey(request, createName, null);
    expect([200, 201]).toContain(createResponse.status());
    const created = (await createResponse.json()) as ApiKeyItem;
    if (!created?.id) test.skip(true, 'Не удалось создать ключ для редактирования');

    try {
      const newName = `${createName}-edited`;
      const newIp = '127.0.0.1';
      const response = await editApiKey(request, created.id, newName, newIp);
      if (![200, 201].includes(response.status())) {
        throw new Error(`Редактирование недоступно (status ${response.status()})`);
      }

      const body = (await response.json()) as ApiKeyItem;
      expect(body.id).toBe(created.id);
      expect(body.name).toBe(newName);
      expect(body.allowed_ip).toBe(newIp);
    } finally {
      // Чистим тестовые данные
      const deleteResponse = await deleteApiKey(request, created.id);
      expect([200, 204]).toContain(deleteResponse.status());
    }
  });
});
