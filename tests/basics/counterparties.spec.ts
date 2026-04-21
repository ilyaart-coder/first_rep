import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type BasicsCounterpartiesResponse = {
  count?: number;
  pages?: number;
  next?: number | null;
  previous?: number | null;
  results?: Array<{ name?: string }>;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// GET /basics/counterparties/ с авторизацией
async function getCounterparties(request: APIRequestContext, params: Record<string, string>) {
  const tokens = getTokensOrThrow();
  const search = new URLSearchParams(params);
  const url = `${env.apiUrl}/basics/counterparties/?${search.toString()}`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

test.describe('Basics /basics/counterparties/', () => {
  // Базовая проверка структуры ответа
  test('возвращает список контрагентов с корректной структурой', async ({ request }) => {
    const response = await getCounterparties(request, { page: '1', size: '25' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as BasicsCounterpartiesResponse;
    expect(typeof body.count === 'number' || body.count === undefined).toBeTruthy();
    expect(typeof body.pages === 'number' || body.pages === undefined).toBeTruthy();
    expect(body.next === null || typeof body.next === 'number' || body.next === undefined).toBeTruthy();
    expect(body.previous === null || typeof body.previous === 'number' || body.previous === undefined).toBeTruthy();
    expect(Array.isArray(body.results)).toBeTruthy();

    const item = body.results?.[0];
    if (!item) return;
    expect(item.name).toBeTruthy();
  });

  // Пагинация: size=1 должна возвращать максимум 1 элемент
  test('пагинация size=1 возвращает максимум 1 элемент', async ({ request }) => {
    const response = await getCounterparties(request, { page: '1', size: '1' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as BasicsCounterpartiesResponse;
    const length = body.results?.length ?? 0;
    expect(length <= 1).toBeTruthy();
  });

  // search по названию контрагента (если есть результаты)
  test('search фильтрует по названию контрагента', async ({ request }) => {
    const baseResponse = await getCounterparties(request, { page: '1', size: '25' });
    expect(baseResponse.status()).toBe(200);
    const baseBody = (await baseResponse.json()) as BasicsCounterpartiesResponse;
    const first = baseBody.results?.[0];
    if (!first?.name) test.skip(true, 'Нет контрагентов для проверки search');

    const search = first!.name!.slice(0, 3);
    const response = await getCounterparties(request, { page: '1', size: '25', search });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as BasicsCounterpartiesResponse;
    for (const item of body.results ?? []) {
      expect((item.name ?? '').toLowerCase().includes(search.toLowerCase())).toBeTruthy();
    }
  });
});
