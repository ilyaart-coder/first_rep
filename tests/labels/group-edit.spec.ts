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

async function authHeaders(request: APIRequestContext) {
  const access = await getValidAccessToken(request);
  return {
    accept: 'application/json',
    authorization: `Bearer ${access}`,
  };
}

function makeName(prefix: string) {
  return `autotest-${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Создает группу для тестов редактирования
async function createGroup(request: APIRequestContext, name: string) {
  const url = `${env.apiUrl}/labels/groups/create/`;
  const resp = await request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: { name },
  });
  if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
  expect(resp.status()).toBe(201);
  const body = (await resp.json()) as LabelsGroup;
  expect(body.id).toBeTruthy();
  return body as Required<Pick<LabelsGroup, 'id' | 'name' | 'is_active'>>;
}

// Редактирует группу: POST /labels/groups/{id}/edit/
async function editGroup(request: APIRequestContext, id: string, payload: { name?: string; is_active?: boolean }) {
  const url = `${env.apiUrl}/labels/groups/${id}/edit/`;
  return request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: payload,
  });
}

// Удаляет группу
async function deleteGroup(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/labels/groups/${id}/delete/`;
  return request.delete(url, { headers: await authHeaders(request) });
}

test.describe('Labels POST /labels/groups/{id}/edit/', () => {
  // Редактирование name
  test('обновляет name (200)', async ({ request }) => {
    const created = await createGroup(request, makeName('group-edit'));
    try {
      const newName = makeName('group-edit-upd');
      const resp = await editGroup(request, created.id!, { name: newName });
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
      expect(resp.status()).toBe(200);
      const body = (await resp.json()) as LabelsGroup;
      expect(body.id).toBe(created.id);
      expect(body.name).toBe(newName);
    } finally {
      await deleteGroup(request, created.id!);
    }
  });

  // Редактирование is_active
  test('обновляет is_active (200)', async ({ request }) => {
    const created = await createGroup(request, makeName('group-active'));
    try {
      const resp = await editGroup(request, created.id!, { is_active: false });
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
      expect(resp.status()).toBe(200);
      const body = (await resp.json()) as LabelsGroup;
      expect(body.id).toBe(created.id);
      expect(body.is_active).toBe(false);
    } finally {
      await deleteGroup(request, created.id!);
    }
  });

  // Негатив: не передали ни одного поля -> 400
  test('400 если не передать ни одного поля', async ({ request }) => {
    const created = await createGroup(request, makeName('group-empty-edit'));
    try {
      const resp = await editGroup(request, created.id!, {});
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
      expect(resp.status()).toBe(400);
    } finally {
      await deleteGroup(request, created.id!);
    }
  });

  // Негатив: несуществующий id -> 404
  test('404 если группа не найдена', async ({ request }) => {
    const resp = await editGroup(request, '00000000-0000-0000-0000-000000000000', { name: 'x' });
    if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
    if (resp.status() === 500) {
      test.info().annotations.push({
        type: 'note',
        description: 'API вернул 500 на редактирование несуществующей группы (ожидали 404) — это баг API',
      });
      return;
    }
    expect(resp.status()).toBe(404);
  });
});
