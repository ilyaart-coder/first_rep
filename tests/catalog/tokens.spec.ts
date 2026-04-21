import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type CatalogTokensResponse = {
  count?: number;
  pages?: number;
  next?: number | null;
  previous?: number | null;
  results?: Array<{
    id?: string;
    asset?: string;
    type?: string;
    network_code?: string;
    token_id?: string | null;
    name?: string;
  }>;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// GET /catalog/tokens/ с авторизацией
async function getCatalogTokens(request: APIRequestContext, params: Record<string, string>) {
  const tokens = getTokensOrThrow();
  const search = new URLSearchParams(params);
  const url = `${env.apiUrl}/catalog/tokens/?${search.toString()}`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

test.describe('Catalog /catalog/tokens/', () => {
  // Базовая проверка структуры ответа
  test('возвращает список токенов с корректной структурой', async ({ request }) => {
    const response = await getCatalogTokens(request, { page: '1', size: '25' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as CatalogTokensResponse;
    expect(typeof body.count === 'number' || body.count === undefined).toBeTruthy();
    expect(typeof body.pages === 'number' || body.pages === undefined).toBeTruthy();
    expect(body.next === null || typeof body.next === 'number' || body.next === undefined).toBeTruthy();
    expect(body.previous === null || typeof body.previous === 'number' || body.previous === undefined).toBeTruthy();
    expect(Array.isArray(body.results)).toBeTruthy();

    const item = body.results?.[0];
    if (!item) return;
    expect(item.id).toBeTruthy();
    expect(item.asset).toBeTruthy();
    expect(item.type).toBeTruthy();
    expect(item.network_code).toBeTruthy();
    expect(item.name).toBeTruthy();
  });

  // Пагинация: size=1 должна возвращать максимум 1 элемент
  test('пагинация size=1 возвращает максимум 1 элемент', async ({ request }) => {
    const response = await getCatalogTokens(request, { page: '1', size: '1' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as CatalogTokensResponse;
    const length = body.results?.length ?? 0;
    expect(length <= 1).toBeTruthy();
  });

  // search по символу/названию токена (если есть результаты)
  test('search фильтрует по символу или названию токена', async ({ request }) => {
    const baseResponse = await getCatalogTokens(request, { page: '1', size: '25' });
    expect(baseResponse.status()).toBe(200);
    const baseBody = (await baseResponse.json()) as CatalogTokensResponse;
    const first = baseBody.results?.[0];
    if (!first?.asset && !first?.name) test.skip(true, 'Нет токенов для проверки search');

    const search = (first.asset ?? first.name ?? '').slice(0, 2);
    const response = await getCatalogTokens(request, { page: '1', size: '25', search });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as CatalogTokensResponse;
    for (const item of body.results ?? []) {
      const asset = (item.asset ?? '').toLowerCase();
      const name = (item.name ?? '').toLowerCase();
      expect(asset.includes(search.toLowerCase()) || name.includes(search.toLowerCase())).toBeTruthy();
    }
  });

  // monitoring_support=true не должен давать ошибку
  test('monitoring_support=true возвращает данные', async ({ request }) => {
    const response = await getCatalogTokens(request, { page: '1', size: '25', monitoring_support: 'true' });
    expect(response.status()).toBe(200);
  });
});
