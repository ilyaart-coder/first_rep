import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type LabelsGroup = { id?: string };

type CatalogNetwork = { id?: string; code?: string; name?: string };
type CatalogNetworksResponse = { results?: CatalogNetwork[]; next?: number | null };

type EntityCategoryListItem = { id?: string; code?: string; name?: string };
type EntityCategoriesResponse = { results?: EntityCategoryListItem[]; next?: number | null };

type Label = {
  id?: string;
  entity_name?: string;
  address?: string;
  network?: string;
  network_code?: string;
  network_name?: string;
  entity_category?: string;
  entity_category_code?: string;
  entity_category_name?: string;
  description?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

type GroupLabelsResponse = {
  count?: number;
  pages?: number;
  next?: string | number | null;
  previous?: string | number | null;
  results?: Label[];
};

async function authHeaders(request: APIRequestContext) {
  const access = await getValidAccessToken(request);
  return { accept: 'application/json', authorization: `Bearer ${access}` };
}

function makeName(prefix: string) {
  return `autotest-${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function isUuid(value: string | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isoOk(value: unknown): boolean {
  return typeof value === 'string' && Number.isNaN(Date.parse(value)) === false;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

// Создаёт временную группу меток (для тестов /labels/groups/{id}/labels/)
async function createTempGroup(request: APIRequestContext): Promise<string> {
  const url = `${env.apiUrl}/labels/groups/create/`;
  const resp = await request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: { name: makeName('labels-in-group') },
  });
  if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
  expect(resp.status()).toBe(201);
  const body = (await resp.json()) as LabelsGroup;
  expect(isUuid(body.id)).toBeTruthy();
  return body.id!;
}

// Удаляет группу меток (вместе с метками внутри)
async function deleteGroup(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/labels/groups/${id}/delete/`;
  return request.delete(url, { headers: await authHeaders(request) });
}

// Удаляет лейбл
async function deleteLabel(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/labels/${id}/delete/`;
  return request.delete(url, { headers: await authHeaders(request) });
}

// Находит сеть по коду (ETH/BSC/TRX/BTC и т.п.) через /catalog/networks/
async function resolveNetworkByCode(request: APIRequestContext, code: string): Promise<{ id: string; code: string; name?: string } | null> {
  for (let page = 1; page <= 20; page += 1) {
    const qs = new URLSearchParams({ page: String(page), size: '50', search: code, supports_kyt: 'true' });
    const url = `${env.apiUrl}/catalog/networks/?${qs.toString()}`;
    const resp = await request.get(url, { headers: await authHeaders(request) });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as CatalogNetworksResponse;
    const exact = (body.results ?? []).find((n) => (n.code ?? '').toUpperCase() === code.toUpperCase());
    if (exact?.id && exact.code) return { id: exact.id, code: exact.code, name: exact.name };
    if (!body.next) break;
  }
  return null;
}

// Находит 2 категории сущностей (чтобы проверить фильтр entity_category)
async function resolveTwoEntityCategories(request: APIRequestContext): Promise<Array<{ id: string; code?: string }>> {
  const collected: Array<{ id: string; code?: string }> = [];
  for (let page = 1; page <= 20; page += 1) {
    const qs = new URLSearchParams({ page: String(page), size: '1000' });
    const url = `${env.apiUrl}/entity-categories/?${qs.toString()}`;
    const resp = await request.get(url, { headers: await authHeaders(request) });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as EntityCategoriesResponse;
    for (const c of body.results ?? []) {
      if (c.id) collected.push({ id: c.id, code: c.code });
      if (collected.length >= 2) return collected;
    }
    if (!body.next) break;
  }
  return collected;
}

// Создаёт лейбл: POST /labels/create/
async function createLabel(
  request: APIRequestContext,
  payload: { entity_name: string; address: string; network: string; entity_category: string; group: string; description?: string; is_active?: boolean },
) {
  const url = `${env.apiUrl}/labels/create/`;
  return request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: payload,
  });
}

// Делает запрос: GET /labels/groups/{id}/labels/
async function getGroupLabels(request: APIRequestContext, groupId: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const url = `${env.apiUrl}/labels/groups/${groupId}/labels/${suffix}`;
  return request.get(url, { headers: await authHeaders(request) });
}

function assertLabelShape(item: Label) {
  expect(isUuid(item.id)).toBeTruthy();
  expect(typeof item.entity_name).toBe('string');
  expect((item.entity_name ?? '').length > 0).toBeTruthy();
  expect(typeof item.address).toBe('string');
  expect((item.address ?? '').length > 0).toBeTruthy();
  expect(isUuid(item.network)).toBeTruthy();
  expect(typeof item.network_code).toBe('string');
  expect((item.network_code ?? '').length > 0).toBeTruthy();
  expect(typeof item.network_name).toBe('string');
  expect((item.network_name ?? '').length > 0).toBeTruthy();
  expect(isUuid(item.entity_category)).toBeTruthy();
  expect(typeof item.entity_category_code).toBe('string');
  expect((item.entity_category_code ?? '').length > 0).toBeTruthy();
  expect(typeof item.entity_category_name).toBe('string');
  expect((item.entity_category_name ?? '').length > 0).toBeTruthy();
  const descOk = item.description === null || item.description === undefined || typeof item.description === 'string';
  expect(descOk).toBeTruthy();
  expect(typeof item.is_active).toBe('boolean');
  expect(isoOk(item.created_at)).toBeTruthy();
  expect(isoOk(item.updated_at)).toBeTruthy();
}

test.describe('Labels GET /labels/groups/{id}/labels/', () => {
  // Базовая проверка: структура ответа + наличие созданных меток
  test('возвращает список меток группы с корректной структурой', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const network = await resolveNetworkByCode(request, 'ETH');
    if (!network) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const categories = await resolveTwoEntityCategories(request);
    if (categories.length === 0) test.skip(true, 'Не нашли категории в /entity-categories/');

    const cat1 = categories[0];
    const cat2 = categories[1] ?? categories[0];

    const createdLabelIds: string[] = [];
    try {
      // Создаём 2 лейбла в одной группе, чтобы было что фильтровать/сортировать.
      const resp1 = await createLabel(request, {
        entity_name: makeName('label-a'),
        address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
        network: network.id,
        entity_category: cat1.id,
        group: groupId,
        description: 'desc-a',
      });
      if (resp1.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(resp1.status()).toBe(201);
      createdLabelIds.push(((await resp1.json()) as Label).id!);

      const resp2 = await createLabel(request, {
        entity_name: makeName('label-b'),
        address: '0x28F86ed030fd080a07Dc4AbcDE6e04ee67517F10',
        network: network.id,
        entity_category: cat2.id,
        group: groupId,
        description: 'desc-b',
      });
      if (resp2.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(resp2.status()).toBe(201);
      createdLabelIds.push(((await resp2.json()) as Label).id!);

      const response = await getGroupLabels(request, groupId, { page: '1', size: '25' });
      expect(response.status()).toBe(200);
      const body = (await response.json()) as GroupLabelsResponse;

      expect(typeof body.count).toBe('number');
      expect(typeof body.pages).toBe('number');
      expect(body.next === null || typeof body.next === 'string' || typeof body.next === 'number').toBeTruthy();
      expect(body.previous === null || typeof body.previous === 'string' || typeof body.previous === 'number').toBeTruthy();
      expect(Array.isArray(body.results)).toBeTruthy();
      expect((body.results ?? []).length > 0).toBeTruthy();

      for (const item of body.results ?? []) assertLabelShape(item);

      const returnedIds = new Set((body.results ?? []).map((x) => x.id));
      // Наши 2 лейбла должны быть в группе (обычно попадут на 1 страницу)
      for (const id of createdLabelIds) expect(returnedIds.has(id)).toBeTruthy();
    } finally {
      for (const id of createdLabelIds) {
        if (id) await deleteLabel(request, id);
      }
      await deleteGroup(request, groupId);
    }
  });

  // Пагинация: size=1 -> максимум 1 элемент
  test('пагинация size=1 возвращает максимум 1 элемент', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const network = await resolveNetworkByCode(request, 'ETH');
    if (!network) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const categories = await resolveTwoEntityCategories(request);
    if (categories.length === 0) test.skip(true, 'Не нашли категории в /entity-categories/');

    const createdLabelIds: string[] = [];
    try {
      // Создаём 2 лейбла, чтобы пагинация имела смысл
      const r1 = await createLabel(request, {
        entity_name: makeName('p1'),
        address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
        network: network.id,
        entity_category: categories[0].id,
        group: groupId,
        description: 'p1',
      });
      if (r1.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(r1.status()).toBe(201);
      createdLabelIds.push(((await r1.json()) as Label).id!);

      const r2 = await createLabel(request, {
        entity_name: makeName('p2'),
        address: '0x28F86ed030fd080a07Dc4AbcDE6e04ee67517F10',
        network: network.id,
        entity_category: (categories[1] ?? categories[0]).id,
        group: groupId,
        description: 'p2',
      });
      if (r2.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(r2.status()).toBe(201);
      createdLabelIds.push(((await r2.json()) as Label).id!);

      const response = await getGroupLabels(request, groupId, { page: '1', size: '1' });
      expect(response.status()).toBe(200);
      const body = (await response.json()) as GroupLabelsResponse;
      expect((body.results ?? []).length <= 1).toBeTruthy();
    } finally {
      for (const id of createdLabelIds) {
        if (id) await deleteLabel(request, id);
      }
      await deleteGroup(request, groupId);
    }
  });

  // Search: по описанию (description)
  test('search фильтрует по описанию (description)', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const network = await resolveNetworkByCode(request, 'ETH');
    if (!network) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const categories = await resolveTwoEntityCategories(request);
    if (categories.length === 0) test.skip(true, 'Не нашли категории в /entity-categories/');

    const createdLabelIds: string[] = [];
    const marker = `marker-${Date.now().toString(36)}`;
    try {
      const r1 = await createLabel(request, {
        entity_name: makeName('s1'),
        address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
        network: network.id,
        entity_category: categories[0].id,
        group: groupId,
        description: `desc ${marker}`,
      });
      if (r1.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(r1.status()).toBe(201);
      createdLabelIds.push(((await r1.json()) as Label).id!);

      // Второй лейбл без marker, чтобы проверить фильтрацию
      const r2 = await createLabel(request, {
        entity_name: makeName('s2'),
        address: '0x28F86ed030fd080a07Dc4AbcDE6e04ee67517F10',
        network: network.id,
        entity_category: (categories[1] ?? categories[0]).id,
        group: groupId,
        description: 'no marker here',
      });
      if (r2.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(r2.status()).toBe(201);
      createdLabelIds.push(((await r2.json()) as Label).id!);

      const response = await getGroupLabels(request, groupId, { page: '1', size: '25', search: marker });
      expect(response.status()).toBe(200);
      const body = (await response.json()) as GroupLabelsResponse;
      expect((body.results ?? []).length > 0).toBeTruthy();
      for (const item of body.results ?? []) {
        expect(((item.description ?? '') as string).toLowerCase()).toContain(marker.toLowerCase());
      }
    } finally {
      for (const id of createdLabelIds) {
        if (id) await deleteLabel(request, id);
      }
      await deleteGroup(request, groupId);
    }
  });

  // Фильтр network: UUID сети
  test('фильтр network возвращает только метки этой сети', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const network = await resolveNetworkByCode(request, 'ETH');
    if (!network) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const categories = await resolveTwoEntityCategories(request);
    if (categories.length === 0) test.skip(true, 'Не нашли категории в /entity-categories/');

    const createdLabelIds: string[] = [];
    try {
      const r1 = await createLabel(request, {
        entity_name: makeName('n1'),
        address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
        network: network.id,
        entity_category: categories[0].id,
        group: groupId,
        description: 'n1',
      });
      if (r1.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(r1.status()).toBe(201);
      createdLabelIds.push(((await r1.json()) as Label).id!);

      const response = await getGroupLabels(request, groupId, { page: '1', size: '25', network: network.id });
      expect(response.status()).toBe(200);
      const body = (await response.json()) as GroupLabelsResponse;
      for (const item of body.results ?? []) {
        expect(item.network).toBe(network.id);
        expect((item.network_code ?? '').toUpperCase()).toBe(network.code.toUpperCase());
      }
    } finally {
      for (const id of createdLabelIds) {
        if (id) await deleteLabel(request, id);
      }
      await deleteGroup(request, groupId);
    }
  });

  // Фильтр entity_category: UUID категории
  test('фильтр entity_category возвращает только метки этой категории', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const network = await resolveNetworkByCode(request, 'ETH');
    if (!network) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const categories = await resolveTwoEntityCategories(request);
    if (categories.length < 2) test.skip(true, 'Нужно минимум 2 категории для проверки entity_category фильтра');

    const cat1 = categories[0];
    const cat2 = categories[1];
    const createdLabelIds: string[] = [];
    try {
      const r1 = await createLabel(request, {
        entity_name: makeName('c1'),
        address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
        network: network.id,
        entity_category: cat1.id,
        group: groupId,
        description: 'cat1',
      });
      if (r1.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(r1.status()).toBe(201);
      createdLabelIds.push(((await r1.json()) as Label).id!);

      const r2 = await createLabel(request, {
        entity_name: makeName('c2'),
        address: '0x28F86ed030fd080a07Dc4AbcDE6e04ee67517F10',
        network: network.id,
        entity_category: cat2.id,
        group: groupId,
        description: 'cat2',
      });
      if (r2.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(r2.status()).toBe(201);
      createdLabelIds.push(((await r2.json()) as Label).id!);

      const response = await getGroupLabels(request, groupId, { page: '1', size: '25', entity_category: cat1.id });
      expect(response.status()).toBe(200);
      const body = (await response.json()) as GroupLabelsResponse;
      expect((body.results ?? []).length > 0).toBeTruthy();
      for (const item of body.results ?? []) {
        expect(item.entity_category).toBe(cat1.id);
      }
    } finally {
      for (const id of createdLabelIds) {
        if (id) await deleteLabel(request, id);
      }
      await deleteGroup(request, groupId);
    }
  });

  // order_by: created_at_asc/created_at_desc
  test('order_by=created_at_asc сортирует по created_at по возрастанию', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const network = await resolveNetworkByCode(request, 'ETH');
    if (!network) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const categories = await resolveTwoEntityCategories(request);
    if (categories.length === 0) test.skip(true, 'Не нашли категории в /entity-categories/');

    const createdLabelIds: string[] = [];
    try {
      const r1 = await createLabel(request, {
        entity_name: makeName('o1'),
        address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
        network: network.id,
        entity_category: categories[0].id,
        group: groupId,
        description: 'o1',
      });
      if (r1.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(r1.status()).toBe(201);
      createdLabelIds.push(((await r1.json()) as Label).id!);

      const r2 = await createLabel(request, {
        entity_name: makeName('o2'),
        address: '0x28F86ed030fd080a07Dc4AbcDE6e04ee67517F10',
        network: network.id,
        entity_category: (categories[1] ?? categories[0]).id,
        group: groupId,
        description: 'o2',
      });
      if (r2.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(r2.status()).toBe(201);
      createdLabelIds.push(((await r2.json()) as Label).id!);

      const response = await getGroupLabels(request, groupId, { page: '1', size: '25', order_by: 'created_at_asc' });
      expect(response.status()).toBe(200);
      const body = (await response.json()) as GroupLabelsResponse;
      const times = (body.results ?? []).map((x) => numOrNull(x.created_at ? Date.parse(x.created_at) : null)).filter((x): x is number => x !== null);
      for (let i = 1; i < times.length; i += 1) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      }
    } finally {
      for (const id of createdLabelIds) {
        if (id) await deleteLabel(request, id);
      }
      await deleteGroup(request, groupId);
    }
  });

  test('order_by=created_at_desc сортирует по created_at по убыванию', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const network = await resolveNetworkByCode(request, 'ETH');
    if (!network) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const categories = await resolveTwoEntityCategories(request);
    if (categories.length === 0) test.skip(true, 'Не нашли категории в /entity-categories/');

    const createdLabelIds: string[] = [];
    try {
      const r1 = await createLabel(request, {
        entity_name: makeName('od1'),
        address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
        network: network.id,
        entity_category: categories[0].id,
        group: groupId,
        description: 'od1',
      });
      if (r1.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(r1.status()).toBe(201);
      createdLabelIds.push(((await r1.json()) as Label).id!);

      const r2 = await createLabel(request, {
        entity_name: makeName('od2'),
        address: '0x28F86ed030fd080a07Dc4AbcDE6e04ee67517F10',
        network: network.id,
        entity_category: (categories[1] ?? categories[0]).id,
        group: groupId,
        description: 'od2',
      });
      if (r2.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(r2.status()).toBe(201);
      createdLabelIds.push(((await r2.json()) as Label).id!);

      const response = await getGroupLabels(request, groupId, { page: '1', size: '25', order_by: 'created_at_desc' });
      expect(response.status()).toBe(200);
      const body = (await response.json()) as GroupLabelsResponse;
      const times = (body.results ?? []).map((x) => numOrNull(x.created_at ? Date.parse(x.created_at) : null)).filter((x): x is number => x !== null);
      for (let i = 1; i < times.length; i += 1) {
        expect(times[i]).toBeLessThanOrEqual(times[i - 1]);
      }
    } finally {
      for (const id of createdLabelIds) {
        if (id) await deleteLabel(request, id);
      }
      await deleteGroup(request, groupId);
    }
  });

  // Негатив: 404 если группа не найдена
  test('404 если группа не найдена', async ({ request }) => {
    const resp = await getGroupLabels(request, '00000000-0000-0000-0000-000000000000', { page: '1', size: '25' });
    expect(resp.status()).toBe(404);
  });

  // Негатив: 401 без авторизации
  test('401 без авторизации', async ({ request }) => {
    const url = `${env.apiUrl}/labels/groups/00000000-0000-0000-0000-000000000000/labels/?page=1&size=25`;
    const resp = await request.get(url, { headers: { accept: 'application/json' } });
    expect(resp.status()).toBe(401);
  });
});

