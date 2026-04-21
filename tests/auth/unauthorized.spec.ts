import { expect, test } from '@playwright/test';

import { env } from '../../utils/env';

test.describe('Unauthorized access checks', () => {
  // Проверяем, что защищенные ручки без токена отдают 401
  test('alerts list requires auth', async ({ request }) => {
    const res = await request.get(`${env.apiUrl}/alerts/?page=1&size=1`);
    expect(res.status()).toBe(401);
  });

  test('clients list requires auth', async ({ request }) => {
    const res = await request.get(`${env.apiUrl}/clients/?page=1&size=1`);
    expect(res.status()).toBe(401);
  });

  test('basics users requires auth', async ({ request }) => {
    const res = await request.get(`${env.apiUrl}/basics/users/`);
    expect(res.status()).toBe(401);
  });

  test('catalog networks requires auth', async ({ request }) => {
    const res = await request.get(`${env.apiUrl}/catalog/networks/?page=1&size=1`);
    expect(res.status()).toBe(401);
  });
});
