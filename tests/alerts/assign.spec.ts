import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type EmployeeItem = {
  id?: string;
  email?: string;
  full_name?: string | null;
  is_archived?: boolean;
};

type ActivityItem = {
  type?: string;
  new_assignee_id?: string | null;
  new_assignee_name?: string | null;
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

// Получает список id алертов из active_alerts
async function getActiveAlertIds(request: APIRequestContext) {
  const ids: string[] = [];
  const pagesToScan = ['1', '2', '3'];

  for (const page of pagesToScan) {
    const response = await getAlerts(request, { group: 'active_alerts', page, size: '10' });
    if (response.status() !== 200) continue;
    const body = (await response.json()) as { results?: Array<{ id?: string }> };
    for (const item of body.results ?? []) {
      if (item.id) ids.push(item.id);
    }
  }

  return ids;
}

// GET /user/info/ чтобы узнать текущего пользователя
async function getUserInfo(request: APIRequestContext) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/user/info/`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

// GET /account/employees/ чтобы получить список сотрудников
async function getEmployees(request: APIRequestContext) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/account/employees/?is_archived=false`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

// POST /alerts/{id}/assign/ — назначает исполнителя
async function assignAlert(request: APIRequestContext, id: string, userId: string | null) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/alerts/${id}/assign/`;

  return request.post(url, {
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
    data: { user: userId },
  });
}

// GET /alerts/{id}/activities/ для проверки, что появилось назначение
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

test.describe('Alerts /alerts/{id}/assign/', () => {
  // Назначает алерт на доступного пользователя и проверяет активность assignment/reassignment
  test('назначает исполнителя и фиксирует activity', async ({ request }) => {
    const userInfoResponse = await getUserInfo(request);
    expect(userInfoResponse.status()).toBe(200);
    const userInfo = (await userInfoResponse.json()) as { id?: string; username?: string };

    const employeesResponse = await getEmployees(request);
    expect(employeesResponse.status()).toBe(200);
    const employees = (await employeesResponse.json()) as EmployeeItem[];

    const target = employees.find(e => e.id && e.id !== userInfo.id && e.is_archived === false);
    if (!target?.id) {
      test.skip(true, 'Нет доступного пользователя для назначения');
    }

    const alertIds = [
      ...(env.assignAlertId ? [env.assignAlertId] : []),
      ...(await getActiveAlertIds(request)),
    ];

    let successAlertId: string | null = null;

    for (const id of alertIds) {
      const assignResponse = await assignAlert(request, id, target?.id ?? null);
      if ([200, 201].includes(assignResponse.status())) {
        successAlertId = id;
        break;
      }
    }

    if (!successAlertId) {
      test.skip(true, 'Не удалось найти алерт, на котором разрешено назначение');
    }

    const activitiesResponse = await getAlertActivities(request, successAlertId as string);
    expect(activitiesResponse.status()).toBe(200);
    const activities = (await activitiesResponse.json()) as ActivityItem[];

    const assignments = activities.filter(a => a.type === 'assignment' || a.type === 'reassignment');
    expect(assignments.length > 0).toBeTruthy();

    const hasTarget = assignments.some(a => a.new_assignee_id === target?.id);
    expect(hasTarget).toBeTruthy();
  });
});
