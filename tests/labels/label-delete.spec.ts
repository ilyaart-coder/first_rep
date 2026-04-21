import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type LabelsGroup = { id?: string };
type Label = { id?: string };
type CatalogNetwork = { id?: string; code?: string };
type CatalogNetworksResponse = { results?: CatalogNetwork[]; next?: number | null };
type EntityCategoryListItem = { id?: string; code?: string };
type EntityCategoriesResponse = { results?: EntityCategoryListItem[]; next?: number | null };

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

async function deleteGroup(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/labels/groups/${id}/delete/`;
  return request.delete(url, { headers: await authHeaders(request) });
}

async function resolveNetworkIdByCode(request: APIRequestContext, code: string): Promise<string | null> {
  for (let page = 1; page <= 20; page += 1) {
    const qs = new URLSearchParams({ page: String(page), size: '50', search: code, supports_kyt: 'true' });
    const url = `${env.apiUrl}/catalog/networks/?${qs.toString()}`;
    const resp = await request.get(url, { headers: await authHeaders(request) });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as CatalogNetworksResponse;
    const exact = (body.results ?? []).find((n) => (n.code ?? '').toUpperCase() === code.toUpperCase());
    if (exact?.id) return exact.id;
    if (!body.next) break;
  }
  return null;
}

async function resolveAnyEntityCategory(request: APIRequestContext): Promise<{ id: string; code: string } | null> {
  for (let page = 1; page <= 20; page += 1) {
    const qs = new URLSearchParams({ page: String(page), size: '1000' });
    const url = `${env.apiUrl}/entity-categories/?${qs.toString()}`;
    const resp = await request.get(url, { headers: await authHeaders(request) });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as EntityCategoriesResponse;
    const first = (body.results ?? []).find((c) => !!c.id && !!c.code);
    if (first?.id && first.code) return { id: first.id, code: first.code };
    if (!body.next) break;
  }
  return null;
}

async function createLabel(request: APIRequestContext, payload: any) {
  const url = `${env.apiUrl}/labels/create/`;
  return request.post(url, { headers: { ...(await authHeaders(request)), 'content-type': 'application/json' }, data: payload });
}

async function deleteLabel(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/labels/${id}/delete/`;
  return request.delete(url, { headers: await authHeaders(request) });
}

test.describe('Labels DELETE /labels/{id}/delete/', () => {
  // Создаем лейбл, удаляем (204), повторное удаление -> 404
  test('удаляет лейбл (204) и повторное удаление возвращает 404', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const networkId = await resolveNetworkIdByCode(request, 'ETH');
    if (!networkId) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const category = await resolveAnyEntityCategory(request);
    if (!category) test.skip(true, 'Не нашли entity_category в /entity-categories/');

    let labelId: string | undefined;
    try {
      let resp = await createLabel(request, {
        entity_name: makeName('label-del'),
        address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
        network: networkId,
        entity_category: category.id,
        group: groupId,
        description: '',
      });
      if (resp.status() === 400 || resp.status() === 500) {
        resp = await createLabel(request, {
          entity_name: makeName('label-del'),
          address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
          network: networkId,
          entity_category: category.code,
          group: groupId,
          description: '',
        });
      }
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(resp.status()).toBe(201);
      labelId = ((await resp.json()) as Label).id;
      expect(isUuid(labelId)).toBeTruthy();

      const del = await deleteLabel(request, labelId!);
      if (del.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(del.status()).toBe(204);

      const del2 = await deleteLabel(request, labelId!);
      expect(del2.status()).toBe(404);
    } finally {
      // если по какой-то причине не удалилось, не скрываем проблему: группа может не удалиться если есть лейблы
      await deleteGroup(request, groupId);
    }
  });

  // Негатив: несуществующий id -> 404
  test('404 если лейбл не найден', async ({ request }) => {
    const resp = await deleteLabel(request, '00000000-0000-0000-0000-000000000000');
    if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
    expect(resp.status()).toBe(404);
  });
});
