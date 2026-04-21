import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type LabelsOverview = {
  built_in_categories_count?: number;
  custom_categories_count?: number;
  labels_configured_at?: string | null;
  custom_categories_configured_at?: string | null;
};

async function authHeaders(request: APIRequestContext) {
  const access = await getValidAccessToken(request);
  return { accept: 'application/json', authorization: `Bearer ${access}` };
}

// GET /labels/overview/
async function getOverview(request: APIRequestContext) {
  const url = `${env.apiUrl}/labels/overview/`;
  return request.get(url, { headers: await authHeaders(request) });
}

function isoOrNull(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && Number.isNaN(Date.parse(value)) === false;
}

test.describe('Labels GET /labels/overview/', () => {
  // Проверяем структуру ответа по документации
  test('возвращает агрегированную информацию по лейблам', async ({ request }) => {
    const resp = await getOverview(request);
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as LabelsOverview;

    expect(typeof body.built_in_categories_count).toBe('number');
    expect(typeof body.custom_categories_count).toBe('number');
    expect(Number.isInteger(body.built_in_categories_count)).toBeTruthy();
    expect(Number.isInteger(body.custom_categories_count)).toBeTruthy();
    expect((body.built_in_categories_count ?? -1) >= 0).toBeTruthy();
    expect((body.custom_categories_count ?? -1) >= 0).toBeTruthy();

    expect(isoOrNull(body.labels_configured_at)).toBeTruthy();
    expect(isoOrNull(body.custom_categories_configured_at)).toBeTruthy();
  });
});

