import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type ActivityItem = {
  id?: string;
  created_at?: string;
  type?: string;
  initiator_id?: string | null;
  initiator_name?: string | null;
  new_assignee_id?: string | null;
  new_assignee_name?: string | null;
  new_comment?: string | null;
  new_status?: string | null;
  creation_rule?: Record<string, unknown> | null;
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

// Получает список id алертов (несколько страниц)
async function getAlertIds(request: APIRequestContext, group: string) {
  const ids: string[] = [];
  const pagesToScan = ['1', '2', '3'];

  for (const page of pagesToScan) {
    const response = await getAlerts(request, { group, page, size: '10' });
    if (response.status() !== 200) continue;
    const body = (await response.json()) as { results?: Array<{ id?: string }> };
    for (const item of body.results ?? []) {
      if (item.id) ids.push(item.id);
    }
  }

  return ids;
}

// Получает первый алерт из списка (id)
async function getFirstAlertId(request: APIRequestContext) {
  const response = await getAlerts(request, { group: 'my_alerts', page: '1', size: '10' });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { results?: Array<{ id?: string }> };
  const id = body.results?.[0]?.id;

  if (!id) {
    throw new Error('Нет алертов для проверки /alerts/{id}/activities/');
  }

  return id;
}

// GET /alerts/{id}/activities/ с авторизацией
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

// Получает детали алерта (GET /alerts/{id}/)
async function getAlertDetail(request: APIRequestContext, id: string) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/alerts/${id}/`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
  });
}

// Меняет статус алерта (POST /alerts/{id}/change-status/)
async function changeStatus(request: APIRequestContext, id: string, status: string) {
  const tokens = getTokensOrThrow();
  const url = `${env.apiUrl}/alerts/${id}/change-status/`;

  return request.post(url, {
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${tokens.access_token}`,
    },
    data: { status },
  });
}

// Выбирает статус, отличный от текущего
function pickNextStatus(current?: string) {
  const all = ['open', 'in_progress', 'awaiting_response', 'done'];
  return all.find(s => s !== current) ?? 'in_progress';
}

// Получает текущего пользователя (GET /user/info/)
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

// Получает список сотрудников (GET /account/employees/)
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

// Назначает исполнителя алерта (POST /alerts/{id}/assign/)
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

// Ищет алерт, где assignee_name и client_ext_id пустые (как в UI), в active_alerts
async function getAssignableAlertId(request: APIRequestContext) {
  if (env.assignAlertId) {
    return env.assignAlertId;
  }

  const pagesToScan = ['1', '2', '3'];
  for (const page of pagesToScan) {
    const response = await getAlerts(request, { group: 'active_alerts', page, size: '10' });
    if (response.status() !== 200) continue;
    const body = (await response.json()) as {
      results?: Array<{ id?: string; assignee_name?: string | null; client_ext_id?: string | null }>;
    };
    const found = (body.results ?? []).find(
      a => a.id && a.assignee_name == null && a.client_ext_id == null
    );
    if (found?.id) return found.id;
  }

  return null;
}

// Обеспечивает наличие assignment/reassignment активности
// Логика: сначала ищем алерт, где уже есть assignment/reassignment,
// если не нашли — назначаем исполнителя на подходящий алерт и повторяем
async function ensureAssignmentActivity(request: APIRequestContext) {
  const alertIds = await getAlertIds(request, 'my_alerts');
  if (alertIds.length === 0) {
    test.skip(true, 'Нет алертов для проверки assignment/reassignment');
  }

  // 1) Ищем алерт с уже существующей активностью назначения
  for (const id of alertIds) {
    const response = await getAlertActivities(request, id);
    if (response.status() !== 200) continue;
    const body = (await response.json()) as ActivityItem[];
    const items = body.filter(i => i.type === 'assignment' || i.type === 'reassignment');
    if (items.length > 0) {
      return { id, items };
    }
  }

  // 2) Пытаемся создать назначение на подходящем алерте из active_alerts
  const assignableId = await getAssignableAlertId(request);
  if (!assignableId) {
    test.skip(true, 'Нет подходящего алерта для назначения (assignee_name/client_ext_id пустые)');
  }

  const userInfoResponse = await getUserInfo(request);
  expect(userInfoResponse.status()).toBe(200);
  const userInfo = (await userInfoResponse.json()) as { id?: string };

  const employeesResponse = await getEmployees(request);
  expect(employeesResponse.status()).toBe(200);
  const employees = (await employeesResponse.json()) as Array<{ id?: string; is_archived?: boolean }>;
  const target = employees.find(e => e.id && e.id !== userInfo.id && e.is_archived === false);
  if (!target?.id) {
    test.skip(true, 'Нет доступного пользователя для назначения');
  }

  for (const id of [assignableId as string]) {
    const assignResponse = await assignAlert(request, id, target?.id ?? null);
    if (![200, 201].includes(assignResponse.status())) {
      continue;
    }

    const response = await getAlertActivities(request, id);
    if (response.status() !== 200) continue;
    const body = (await response.json()) as ActivityItem[];
    const items = body.filter(i => i.type === 'assignment' || i.type === 'reassignment');
    if (items.length > 0) {
      return { id, items };
    }
  }

  test.skip(true, 'Не удалось создать assignment/reassignment активность');
  return { id: '', items: [] };
}

