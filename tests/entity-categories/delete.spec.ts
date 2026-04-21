import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type EntityCategory = {
  id?: string;
  name?: string;
  code?: string;
  is_custom?: boolean;
};

type EntityCategoriesResponse = {
  results?: EntityCategory[];
  next?: number | null;
};

async function expectStatusOrThrow(response: { status(): number; text(): Promise<string> }, allowed: number[]) {
  const status = response.status();
  if (allowed.includes(status)) return;
  const text = await response.text();
  throw new Error(`Unexpected status ${status}. Body: ${text}`);
}

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

// POST /entity-categories/create/ с авторизацией (для подготовки данных)
async function createEntityCategory(request: APIRequestContext, payload: { name: string; code: string; color: string; description?: string | null }) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/entity-categories/create/`;

  return request.post(url, {
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
    data: payload,
  });
}

// DELETE /entity-categories/{id}/delete/ с авторизацией
async function deleteEntityCategory(request: APIRequestContext, id: string) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/entity-categories/${id}/delete/`;

  return request.delete(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

function newAutotestCategory(seed: string) {
  const seedPart = seed.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 6);
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toLowerCase();
  return {
    name: `autotest-${seed}-${suffix}`,
    code: `custom:at${seedPart}${suffix}`.slice(0, 32),
    color: '#00AA00',
    description: `autotest description ${seed}`,
  };
}

async function listAllCustomAutotestCategories(request: APIRequestContext): Promise<EntityCategory[]> {
  const collected: EntityCategory[] = [];
  let page = 1;

  while (page <= 50) {
    const resp = await getEntityCategories(request, { page: String(page), size: '1000', is_custom: 'true' });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as EntityCategoriesResponse;
    collected.push(...(body.results ?? []));
    if (!body.next) break;
    page = body.next;
  }

  return collected.filter((c) => (c.code ?? '').startsWith('custom:autotest_') || (c.name ?? '').startsWith('autotest-'));
}

// Удаляет остатки наших автотестовых категорий от прошлых прогонов
async function cleanupAutotestCategories(request: APIRequestContext) {
  const items = await listAllCustomAutotestCategories(request);
  for (const item of items) {
    if (!item.id) continue;
    await deleteEntityCategory(request, item.id);
  }
}

test.describe('Entity Categories DELETE /entity-categories/{id}/delete/', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAutotestCategories(request);
  });

  // Позитив: удаление созданной пользовательской категории и проверка, что ее больше нет в списке
  test('удаляет пользовательскую категорию (204) и она пропадает из списка', async ({ request }) => {
    const payload = newAutotestCategory('delete');

    const created = await createEntityCategory(request, payload);
    if (created.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для создания/удаления категории');
    await expectStatusOrThrow(created, [201]);
    const createdBody = (await created.json()) as EntityCategory;
    const id = createdBody.id!;

    const del = await deleteEntityCategory(request, id);
    if (del.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для удаления категории');
    await expectStatusOrThrow(del, [204]);

    const listResp = await getEntityCategories(request, { page: '1', size: '1000', is_custom: 'true', search: payload.name.slice(0, 10) });
    expect(listResp.status()).toBe(200);
    const listBody = (await listResp.json()) as EntityCategoriesResponse;
    const stillExists = (listBody.results ?? []).some((c) => c.id === id);
    expect(stillExists).toBeFalsy();
  });

  // Негатив: несуществующий id -> 404
  test('404 если категория не найдена', async ({ request }) => {
    const resp = await deleteEntityCategory(request, '00000000-0000-0000-0000-000000000000');
    if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для удаления категории');
    expect(resp.status()).toBe(404);
  });

  // Негатив: попытка удалить системную категорию должна завершаться ошибкой (обычно 403/404)
  test('ошибка при попытке удалить системную (не custom) категорию', async ({ request }) => {
    const listResp = await getEntityCategories(request, { page: '1', size: '1000', is_custom: 'false' });
    expect(listResp.status()).toBe(200);
    const listBody = (await listResp.json()) as EntityCategoriesResponse;
    const system = (listBody.results ?? []).find((c) => c.id);
    if (!system?.id) test.skip(true, 'Нет системных категорий для проверки');

    const resp = await deleteEntityCategory(request, system.id);
    // По доке системные удалить нельзя, точный код может отличаться (403/404)
    expect([403, 404]).toContain(resp.status());
  });
});
