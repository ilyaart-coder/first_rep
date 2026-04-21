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

// Создает группу для тестов приоритета
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
  return body.id as string;
}

// POST /labels/groups/{id}/update-priority/
async function updatePriority(request: APIRequestContext, id: string, payload: { priority?: any }) {
  const url = `${env.apiUrl}/labels/groups/${id}/update-priority/`;
  return request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: payload,
  });
}

// DELETE /labels/groups/{id}/delete/
async function deleteGroup(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/labels/groups/${id}/delete/`;
  return request.delete(url, { headers: await authHeaders(request) });
}

test.describe('Labels POST /labels/groups/{id}/update-priority/', () => {
  // Позитив: обновление приоритета (201)
  test('обновляет приоритет группы (201)', async ({ request }) => {
    const id = await createGroup(request, makeName('group-priority'));
    try {
      const resp = await updatePriority(request, id, { priority: 1 });
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
      expect(resp.status()).toBe(201);
      const body = (await resp.json()) as LabelsGroup;
      expect(body.id).toBe(id);
      expect(body.name).toBeTruthy();
      expect(typeof body.is_active).toBe('boolean');
      expect(typeof body.modified_at).toBe('string');
      expect(typeof body.created_at).toBe('string');
    } finally {
      await deleteGroup(request, id);
    }
  });

  // Негатив: priority не передан -> 400
  test('400 если priority не передан', async ({ request }) => {
    const id = await createGroup(request, makeName('group-priority-missing'));
    try {
      const resp = await updatePriority(request, id, {});
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
      expect(resp.status()).toBe(400);
    } finally {
      await deleteGroup(request, id);
    }
  });

  // Негатив: priority не integer -> 400
  test('400 если priority не целое число', async ({ request }) => {
    const id = await createGroup(request, makeName('group-priority-bad'));
    try {
      const resp = await updatePriority(request, id, { priority: 'abc' });
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
      expect(resp.status()).toBe(400);
    } finally {
      await deleteGroup(request, id);
    }
  });

  // Негатив: группа не найдена -> 404
  test('404 если группа не найдена', async ({ request }) => {
    const resp = await updatePriority(request, '00000000-0000-0000-0000-000000000000', { priority: 1 });
    if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
    expect(resp.status()).toBe(404);
  });
});