// Обеспечивает наличие new_status активности
async function ensureStatusChangeActivity(request: APIRequestContext) {
  const alertIds = await getAlertIds(request);
  if (alertIds.length === 0) {
    test.skip(true, 'Нет алертов для проверки new_status');
  }

  // 1) Ищем алерт с уже существующей активностью new_status
  for (const id of alertIds) {
    const response = await getAlertActivities(request, id);
    if (response.status() !== 200) continue;
    const body = (await response.json()) as ActivityItem[];
    const items = body.filter(i => i.type === 'new_status' && i.new_status);
    if (items.length > 0) {
      return items;
    }
  }

  // 2) Пытаемся сменить статус, чтобы появилась new_status активность
  for (const id of alertIds) {
    const detailResponse = await getAlertDetail(request, id);
    if (detailResponse.status() !== 200) continue;
    const detail = (await detailResponse.json()) as { status?: string };

    const nextStatus = pickNextStatus(detail.status);
    const changeResponse = await changeStatus(request, id, nextStatus);
    if (![200, 201].includes(changeResponse.status())) {
      continue;
    }

    const response = await getAlertActivities(request, id);
    if (response.status() !== 200) continue;
    const body = (await response.json()) as ActivityItem[];
    const items = body.filter(i => i.type === 'new_status' && i.new_status === nextStatus);
    if (items.length > 0) {
      return items;
    }
  }

  test.skip(true, 'Не удалось создать new_status активность');
  return [];
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

// Пытается найти comment-активность, при необходимости создает комментарий и повторяет запрос
async function ensureCommentActivity(request: APIRequestContext, id: string) {
  let response = await getAlertActivities(request, id);
  expect(response.status()).toBe(200);
  let body = (await response.json()) as ActivityItem[];
  let comments = body.filter(i => i.type === 'comment' && i.new_comment);

  if (comments.length > 0) {
    return comments;
  }

  const commentText = `autotest comment ${Date.now()}`;
  const addResponse = await addComment(request, id, commentText);
  expect([200, 201]).toContain(addResponse.status());

  // Повторно читаем активности, чтобы увидеть новый комментарий
  response = await getAlertActivities(request, id);
  expect(response.status()).toBe(200);
  body = (await response.json()) as ActivityItem[];
  comments = body.filter(i => i.type === 'comment' && i.new_comment === commentText);

  return comments;
}

test.describe('Alerts /alerts/{id}/activities/', () => {
  // Базовая проверка структуры списка активностей
  test('возвращает список активностей с базовыми полями', async ({ request }) => {
    const id = await getFirstAlertId(request);
    const response = await getAlertActivities(request, id);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ActivityItem[];
    expect(Array.isArray(body)).toBeTruthy();

    const item = body[0];
    if (!item) return;

    expect(item.id).toBeTruthy();
    expect(item.created_at).toBeTruthy();
    expect(item.type).toBeTruthy();
  });

  // Проверка, что type входит в допустимый список
  test('type активности имеет ожидаемое значение', async ({ request }) => {
    const id = await getFirstAlertId(request);
    const response = await getAlertActivities(request, id);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ActivityItem[];
    const allowed = new Set(['creation', 'assignment', 'reassignment', 'deassignment', 'comment', 'new_status']);

    for (const item of body) {
      expect(allowed.has(item.type ?? '')).toBeTruthy();
    }
  });

  // Для creation допускаем null инициатора
  test('creation может быть без инициатора', async ({ request }) => {
    const id = await getFirstAlertId(request);
    const response = await getAlertActivities(request, id);
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ActivityItem[];
    const creation = body.find(i => i.type === 'creation');
    if (!creation) test.skip(true, 'Нет активности creation для проверки');

    expect(creation.initiator_id).toBeNull();
  });

  // assignment/reassignment должны содержать нового исполнителя
  test('assignment/reassignment содержат нового исполнителя', async ({ request }) => {
    const result = await ensureAssignmentActivity(request);
    const items = result.items;
    expect(items.length > 0).toBeTruthy();

    for (const item of items) {
      expect(item.new_assignee_id).toBeTruthy();
    }
  });

  // comment должен содержать текст комментария
  test('comment содержит new_comment', async ({ request }) => {
    const id = await getFirstAlertId(request);
    const items = await ensureCommentActivity(request, id);
    expect(items.length > 0).toBeTruthy();
  });

  // new_status должен содержать новый статус
  test('new_status содержит new_status', async ({ request }) => {
    const items = await ensureStatusChangeActivity(request);
    expect(items.length > 0).toBeTruthy();

    for (const item of items) {
      expect(item.new_status).toBeTruthy();
    }
  });
});
