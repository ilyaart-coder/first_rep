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

// GET /clients/ с авторизацией (archived=true)
async function getArchivedClients(request: APIRequestContext) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/clients/?archived=true&page=1&size=10`;

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

// POST /clients/{id}/unarchive/
async function unarchiveClient(request: APIRequestContext, id: string) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/clients/${id}/unarchive/`;

  return request.post(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

test.describe('Clients /clients/{id}/unarchive/', () => {
  // Разархивирует клиента и проверяет is_archived = false
  test('разархивирует клиента', async ({ request }) => {
    const listResponse = await getArchivedClients(request);
    expect(listResponse.status()).toBe(200);
    const list = (await listResponse.json()) as ClientsListResponse;
    const client = list.results?.find(c => c.id);
    if (!client?.id) test.skip(true, 'Нет клиентов в архиве для разархивации');

    const unarchiveResponse = await unarchiveClient(request, client.id);
    expect([200, 201, 204]).toContain(unarchiveResponse.status());

    const detailResponse = await getClientDetail(request, client.id);
    expect(detailResponse.status()).toBe(200);
    const detail = (await detailResponse.json()) as ClientDetail;
    expect(detail.is_archived).toBeFalsy();
  });
});
