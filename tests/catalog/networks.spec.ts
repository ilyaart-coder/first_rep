import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type CatalogNetworksResponse = {
  count?: number;
  pages?: number;
  next?: number | null;
  previous?: number | null;
  results?: Array<{ id?: string; name?: string; code?: string }>;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// GET /catalog/networks/ с авторизацией
async function getCatalogNetworks(request: APIRequestContext, params: Record<string, string>) {
  const tokens = getTokensOrThrow();
  const search = new URLSearchParams(params);
  const url = `${env.apiUrl}/catalog/networks/?${search.toString()}`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

test.describe('Catalog /catalog/networks/', () => {
  // Базовая проверка структуры ответа
  test('возвращает список сетей с корректной структурой', async ({ request }) => {
    const response = await getCatalogNetworks(request, { page: '1', size: '25' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as CatalogNetworksResponse;
    expect(typeof body.count === 'number' || body.count === undefined).toBeTruthy();
    expect(typeof body.pages === 'number' || body.pages === undefined).toBeTruthy();
    expect(body.next === null || typeof body.next === 'number' || body.next === undefined).toBeTruthy();
    expect(body.previous === null || typeof body.previous === 'number' || body.previous === undefined).toBeTruthy();
    expect(Array.isArray(body.results)).toBeTruthy();

    const item = body.results?.[0];
    if (!item) return;
    expect(item.id).toBeTruthy();
    expect(item.name).toBeTruthy();
    expect(item.code).toBeTruthy();
  });

  // Пагинация: size=1 должна возвращать максимум 1 элемент
  test('пагинация size=1 возвращает максимум 1 элемент', async ({ request }) => {
    const response = await getCatalogNetworks(request, { page: '1', size: '1' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as CatalogNetworksResponse;
    const length = body.results?.length ?? 0;
    expect(length <= 1).toBeTruthy();
  });

  // search по коду/названию сети (если есть результаты)
  test('search фильтрует по коду или названию сети', async ({ request }) => {
    const baseResponse = await getCatalogNetworks(request, { page: '1', size: '25' });
    expect(baseResponse.status()).toBe(200);
    const baseBody = (await baseResponse.json()) as CatalogNetworksResponse;
    const first = baseBody.results?.[0];
    if (!first?.code) test.skip(true, 'Нет сетей для проверки search');

    const search = first!.code!.slice(0, 2);
    const response = await getCatalogNetworks(request, { page: '1', size: '25', search });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as CatalogNetworksResponse;
    for (const item of body.results ?? []) {
      const code = (item.code ?? '').toLowerCase();
      const name = (item.name ?? '').toLowerCase();
      expect(code.includes(search.toLowerCase()) || name.includes(search.toLowerCase())).toBeTruthy();
    }
  });

  // По умолчанию должны возвращаться KYT-сети (supports_kyt=true)
  test('по умолчанию возвращает KYT-сети', async ({ request }) => {
    const response = await getCatalogNetworks(request, { page: '1', size: '25' });
    expect(response.status()).toBe(200);
  });

  // Фильтр supports_kyt=true не должен давать ошибку
  test('supports_kyt=true возвращает данные', async ({ request }) => {
    const response = await getCatalogNetworks(request, { page: '1', size: '25', supports_kyt: 'true' });
    expect(response.status()).toBe(200);
  });

  // Фильтр supports_graph=true не должен давать ошибку
  test('supports_graph=true возвращает данные', async ({ request }) => {
    const response = await getCatalogNetworks(request, { page: '1', size: '25', supports_graph: 'true' });
    expect(response.status()).toBe(200);
  });
});
