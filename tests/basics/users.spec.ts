import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type BasicsUser = {
  id?: string;
  name?: string | null;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// GET /basics/users/ с авторизацией
async function getBasicsUsers(request: APIRequestContext) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/basics/users/`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

// GET /user/info/ чтобы проверить наличие текущего пользователя в списке
async function getUserInfo(request: APIRequestContext) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/user/info/`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

test.describe('Basics /basics/users/', () => {
  // Базовая проверка структуры списка пользователей
  test('возвращает список пользователей с полями id и name', async ({ request }) => {
    const response = await getBasicsUsers(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as BasicsUser[];
    expect(Array.isArray(body)).toBeTruthy();

    for (const user of body) {
      expect(user.id).toBeTruthy();
      const nameOk = user.name === null || typeof user.name === 'string';
      expect(nameOk).toBeTruthy();
    }
  });

  // В списке должен быть текущий пользователь
  test('список содержит текущего пользователя', async ({ request }) => {
    const infoResponse = await getUserInfo(request);
    expect(infoResponse.status()).toBe(200);
    const info = (await infoResponse.json()) as { id?: string };
    if (!info.id) test.skip(true, 'Не удалось получить id текущего пользователя');

    const response = await getBasicsUsers(request);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as BasicsUser[];

    const ids = body.map(u => u.id);
    expect(ids).toContain(info.id as string);
  });
});
