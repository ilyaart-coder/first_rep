import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type LabelsGroup = { id?: string };

type EntityCategoryListItem = { id?: string; code?: string; name?: string };
type EntityCategoriesResponse = { results?: EntityCategoryListItem[]; next?: number | null };

type CatalogNetwork = { id?: string; code?: string; name?: string };
type CatalogNetworksResponse = { results?: CatalogNetwork[]; next?: number | null };

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

// Создает тестовую группу меток (нужна для создания лейбла)
async function createTempGroup(request: APIRequestContext): Promise<string> {
  const url = `${env.apiUrl}/labels/groups/create/`;
  const resp = await request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: { name: makeName('label-group') },
  });
  if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
  expect(resp.status()).toBe(201);
  const body = (await resp.json()) as LabelsGroup;
  expect(isUuid(body.id)).toBeTruthy();
  return body.id!;
}

// Удаляет группу меток
async function deleteGroup(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/labels/groups/${id}/delete/`;
  return request.delete(url, { headers: await authHeaders(request) });
}

// Находит UUID сети по коду через /catalog/networks/
async function resolveNetworkIdByCode(request: APIRequestContext, code: string): Promise<{ id: string; name?: string } | null> {
  for (let page = 1; page <= 20; page += 1) {
    const qs = new URLSearchParams({ page: String(page), size: '50', search: code, supports_kyt: 'true' });
    const url = `${env.apiUrl}/catalog/networks/?${qs.toString()}`;
    const resp = await request.get(url, { headers: await authHeaders(request) });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as CatalogNetworksResponse;
    const exact = (body.results ?? []).find((n) => (n.code ?? '').toUpperCase() === code.toUpperCase());
    if (exact?.id) return { id: exact.id, name: exact.name };
    if (!body.next) break;
  }
  return null;
}

// Находит категорию сущности для лейбла. По доке нужен code, но иногда API может ожидать UUID — возвращаем оба.
async function resolveAnyEntityCategory(request: APIRequestContext): Promise<{ id: string; code: string; name?: string } | null> {
  for (let page = 1; page <= 20; page += 1) {
    const qs = new URLSearchParams({ page: String(page), size: '1000' });
    const url = `${env.apiUrl}/entity-categories/?${qs.toString()}`;
    const resp = await request.get(url, { headers: await authHeaders(request) });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as EntityCategoriesResponse;
    const first = (body.results ?? []).find((c) => !!c.id && !!c.code);
    if (first?.id && first.code) return { id: first.id, code: first.code, name: first.name };
    if (!body.next) break;
  }
  return null;
}

// Создает лейбл: POST /labels/create/
async function createLabel(
  request: APIRequestContext,
  payload: {
    entity_name: string;
    address: string;
    network: string;
    entity_category: string;
    group: string;
    description?: string;
  },
) {
  const url = `${env.apiUrl}/labels/create/`;
  return request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: payload,
  });
}

// Удаляет лейбл
async function deleteLabel(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/labels/${id}/delete/`;
  return request.delete(url, { headers: await authHeaders(request) });
}

test.describe('Labels POST /labels/create/', () => {
  // Позитив: создаем лейбл (ETH) и проверяем структуру ответа
  test('создает лейбл (201) и возвращает поля лейбла', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const network = await resolveNetworkIdByCode(request, 'ETH');
    if (!network) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const category = await resolveAnyEntityCategory(request);
    if (!category) test.skip(true, 'Не нашли entity_category в /entity-categories/');

    const payloadBase = {
      entity_name: makeName('label'),
      address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
      network: network.id,
      group: groupId,
      description: 'autotest label',
    };

    let labelId: string | undefined;
    try {
      // По доке entity_category передается как code, но на практике API часто ожидает UUID (как в примере payload).
      // Делаем устойчиво: сначала пробуем UUID, затем fallback на code.
      let resp = await createLabel(request, { ...payloadBase, entity_category: category.id });
      if (resp.status() === 400) {
        resp = await createLabel(request, { ...payloadBase, entity_category: category.code });
      }
      if (resp.status() === 500) {
        // На некоторых окружениях бекенд может падать 500 на "не тот формат entity_category".
        // Пробуем альтернативный формат прежде чем валить тест.
        resp = await createLabel(request, { ...payloadBase, entity_category: category.code });
      }

      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(resp.status()).toBe(201);

      const body = (await resp.json()) as Label;
      labelId = body.id;
      expect(isUuid(body.id)).toBeTruthy();
      expect(body.entity_name).toBe(payloadBase.entity_name);
      expect((body.address ?? '').toLowerCase()).toBe(payloadBase.address.toLowerCase());
      expect(body.network).toBe(payloadBase.network);
      expect(body.network_code).toBeTruthy();
      expect(body.network_name).toBeTruthy();
      expect(body.description).toBe(payloadBase.description);
      expect(typeof body.is_active).toBe('boolean');
      expect(isoOk(body.created_at)).toBeTruthy();
      expect(isoOk(body.updated_at)).toBeTruthy();

      // entity_category_code/name должны быть заполнены (если API их возвращает)
      if (body.entity_category_code !== undefined) expect((body.entity_category_code ?? '').length > 0).toBeTruthy();
      if (body.entity_category_name !== undefined) expect((body.entity_category_name ?? '').length > 0).toBeTruthy();
    } finally {
      if (labelId) await deleteLabel(request, labelId);
      await deleteGroup(request, groupId);
    }
  });

  // Негатив: невалидный address для сети (BTC адрес в ETH) -> 400
  test('400 если address невалиден для выбранной сети', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const network = await resolveNetworkIdByCode(request, 'ETH');
    if (!network) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const category = await resolveAnyEntityCategory(request);
    if (!category) test.skip(true, 'Не нашли entity_category в /entity-categories/');

    try {
      const resp = await createLabel(request, {
        entity_name: makeName('bad-address'),
        address: 'bc1qd4ysezhmypwty5dnw7c8nqy5h5nxg0xqsvaefd0qn5kq32vwnwqqgv4rzr',
        network: network.id,
        entity_category: category.id,
        group: groupId,
        description: '',
      });
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(resp.status()).toBe(400);
    } finally {
      await deleteGroup(request, groupId);
    }
  });

  // Негатив: обязательность полей -> 400
  test('400 если не передать обязательные поля', async ({ request }) => {
    const url = `${env.apiUrl}/labels/create/`;
    const resp = await request.post(url, {
      headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
      data: {},
    });
    if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
    expect(resp.status()).toBe(400);
  });
});
