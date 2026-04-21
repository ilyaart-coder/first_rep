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
  results?: Array<{ id?: string }>;
};

async function authHeaders(request: APIRequestContext) {
  const access = await getValidAccessToken(request);
  return {
    accept: 'application/json',
    authorization: `Bearer ${access}`,
  };
}

// Получаем любой существующий id группы из списка /labels/groups/
async function getAnyLabelsGroupId(request: APIRequestContext): Promise<string | null> {
  const url = `${env.apiUrl}/labels/groups/?page=1&size=5`;
  const resp = await request.get(url, { headers: await authHeaders(request) });
  expect(resp.status()).toBe(200);
  const body = (await resp.json()) as LabelsGroupsListResponse;
  return body.results?.[0]?.id ?? null;
}

// GET /labels/groups/{id}/
async function getLabelsGroupDetail(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/labels/groups/${id}/`;
  return request.get(url, { headers: await authHeaders(request) });
}

test.describe('Labels GET /labels/groups/{id}/', () => {
  // Проверяем структуру ответа по документации
  test('возвращает информацию о группе с корректными полями', async ({ request }) => {
    const id = await getAnyLabelsGroupId(request);
    if (!id) test.skip(true, 'Нет групп меток для проверки /labels/groups/{id}/');

    const resp = await getLabelsGroupDetail(request, id);
    expect(resp.status()).toBe(200);

    const body = (await resp.json()) as LabelsGroup;
    expect(body.id).toBe(id);
    expect(typeof body.name).toBe('string');
    expect((body.name ?? '').trim().length > 0).toBeTruthy();
    expect(typeof body.is_active).toBe('boolean');

    expect(typeof body.modified_at).toBe('string');
    expect(Number.isNaN(Date.parse(body.modified_at ?? ''))).toBe(false);
    expect(typeof body.created_at).toBe('string');
    expect(Number.isNaN(Date.parse(body.created_at ?? ''))).toBe(false);
  });

  // Негатив: несуществующий id -> 404
  test('404 если группа не найдена', async ({ request }) => {
    const resp = await getLabelsGroupDetail(request, '00000000-0000-0000-0000-000000000000');
    expect(resp.status()).toBe(404);
  });
});

