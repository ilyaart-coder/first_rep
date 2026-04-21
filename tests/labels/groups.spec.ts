import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type LabelsGroupItem = {
  id?: string;
  name?: string;
  is_active?: boolean;
  label_count?: number;
  modified_at?: string;
};

type LabelsGroupsResponse = {
  count?: number;
  pages?: number;
  next?: number | string | null;
  previous?: number | string | null;
  results?: LabelsGroupItem[];
};

function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

function isUuid(value: string | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPageLink(value: LabelsGroupsResponse['next']): boolean {
  return value === null || typeof value === 'string' || typeof value === 'number';
}

async function getLabelsGroups(request: APIRequestContext, params: Record<string, string> = {}) {
  const access = await getValidAccessToken(request);
  const search = new URLSearchParams(params);
  const suffix = search.toString() ? `?${search.toString()}` : '';
  const url = `${env.apiUrl}/labels/groups/${suffix}`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${access}`,
    },
  });
}

test.describe('Labels GET /labels/groups/', () => {
  test('возвращает список групп с обязательными полями и кодом 200', async ({ request }) => {
    const response = await getLabelsGroups(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as LabelsGroupsResponse;
    expect(typeof body.count).toBe('number');
    expect(typeof body.pages).toBe('number');
    expect(isPageLink(body.next)).toBeTruthy();
    expect(isPageLink(body.previous)).toBeTruthy();
    expect(Array.isArray(body.results)).toBeTruthy();

    for (const item of body.results ?? []) {
      expect(isUuid(item.id)).toBeTruthy();
      expect(typeof item.name).toBe('string');
      expect((item.name ?? '').trim().length > 0).toBeTruthy();
      expect(typeof item.is_active).toBe('boolean');
      expect(typeof item.label_count).toBe('number');
      expect(Number.isInteger(item.label_count)).toBeTruthy();
      expect((item.label_count ?? -1) >= 0).toBeTruthy();
      expect(typeof item.modified_at).toBe('string');
      expect(Number.isNaN(Date.parse(item.modified_at ?? ''))).toBe(false);
    }
  });

  test('без параметров использует дефолтную пагинацию и возвращает не более 25 элементов', async ({ request }) => {
    const response = await getLabelsGroups(request);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as LabelsGroupsResponse;
    expect(Array.isArray(body.results)).toBeTruthy();
    expect((body.results ?? []).length <= 25).toBeTruthy();
    expect((body.count ?? 0) >= (body.results ?? []).length).toBeTruthy();
  });

  test('пагинация size=1 возвращает максимум 1 элемент', async ({ request }) => {
    const response = await getLabelsGroups(request, { page: '1', size: '1' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as LabelsGroupsResponse;
    expect(Array.isArray(body.results)).toBeTruthy();
    expect((body.results ?? []).length <= 1).toBeTruthy();
    expect(typeof body.count).toBe('number');
    expect(typeof body.pages).toBe('number');
  });

  test('пагинация page=2,size=5 корректно работает при достаточном количестве данных', async ({ request }) => {
    const firstPageResponse = await getLabelsGroups(request, { page: '1', size: '5' });
    expect(firstPageResponse.status()).toBe(200);
    const firstPageBody = (await firstPageResponse.json()) as LabelsGroupsResponse;

    if ((firstPageBody.count ?? 0) <= 5 || (firstPageBody.pages ?? 0) < 2) {
      test.skip(true, 'Недостаточно групп для проверки второй страницы');
    }

    const secondPageResponse = await getLabelsGroups(request, { page: '2', size: '5' });
    expect(secondPageResponse.status()).toBe(200);

    const secondPageBody = (await secondPageResponse.json()) as LabelsGroupsResponse;
    expect(Array.isArray(secondPageBody.results)).toBeTruthy();
    expect((secondPageBody.results ?? []).length <= 5).toBeTruthy();
    expect(typeof secondPageBody.count).toBe('number');
    expect(typeof secondPageBody.pages).toBe('number');
    expect(isPageLink(secondPageBody.previous)).toBeTruthy();
    expect(secondPageBody.previous).not.toBeNull();

    const firstIds = new Set((firstPageBody.results ?? []).map((item) => item.id).filter(Boolean));
    const secondIds = (secondPageBody.results ?? []).map((item) => item.id).filter(Boolean);
    for (const id of secondIds) {
      expect(firstIds.has(id)).toBeFalsy();
    }
  });

  test('count и pages согласованы с размером страницы', async ({ request }) => {
    const response = await getLabelsGroups(request, { page: '1', size: '5' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as LabelsGroupsResponse;
    const count = body.count ?? 0;
    const pages = body.pages ?? 0;
    const expectedPages = count === 0 ? 0 : Math.ceil(count / 5);

    expect(pages).toBe(expectedPages);
  });

  test('невалидный page возвращает 404 или API игнорирует параметр', async ({ request }) => {
    const response = await getLabelsGroups(request, { page: '___bad_page___', size: '5' });

    if (response.status() === 404) {
      const body = (await response.json()) as { detail?: string };
      expect(body.detail).toBeTruthy();
      return;
    }

    expect(response.status()).toBe(200);
    const body = (await response.json()) as LabelsGroupsResponse;
    expect(Array.isArray(body.results)).toBeTruthy();

    test.info().annotations.push({
      type: 'note',
      description: 'API игнорирует невалидный page и возвращает обычный список (200)',
    });
  });

  test('невалидный size возвращает 400 или корректный список по умолчанию', async ({ request }) => {
    const response = await getLabelsGroups(request, { page: '1', size: '___bad_size___' });

    if (response.status() === 400) {
      expect(response.status()).toBe(400);
      return;
    }

    expect(response.status()).toBe(200);
    const body = (await response.json()) as LabelsGroupsResponse;
    expect(Array.isArray(body.results)).toBeTruthy();

    test.info().annotations.push({
      type: 'note',
      description: 'API игнорирует невалидный size и возвращает обычный список (200)',
    });
  });

  test('крайние значения page/size дают предсказуемый ответ и не приводят к 500', async ({ request }) => {
    const cases = [
      { page: '0', size: '5', title: 'page=0', allowed: [404] },
      { page: '1', size: '0', title: 'size=0', allowed: [200] },
      { page: '-1', size: '5', title: 'page=-1', allowed: [404] },
      { page: '1', size: '-5', title: 'size=-5', allowed: [200] },
    ];

    for (const testCase of cases) {
      const response = await getLabelsGroups(request, { page: testCase.page, size: testCase.size });
      expect(testCase.allowed).toContain(response.status());

      if (response.status() === 200) {
        const body = (await response.json()) as LabelsGroupsResponse;
        expect(Array.isArray(body.results)).toBeTruthy();
      } else if (response.status() === 404) {
        const body = (await response.json()) as { detail?: string };
        expect(body.detail, testCase.title).toBeTruthy();
      }
    }
  });

  test('без авторизации возвращает 401', async ({ request }) => {
    const response = await request.get(`${env.apiUrl}/labels/groups/?page=1&size=5`, {
      headers: {
        accept: 'application/json',
      },
    });

    expect(response.status()).toBe(401);
  });
});
