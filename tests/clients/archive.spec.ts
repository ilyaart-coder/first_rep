import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type ClientsListResponse = {
  results?: Array<{ id?: string; is_archived?: boolean }>;
};

type ClientDetail = {
  id?: string;
  is_archived?: boolean;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// GET /clients/ с авторизацией (archived=false)
async function getActiveClients(request: APIRequestContext) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/clients/?archived=false&page=1&size=10`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

// GET /clients/{id}/ с авторизацией
async function getClientDetail(request: APIRequestContext, id: string) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/clients/${id}/`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

// POST /clients/{id}/archive/
async function archiveClient(request: APIRequestContext, id: string) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/clients/${id}/archive/`;

  return request.post(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

test.describe('Clients /clients/{id}/archive/', () => {
  // Архивирует клиента и проверяет is_archived = true
  test('архивирует клиента', async ({ request }) => {
    const listResponse = await getActiveClients(request);
    expect(listResponse.status()).toBe(200);
    const list = (await listResponse.json()) as ClientsListResponse;
    const client = list.results?.find(c => c.id);
    if (!client?.id) test.skip(true, 'Нет клиентов для архивации');

    const archiveResponse = await archiveClient(request, client.id);
    expect([200, 201, 204]).toContain(archiveResponse.status());

    const detailResponse = await getClientDetail(request, client.id);
    expect(detailResponse.status()).toBe(200);
    const detail = (await detailResponse.json()) as ClientDetail;
    expect(detail.is_archived).toBeTruthy();
  });
});
