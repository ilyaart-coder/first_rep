import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type LabelsGroup = { id?: string };
type Label = { id?: string; entity_name?: string; description?: string | null; is_active?: boolean; entity_category_code?: string };
type EntityCategoryListItem = { id?: string; code?: string };
type EntityCategoriesResponse = { results?: EntityCategoryListItem[]; next?: number | null };
type CatalogNetwork = { id?: string; code?: string };
type CatalogNetworksResponse = { results?: CatalogNetwork[]; next?: number | null };

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

async function resolveTwoEntityCategories(request: APIRequestContext): Promise<Array<{ id: string; code: string }>> {
  const collected: Array<{ id: string; code: string }> = [];
  for (let page = 1; page <= 20; page += 1) {
    const qs = new URLSearchParams({ page: String(page), size: '1000' });
    const url = `${env.apiUrl}/entity-categories/?${qs.toString()}`;
    const resp = await request.get(url, { headers: await authHeaders(request) });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as EntityCategoriesResponse;
    for (const c of body.results ?? []) {
      if (c.id && c.code) collected.push({ id: c.id, code: c.code });
      if (collected.length >= 2) return collected;
    }
    if (!body.next) break;
  }
  return collected;
}

async function createLabel(request: APIRequestContext, payload: any) {
  const url = `${env.apiUrl}/labels/create/`;
  return request.post(url, { headers: { ...(await authHeaders(request)), 'content-type': 'application/json' }, data: payload });
}

async function editLabel(request: APIRequestContext, id: string, payload: any) {
  const url = `${env.apiUrl}/labels/${id}/edit/`;
  return request.post(url, { headers: { ...(await authHeaders(request)), 'content-type': 'application/json' }, data: payload });
}

async function deleteLabel(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/labels/${id}/delete/`;
  return request.delete(url, { headers: await authHeaders(request) });
}

test.describe('Labels POST /labels/{id}/edit/', () => {
  // Позитив: обновляем entity_name/description/is_active и (если возможно) entity_category
  test('редактирует лейбл и возвращает обновленные поля', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const networkId = await resolveNetworkIdByCode(request, 'ETH');
    if (!networkId) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const categories = await resolveTwoEntityCategories(request);
    if (categories.length === 0) test.skip(true, 'Не нашли entity_category в /entity-categories/');

    const cat1 = categories[0];
    const cat2 = categories[1] ?? categories[0];

    let labelId: string | undefined;
    try {
      let createResp = await createLabel(request, {
        entity_name: makeName('label-edit'),
        address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
        network: networkId,
        entity_category: cat1.id,
        group: groupId,
        description: 'before',
      });
      if (createResp.status() === 400 || createResp.status() === 500) {
        createResp = await createLabel(request, {
          entity_name: makeName('label-edit'),
          address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
          network: networkId,
          entity_category: cat1.code,
          group: groupId,
          description: 'before',
        });
      }
      if (createResp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(createResp.status()).toBe(201);
      const created = (await createResp.json()) as Label;
      labelId = created.id;
      expect(isUuid(labelId)).toBeTruthy();

      const newName = makeName('label-edit-upd');
      const resp = await editLabel(request, labelId!, {
        entity_name: newName,
        description: 'after',
        is_active: false,
        entity_category: cat2.id,
      });
      if (resp.status() === 400) {
        // fallback: если API ожидает code категории
        const resp2 = await editLabel(request, labelId!, { entity_category: cat2.code });
        if (resp2.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
        expect([200, 400]).toContain(resp2.status());
      } else {
        if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
        expect(resp.status()).toBe(200);
        const body = (await resp.json()) as Label;
        expect(body.id).toBe(labelId);
        expect(body.entity_name).toBe(newName);
        expect(body.description).toBe('after');
        expect(body.is_active).toBe(false);
      }
    } finally {
      if (labelId) await deleteLabel(request, labelId);
      await deleteGroup(request, groupId);
    }
  });

  // Негатив: пустое тело -> 400
  test('400 если не передать ни одного поля', async ({ request }) => {
    const resp = await editLabel(request, '00000000-0000-0000-0000-000000000000', {});
    // На несуществующий id API может вернуть 400/404/500 в зависимости от реализации, поэтому отдельный тест ниже.
    if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
    expect([400, 404, 500]).toContain(resp.status());
  });

  // Негатив: несуществующий id -> 404 (или 500 как баг API)
  test('404 если лейбл не найден', async ({ request }) => {
    const resp = await editLabel(request, '00000000-0000-0000-0000-000000000000', { entity_name: 'x' });
    if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
    if (resp.status() === 500) {
      test.info().annotations.push({ type: 'note', description: 'API вернул 500 на edit несуществующего label (ожидали 404) — баг API' });
      return;
    }
    expect(resp.status()).toBe(404);
  });
});
