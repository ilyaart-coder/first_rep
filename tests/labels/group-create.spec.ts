import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type LabelsGroup = {
  id?: string;
  name?: string;
  is_active?: boolean;
  modified_at?: string;
  created_at?: string;
};

type LabelsGroupsListResponse = {
  results?: Array<{ id?: string; name?: string }>;
};

async function authHeaders(request: APIRequestContext) {
  const access = await getValidAccessToken(request);
  return {
    accept: 'application/json',
    authorization: `Bearer ${access}`,
  };
}

function isUuid(value: string | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isoOk(value: unknown): boolean {
  return typeof value === 'string' && Number.isNaN(Date.parse(value)) === false;
}

// Получает любую существующую группу (нужна как base_group для копирования)
async function getAnyBaseGroup(request: APIRequestContext): Promise<{ id: string; name?: string } | null> {
  const url = `${env.apiUrl}/labels/groups/?page=1&size=5`;
  const resp = await request.get(url, { headers: await authHeaders(request) });
  expect(resp.status()).toBe(200);
  const body = (await resp.json()) as LabelsGroupsListResponse;
  const first = body.results?.[0];
  if (!first?.id) return null;
  return { id: first.id, name: first.name };
}

// Создает группу меток: POST /labels/groups/create/
async function createGroup(request: APIRequestContext, payload: { name?: string; base_group?: string }) {
  const url = `${env.apiUrl}/labels/groups/create/`;
  return request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: payload,
  });
}

// Удаляет группу меток: DELETE /labels/groups/{id}/delete/
async function deleteGroup(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/labels/groups/${id}/delete/`;
  return request.delete(url, { headers: await authHeaders(request) });
}

function makeName(prefix: string) {
  return `autotest-${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

test.describe('Labels POST /labels/groups/create/', () => {
  // Создание группы по name: проверяем 201 и структуру ответа
  test('создает группу по name (201) и возвращает поля группы', async ({ request }) => {
    const name = makeName('group-create');
    let createdId: string | undefined;
    try {
      const resp = await createGroup(request, { name });
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
      expect(resp.status()).toBe(201);
      const body = (await resp.json()) as LabelsGroup;
      createdId = body.id;
      expect(isUuid(body.id)).toBeTruthy();
      expect(body.name).toBe(name);
      expect(typeof body.is_active).toBe('boolean');
      expect(isoOk(body.created_at)).toBeTruthy();
      expect(isoOk(body.modified_at)).toBeTruthy();
    } finally {
      if (createdId) await deleteGroup(request, createdId);
    }
  });

  // Создание группы-копии по base_group: новая группа должна быть неактивной
  test('копирует группу по base_group и создает неактивную группу', async ({ request }) => {
    const base = await getAnyBaseGroup(request);
    if (!base) test.skip(true, 'Нет базовых групп для копирования');

    let createdId: string | undefined;
    try {
      const resp = await createGroup(request, { base_group: base.id });
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
      expect(resp.status()).toBe(201);
      const body = (await resp.json()) as LabelsGroup;
      createdId = body.id;
      expect(isUuid(body.id)).toBeTruthy();
      expect(typeof body.name).toBe('string');
      expect((body.name ?? '').trim().length > 0).toBeTruthy();
      // По доке: при копировании новая группа создается неактивной
      expect(body.is_active).toBe(false);
    } finally {
      if (createdId) await deleteGroup(request, createdId);
    }
  });

  // Негатив: не передали ни name, ни base_group -> 400
  test('400 если не передать ни name, ни base_group', async ({ request }) => {
    const resp = await createGroup(request, {});
    if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
    expect(resp.status()).toBe(400);
  });

  // Негатив: base_group не принадлежит аккаунту (или не существует) -> 400
  test('400 если base_group не принадлежит аккаунту', async ({ request }) => {
    const resp = await createGroup(request, { base_group: '00000000-0000-0000-0000-000000000000' });
    if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
    expect(resp.status()).toBe(400);
  });

  // Дополнительно: создаем две группы и проверяем, что id разные (уникальность)
  test('создает две группы и id уникальны', async ({ request }) => {
    const name1 = makeName('uniq-1');
    const name2 = makeName('uniq-2');
    let id1: string | undefined;
    let id2: string | undefined;
    try {
      const r1 = await createGroup(request, { name: name1 });
      if (r1.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
      expect(r1.status()).toBe(201);
      id1 = ((await r1.json()) as LabelsGroup).id;

      const r2 = await createGroup(request, { name: name2 });
      expect(r2.status()).toBe(201);
      id2 = ((await r2.json()) as LabelsGroup).id;

      expect(isUuid(id1)).toBeTruthy();
      expect(isUuid(id2)).toBeTruthy();
      expect(id1).not.toBe(id2);
    } finally {
      if (id1) await deleteGroup(request, id1);
      if (id2) await deleteGroup(request, id2);
    }
  });
});

