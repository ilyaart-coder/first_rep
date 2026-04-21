import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type EntityCategoriesResponse = {
  count?: number;
  pages?: number;
  next?: number | null;
  previous?: number | null;
  results?: EntityCategory[];
};

type EntityCategory = {
  id?: string;
  name?: string;
  code?: string;
  description?: string | null;
  color?: string | null;
  is_custom?: boolean;
  label_count?: number | null;
  risk_rule_count?: number | null;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// GET /entity-categories/ с авторизацией
async function getEntityCategories(request: APIRequestContext, params: Record<string, string>) {
  const tokens = getTokensOrThrow();
  const search = new URLSearchParams(params);
  const url = `${env.apiUrl}/entity-categories/?${search.toString()}`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

test.describe('Entity Categories /entity-categories/', () => {
  // Базовая проверка структуры ответа
  test('возвращает список категорий с корректной структурой', async ({ request }) => {
    const response = await getEntityCategories(request, { page: '1', size: '1000' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as EntityCategoriesResponse;
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
    const isCustomOk = typeof item.is_custom === 'boolean' || item.is_custom === undefined;
    expect(isCustomOk).toBeTruthy();
  });

  // search по названию (если есть результаты)
  test('search фильтрует по названию категории', async ({ request }) => {
    const baseResponse = await getEntityCategories(request, { page: '1', size: '1000' });
    expect(baseResponse.status()).toBe(200);
    const baseBody = (await baseResponse.json()) as EntityCategoriesResponse;
    const first = baseBody.results?.[0];
    if (!first?.name) test.skip(true, 'Нет категорий для проверки search');

    const search = (first?.name ?? '').slice(0, 3);
    const response = await getEntityCategories(request, { page: '1', size: '1000', search });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as EntityCategoriesResponse;
    for (const item of body.results ?? []) {
      expect((item.name ?? '').toLowerCase().includes(search.toLowerCase())).toBeTruthy();
    }
  });

  // is_custom=true возвращает только пользовательские
  test('is_custom=true возвращает только пользовательские', async ({ request }) => {
    const response = await getEntityCategories(request, { page: '1', size: '1000', is_custom: 'true' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as EntityCategoriesResponse;
    for (const item of body.results ?? []) {
      if (typeof item.is_custom === 'boolean') {
        expect(item.is_custom).toBe(true);
      }
    }
  });

  // is_custom=false возвращает только системные
  test('is_custom=false возвращает только системные', async ({ request }) => {
    const response = await getEntityCategories(request, { page: '1', size: '1000', is_custom: 'false' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as EntityCategoriesResponse;
    for (const item of body.results ?? []) {
      if (typeof item.is_custom === 'boolean') {
        expect(item.is_custom).toBe(false);
      }
    }
  });

  // order_by=priority_desc не должен давать ошибку
  test('order_by=priority_desc возвращает данные', async ({ request }) => {
    const response = await getEntityCategories(request, { page: '1', size: '1000', order_by: 'priority_desc' });
    expect(response.status()).toBe(200);
  });

  // extras=true добавляет label_count и risk_rule_count
  test('extras=true добавляет label_count и risk_rule_count', async ({ request }) => {
    const response = await getEntityCategories(request, { page: '1', size: '1000', extras: 'true' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as EntityCategoriesResponse;
    const item = body.results?.[0];
    if (!item) return;
    expect('label_count' in item).toBeTruthy();
    expect('risk_rule_count' in item).toBeTruthy();
  });

  // extras=false -> label_count и risk_rule_count должны быть null (или отсутствовать)
  test('extras=false не возвращает значения label_count и risk_rule_count', async ({ request }) => {
    const response = await getEntityCategories(request, { page: '1', size: '1000', extras: 'false' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as EntityCategoriesResponse;
    const item = body.results?.[0];
    if (!item) return;
    const labelOk = item.label_count === null || item.label_count === undefined;
    const riskOk = item.risk_rule_count === null || item.risk_rule_count === undefined;
    expect(labelOk).toBeTruthy();
    expect(riskOk).toBeTruthy();
  });

  // search с несуществующим значением -> пустой список
  test('search по несуществующему названию возвращает пустой список', async ({ request }) => {
    const response = await getEntityCategories(request, { page: '1', size: '1000', search: '___no_such_category___' });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as EntityCategoriesResponse;
    expect((body.results ?? []).length).toBe(0);
  });

  // order_by=priority_asc не должен давать ошибку
  test('order_by=priority_asc возвращает данные', async ({ request }) => {
    const response = await getEntityCategories(request, { page: '1', size: '1000', order_by: 'priority_asc' });
    expect(response.status()).toBe(200);
  });

  // extras=true возвращает корректные типы для label_count/risk_rule_count
  test('extras=true возвращает корректные типы для label_count/risk_rule_count', async ({ request }) => {
    const response = await getEntityCategories(request, { page: '1', size: '1000', extras: 'true' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as EntityCategoriesResponse;
    for (const item of body.results ?? []) {
      const labelOk = item.label_count === null || typeof item.label_count === 'number' || item.label_count === undefined;
      const riskOk = item.risk_rule_count === null || typeof item.risk_rule_count === 'number' || item.risk_rule_count === undefined;
      expect(labelOk).toBeTruthy();
      expect(riskOk).toBeTruthy();
    }
  });

  // пагинация size=1 возвращает максимум 1 элемент
  test('пагинация size=1 возвращает максимум 1 элемент', async ({ request }) => {
    const response = await getEntityCategories(request, { page: '1', size: '1' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as EntityCategoriesResponse;
    expect((body.results ?? []).length).toBeLessThanOrEqual(1);
  });

  // search регистронезависимый
  test('search регистронезависимый', async ({ request }) => {
    const baseResponse = await getEntityCategories(request, { page: '1', size: '1000' });
    expect(baseResponse.status()).toBe(200);
    const baseBody = (await baseResponse.json()) as EntityCategoriesResponse;
    const first = baseBody.results?.[0];
    if (!first?.name) test.skip(true, 'Нет категорий для проверки search');

    const search = (first?.name ?? '').slice(0, 3).toUpperCase();
    const response = await getEntityCategories(request, { page: '1', size: '1000', search });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as EntityCategoriesResponse;
    for (const item of body.results ?? []) {
      expect((item.name ?? '').toLowerCase().includes(search.toLowerCase())).toBeTruthy();
    }
  });
});
