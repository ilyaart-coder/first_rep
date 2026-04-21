import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type EntityCategory = {
  id?: string;
  name?: string;
  code?: string;
  description?: string | null;
  color?: string | null;
  is_custom?: boolean;
  created_at?: string;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// GET /basics/entity-categories/ с авторизацией
async function getEntityCategories(request: APIRequestContext) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/basics/entity-categories/`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

test.describe('Basics /basics/entity-categories/', () => {
  // Базовая проверка структуры списка категорий
  test('возвращает список категорий с обязательными полями', async ({ request }) => {
    const response = await getEntityCategories(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as EntityCategory[];
    expect(Array.isArray(body)).toBeTruthy();

    const item = body[0];
    if (!item) return;

    expect(item.id).toBeTruthy();
    expect(item.name).toBeTruthy();
    expect(item.code).toBeTruthy();
    const isCustomOk = typeof item.is_custom === 'boolean' || item.is_custom === undefined;
    expect(isCustomOk).toBeTruthy();
    expect(item.created_at).toBeTruthy();
  });

  // Все элементы должны иметь корректные типы (без пагинации)
  test('поля имеют корректные типы', async ({ request }) => {
    const response = await getEntityCategories(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as EntityCategory[];
    for (const item of body) {
      expect(item.id).toBeTruthy();
      expect(item.name).toBeTruthy();
      expect(item.code).toBeTruthy();
      const isCustomOk = typeof item.is_custom === 'boolean' || item.is_custom === undefined;
      expect(isCustomOk).toBeTruthy();
      const descOk = item.description === null || typeof item.description === 'string' || item.description === undefined;
      expect(descOk).toBeTruthy();
      const colorOk = item.color === null || typeof item.color === 'string' || item.color === undefined;
      expect(colorOk).toBeTruthy();
    }
  });
});
