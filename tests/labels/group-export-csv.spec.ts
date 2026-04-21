import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type LabelsGroup = { id?: string; name?: string };
type CatalogNetwork = { id?: string; code?: string; name?: string };
type CatalogNetworksResponse = { results?: CatalogNetwork[]; next?: number | null };
type EntityCategoryListItem = { id?: string; code?: string; name?: string };
type EntityCategoriesResponse = { results?: EntityCategoryListItem[]; next?: number | null };
type Label = { id?: string };

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

// Создаёт временную группу меток (нужна для тестов export-csv/import-csv)
async function createTempGroup(request: APIRequestContext): Promise<string> {
  const url = `${env.apiUrl}/labels/groups/create/`;
  const resp = await request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: { name: makeName('csv-group') },
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

// Находит любую категорию сущностей (для создания лейбла)
async function resolveAnyEntityCategory(request: APIRequestContext): Promise<{ id: string; code?: string; name?: string } | null> {
  for (let page = 1; page <= 20; page += 1) {
    const qs = new URLSearchParams({ page: String(page), size: '1000' });
    const url = `${env.apiUrl}/entity-categories/?${qs.toString()}`;
    const resp = await request.get(url, { headers: await authHeaders(request) });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as EntityCategoriesResponse;
    const first = (body.results ?? []).find((c) => !!c.id);
    if (first?.id) return { id: first.id, code: first.code, name: first.name };
    if (!body.next) break;
  }
  return null;
}

// Создаёт лейбл в группе (нужен, чтобы экспорт содержал хотя бы одну строку данных)
async function createLabel(
  request: APIRequestContext,
  payload: { entity_name: string; address: string; network: string; entity_category: string; group: string; description?: string },
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

// GET /labels/groups/{id}/export-csv/
async function exportCsv(request: APIRequestContext, groupId: string) {
  const url = `${env.apiUrl}/labels/groups/${groupId}/export-csv/`;
  return request.get(url, { headers: await authHeaders(request) });
}

function parseCsvLines(csvText: string): string[] {
  // Нормализуем переносы строк, чтобы не зависеть от CRLF/LF
  return csvText.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
}

test.describe('Labels GET /labels/groups/{id}/export-csv/', () => {
  // Экспорт пустой группы: ожидаем CSV с BOM и только заголовок (без данных)
  test('экспортирует пустую группу: CSV с BOM и заголовком', async ({ request }) => {
    const groupId = await createTempGroup(request);
    try {
      const resp = await exportCsv(request, groupId);
      expect(resp.status()).toBe(200);

      const cd = resp.headers()['content-disposition'] ?? resp.headers()['Content-Disposition'];
      expect(cd).toBeTruthy();
      expect((cd ?? '').toLowerCase()).toContain('attachment');
      expect((cd ?? '').toLowerCase()).toContain('.csv');

      const buffer = await resp.body();
      const text = buffer.toString('utf-8');

      // BOM (UTF-8) = \uFEFF
      expect(text.charCodeAt(0)).toBe(0xfeff);

      const lines = parseCsvLines(text);
      expect(lines.length).toBe(1);

      const header = lines[0].replace(/^\uFEFF/, '');
      expect(header).toBe('network,address,entity_name,entity_category,description,is_active');
    } finally {
      await deleteGroup(request, groupId);
    }
  });

  // Экспорт непустой группы: создаём 1 лейбл и проверяем, что экспорт содержит хотя бы 2 строки (header + data)
  test('экспортирует группу с лейблом: CSV содержит строки данных', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const network = await resolveNetworkByCode(request, 'ETH');
    if (!network) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const category = await resolveAnyEntityCategory(request);
    if (!category) test.skip(true, 'Не нашли категорию в /entity-categories/');

    let labelId: string | undefined;
    try {
      // Для labels/create/ на этом окружении entity_category ожидается UUID (поэтому используем category.id).
      const createResp = await createLabel(request, {
        entity_name: makeName('csv-label'),
        address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
        network: network.id,
        entity_category: category.id,
        group: groupId,
        description: 'csv export',
      });
      if (createResp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(createResp.status()).toBe(201);
      labelId = ((await createResp.json()) as Label).id;
      expect(isUuid(labelId)).toBeTruthy();

      const resp = await exportCsv(request, groupId);
      expect(resp.status()).toBe(200);
      const text = (await resp.body()).toString('utf-8');
      expect(text.charCodeAt(0)).toBe(0xfeff);

      const lines = parseCsvLines(text);
      expect(lines.length >= 2).toBeTruthy();

      const header = lines[0].replace(/^\uFEFF/, '');
      expect(header).toBe('network,address,entity_name,entity_category,description,is_active');

      // Минимальная проверка строки данных: есть адрес и имя сущности
      const dataLine = lines[1];
      expect(dataLine.toLowerCase()).toContain('0xe04f3dc758891f4e89b326b24d0a0c656c6e54a2'.toLowerCase());
      expect(dataLine).toContain('csv');
    } finally {
      if (labelId) await deleteLabel(request, labelId);
      await deleteGroup(request, groupId);
    }
  });

  // Негатив: несуществующая группа -> 404
  test('404 если группа не найдена', async ({ request }) => {
    const resp = await exportCsv(request, '00000000-0000-0000-0000-000000000000');
    expect(resp.status()).toBe(404);
  });

  // Негатив: без авторизации -> 401
  test('401 без авторизации', async ({ request }) => {
    const url = `${env.apiUrl}/labels/groups/00000000-0000-0000-0000-000000000000/export-csv/`;
    const resp = await request.get(url, { headers: { accept: 'application/json' } });
    expect(resp.status()).toBe(401);
  });
});

