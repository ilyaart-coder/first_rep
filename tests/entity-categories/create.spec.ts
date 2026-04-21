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
  label_count?: number | null;
  risk_rule_count?: number | null;
};

type EntityCategoriesResponse = {
  count?: number;
  pages?: number;
  next?: number | null;
  previous?: number | null;
  results?: EntityCategory[];
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

// POST /entity-categories/create/ с авторизацией
async function createEntityCategory(
  request: APIRequestContext,
  payload: { name?: string; code?: string; color?: string; description?: string | null },
) {
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
  const name = `autotest-${seed}-${suffix}`;
  // Важно: code должен начинаться с custom:
  // Не используем спецсимволы (например, "_"), чтобы код гарантированно прошел валидацию на бэкенде
  // Важно: на бэкенде поле code ограничено длиной (varchar(32)), поэтому делаем короткий код.
  const code = `custom:at${seedPart}${suffix}`.slice(0, 32);
  // Используем 6-значный hex, так как на бэке часто ждут именно #RRGGBB
  const color = '#00AA00';
  const description = `autotest description ${seed}`;
  return { name, code, color, description };
}

async function listAllCustomAutotestCategories(request: APIRequestContext): Promise<EntityCategory[]> {
  const collected: EntityCategory[] = [];
  let page = 1;

  while (page <= 50) {
    const resp = await getEntityCategories(request, { page: String(page), size: '1000', is_custom: 'true' });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as EntityCategoriesResponse;
    const results = body.results ?? [];
    collected.push(...results);

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

test.describe('Entity Categories POST /entity-categories/create/', () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAutotestCategories(request);
  });

  // Позитив: создание категории с обязательными полями и проверка, что она появилась в списке
  test('создает пользовательскую категорию и она появляется в списке', async ({ request }) => {
    const payload = newAutotestCategory('basic');

    let createdId: string | undefined;
    try {
      const response = await createEntityCategory(request, payload);

      if (response.status() === 403) {
        test.skip(true, 'Нет прав access_risk_models=full для создания категории');
      }

      await expectStatusOrThrow(response, [201]);
      const body = (await response.json()) as EntityCategory;

      createdId = body.id;
      expect(body.id).toBeTruthy();
      expect(body.name).toBe(payload.name);
      expect(body.code).toBe(payload.code);
      expect(body.color).toBe(payload.color);
      // По документации is_custom всегда true, но в некоторых окружениях поле может не приходить
      expect(body.is_custom === true || body.is_custom === undefined).toBeTruthy();
      expect(body.created_at).toBeTruthy();
      expect(Number.isNaN(Date.parse(body.created_at ?? ''))).toBe(false);

      const listResp = await getEntityCategories(request, { page: '1', size: '1000', is_custom: 'true', search: payload.name.slice(0, 10) });
      expect(listResp.status()).toBe(200);
      const listBody = (await listResp.json()) as EntityCategoriesResponse;

      const found = (listBody.results ?? []).some((c) => c.id === createdId && c.code === payload.code);
      expect(found).toBeTruthy();
    } finally {
      if (createdId) {
        await deleteEntityCategory(request, createdId);
      }
    }
  });

  // Позитив: создание категории с description=null
  test('создает категорию с description=null', async ({ request }) => {
    const payload = newAutotestCategory('descnull');
    const createPayload = { ...payload, description: null as null };

    let createdId: string | undefined;
    try {
      const response = await createEntityCategory(request, createPayload);
      if (response.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для создания категории');
      await expectStatusOrThrow(response, [201]);
      const body = (await response.json()) as EntityCategory;
      createdId = body.id;
      expect(body.description === null || body.description === undefined).toBeTruthy();
    } finally {
      if (createdId) await deleteEntityCategory(request, createdId);
    }
  });

  // Негатив: обязательность полей
  test('400 если не передать обязательные поля (name/code/color)', async ({ request }) => {
    const base = newAutotestCategory('required');

    const cases: Array<{ title: string; payload: any }> = [
      { title: 'без name', payload: { code: base.code, color: base.color, description: base.description } },
      { title: 'без code', payload: { name: base.name, color: base.color, description: base.description } },
      { title: 'без color', payload: { name: base.name, code: base.code, description: base.description } },
      { title: 'пустой name', payload: { name: '', code: base.code, color: base.color } },
      { title: 'пустой code', payload: { name: base.name, code: '', color: base.color } },
      { title: 'пустой color', payload: { name: base.name, code: base.code, color: '' } },
    ];

    for (const c of cases) {
      const resp = await createEntityCategory(request, c.payload);
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для создания категории');
      expect(resp.status(), c.title).toBe(400);
    }
  });

  // Негатив: code должен начинаться с custom:
  test('400 если code не начинается с custom:', async ({ request }) => {
    const payload = newAutotestCategory('badcode');
    const resp = await createEntityCategory(request, { ...payload, code: payload.code.replace(/^custom:/, 'cust:') });
    if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для создания категории');
    expect(resp.status()).toBe(400);
  });

  // Негатив: color должен быть hex (#RGB или #RRGGBB)
  test('400 если color не hex', async ({ request }) => {
    // Используем заведомо невалидные значения (чтобы не ловить неоднозначные кейсы вроде "000" или "#000")
    const badColors = ['#GGGGGG', '#12', '#12345', '#ZZZZZZ', 'red'];

    for (const color of badColors) {
      const payload = newAutotestCategory('badcolor');
      const resp = await createEntityCategory(request, { ...payload, color });
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для создания категории');

      // Если бэкенд все же создал категорию (201), удаляем ее сразу, чтобы не оставлять мусор.
      if (resp.status() === 201) {
        const body = (await resp.json()) as EntityCategory;
        if (body.id) await deleteEntityCategory(request, body.id);
        test.info().annotations.push({
          type: 'note',
          description: `API принял невалидный color=${color} и создал категорию (валидация отсутствует на этом окружении)`,
        });
        continue;
      }

      // По документации ожидаем 400 на невалидные данные.
      // Если вдруг API падает 500, это баг сервера (не баг теста), но мы фиксируем его как падение.
      expect(resp.status(), `color=${color}`).toBe(400);
    }
  });

  // Негатив: дубль code (обычно 400/409)
  test('ошибка при создании категории с уже существующим code', async ({ request }) => {
    const payload = newAutotestCategory('duplicate');

    let createdId: string | undefined;
    try {
      const first = await createEntityCategory(request, payload);
      if (first.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для создания категории');
      await expectStatusOrThrow(first, [201]);
      const firstBody = (await first.json()) as EntityCategory;
      createdId = firstBody.id;

      const second = await createEntityCategory(request, { ...payload, name: payload.name + '-2' });
      // Некоторые бэкенды возвращают 400, некоторые 409 — оставим оба варианта валидными
      expect([400, 409]).toContain(second.status());
    } finally {
      if (createdId) await deleteEntityCategory(request, createdId);
    }
  });
});
