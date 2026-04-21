import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type ActivityItem = {
  type?: string;
  new_comment?: string | null;
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }

  return readTokens();
}

// Универсальный GET для /alerts/ с авторизацией
async function getAlerts(request: APIRequestContext, params: Record<string, string>) {
  const tokens = getTokensOrThrow();
  const search = new URLSearchParams(params);
  const url = `${env.apiUrl}/alerts/?${search.toString()}`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

// Получает первый алерт из списка (id)
async function getFirstAlertId(request: APIRequestContext) {
  const response = await getAlerts(request, { group: 'my_alerts', page: '1', size: '10' });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { results?: Array<{ id?: string }> };
  const id = body.results?.[0]?.id;

  if (!id) {
    throw new Error('Нет алертов для проверки /alerts/{id}/add-comment/');
  }

  return id;
}

// Добавляет комментарий к алерту (POST /alerts/{id}/add-comment/)
async function addComment(request: APIRequestContext, id: string, comment: string) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/alerts/${id}/add-comment/`;

  return request.post(url, {
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
    data: { comment },
  });
}

// Получает активности алерта
async function getAlertActivities(request: APIRequestContext, id: string) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/alerts/${id}/activities/`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

test.describe('Alerts /alerts/{id}/add-comment/', () => {
  // Добавляет комментарий и проверяет, что он появился в активностях
  test('добавляет комментарий и видит его в activities', async ({ request }) => {
    const id = await getFirstAlertId(request);
    const commentText = `autotest comment ${Date.now()}`;

    const response = await addComment(request, id, commentText);
    expect([200, 201]).toContain(response.status());

    const activitiesResponse = await getAlertActivities(request, id);
    expect(activitiesResponse.status()).toBe(200);

    const activities = (await activitiesResponse.json()) as ActivityItem[];
    const comments = activities.filter(a => a.type === 'comment' && a.new_comment === commentText);
    expect(comments.length > 0).toBeTruthy();
  });
});
