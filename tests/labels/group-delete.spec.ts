import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type LabelsGroup = { id?: string };

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

// Создает группу для теста удаления
async function createGroup(request: APIRequestContext) {
  const url = `${env.apiUrl}/labels/groups/create/`;
  const resp = await request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: { name: makeName('group-delete') },
  });
  if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
  expect(resp.status()).toBe(201);
  const body = (await resp.json()) as LabelsGroup;
  expect(body.id).toBeTruthy();
  return body.id as string;
}

// DELETE /labels/groups/{id}/delete/
async function deleteGroup(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/labels/groups/${id}/delete/`;
  return request.delete(url, { headers: await authHeaders(request) });
}

// GET /labels/groups/{id}/
async function getGroupDetail(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/labels/groups/${id}/`;
  return request.get(url, { headers: await authHeaders(request) });
}

test.describe('Labels DELETE /labels/groups/{id}/delete/', () => {
  // Позитив: удаление группы (204) и проверка, что detail теперь 404
  test('удаляет группу (204) и detail возвращает 404', async ({ request }) => {
    const id = await createGroup(request);

    const del = await deleteGroup(request, id);
    if (del.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для групп меток');
    expect(del.status()).toBe(204);

    const detail = await getGroupDetail(request, id);
    expect(detail.status()).toBe(404);
  });

  // Негатив: несуществующий id -> 404
  test('404 если группа не найдена', async ({ request }) => {
    const resp = await deleteGroup(request, '00000000-0000-0000-0000-000000000000');
    expect(resp.status()).toBe(404);
  });
});

