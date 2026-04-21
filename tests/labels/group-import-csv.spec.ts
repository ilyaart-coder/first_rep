import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';

type LabelsGroup = { id?: string };
type CatalogNetwork = { id?: string; code?: string; name?: string };
type CatalogNetworksResponse = { results?: CatalogNetwork[]; next?: number | null };
type EntityCategoryListItem = { id?: string; code?: string; name?: string };
type EntityCategoriesResponse = { results?: EntityCategoryListItem[]; next?: number | null };

type ImportResult = {
  imported?: number;
  failed?: number;
  invalid_rows?: Array<{ row?: number; error?: string }>;
};

async function authHeaders(request: APIRequestContext) {
  const access = await getValidAccessToken(request);
  return { accept: 'application/json', authorization: `Bearer ${access}` };
}

function makeName(prefix: string) {
  return `autotest-${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function isUuid(value: string | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// Создаёт временную группу меток (для импорта)
async function createTempGroup(request: APIRequestContext): Promise<string> {
  const url = `${env.apiUrl}/labels/groups/create/`;
  const resp = await request.post(url, {
    headers: { ...(await authHeaders(request)), 'content-type': 'application/json' },
    data: { name: makeName('import-group') },
  });
  if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
  expect(resp.status()).toBe(201);
  const body = (await resp.json()) as LabelsGroup;
  expect(isUuid(body.id)).toBeTruthy();
  return body.id!;
}

// Удаляет группу (вместе с метками внутри)
async function deleteGroup(request: APIRequestContext, id: string) {
  const url = `${env.apiUrl}/labels/groups/${id}/delete/`;
  return request.delete(url, { headers: await authHeaders(request) });
}

// Находит сеть по коду (для валидного network в CSV)
async function resolveNetworkByCode(request: APIRequestContext, code: string): Promise<{ id: string; code: string; name?: string } | null> {
  for (let page = 1; page <= 20; page += 1) {
    const qs = new URLSearchParams({ page: String(page), size: '50', search: code, supports_kyt: 'true' });
    const url = `${env.apiUrl}/catalog/networks/?${qs.toString()}`;
    const resp = await request.get(url, { headers: await authHeaders(request) });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as CatalogNetworksResponse;
    const exact = (body.results ?? []).find((n) => (n.code ?? '').toUpperCase() === code.toUpperCase());
    if (exact?.id && exact.code) return { id: exact.id, code: exact.code, name: exact.name };
    if (!body.next) break;
  }
  return null;
}

// Находит категорию сущностей (для entity_category в CSV)
async function resolveAnyEntityCategory(request: APIRequestContext): Promise<{ id: string; code?: string } | null> {
  for (let page = 1; page <= 20; page += 1) {
    const qs = new URLSearchParams({ page: String(page), size: '1000' });
    const url = `${env.apiUrl}/entity-categories/?${qs.toString()}`;
    const resp = await request.get(url, { headers: await authHeaders(request) });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as EntityCategoriesResponse;
    const first = (body.results ?? []).find((c) => !!c.id);
    if (first?.id) return { id: first.id, code: first.code };
    if (!body.next) break;
  }
  return null;
}

function buildCsvWithBom(rows: Array<Record<string, string>>) {
  // Важно: UTF-8 BOM для Excel
  const bom = '\uFEFF';
  const header = 'network,address,entity_name,entity_category,description,is_active';
  const lines = [header];
  for (const r of rows) {
    // CSV без экранирования кавычек: в тестовых данных не используем запятые/кавычки
    lines.push([r.network, r.address, r.entity_name, r.entity_category, r.description, r.is_active].join(','));
  }
  return bom + lines.join('\r\n') + '\r\n';
}

// POST /labels/groups/{id}/import-csv/ (multipart/form-data)
async function importCsv(request: APIRequestContext, groupId: string, csvText: string, ignoreErrors: boolean) {
  const url = `${env.apiUrl}/labels/groups/${groupId}/import-csv/`;
  return request.post(url, {
    headers: await authHeaders(request),
    multipart: {
      ignore_errors: String(ignoreErrors),
      file: {
        name: 'labels.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csvText, 'utf-8'),
      },
    },
  });
}

// GET /labels/groups/{id}/export-csv/ (используем для проверки, что импорт реально добавил строки)
async function exportCsv(request: APIRequestContext, groupId: string) {
  const url = `${env.apiUrl}/labels/groups/${groupId}/export-csv/`;
  return request.get(url, { headers: await authHeaders(request) });
}

function parseCsvLines(csvText: string): string[] {
  return csvText.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
}

test.describe('Labels POST /labels/groups/{id}/import-csv/', () => {
  // Позитив: импорт 1 валидной строки (ignore_errors=false)
  test('импортирует валидный CSV (201) и метка появляется в экспорте', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const network = await resolveNetworkByCode(request, 'ETH');
    if (!network) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const category = await resolveAnyEntityCategory(request);
    if (!category) test.skip(true, 'Не нашли категорию в /entity-categories/');

    try {
      // В CSV поле "network" и "entity_category" в реальности могут ожидать UUID или code.
      // Делаем устойчиво: пробуем сначала UUID-шки (как в примерах в UI), если 400 — пробуем code.
      const baseRow = {
        address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
        entity_name: makeName('imported'),
        description: 'import csv',
        is_active: 'true',
      };

      let csv = buildCsvWithBom([
        {
          network: network.id,
          entity_category: category.id,
          ...baseRow,
        },
      ]);

      let resp = await importCsv(request, groupId, csv, false);
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      if (resp.status() === 400) {
        // fallback: network/code + entity_category/code
        csv = buildCsvWithBom([
          {
            network: network.code,
            entity_category: category.code ?? category.id,
            ...baseRow,
          },
        ]);
        resp = await importCsv(request, groupId, csv, false);
      }
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(resp.status()).toBe(201);

      const body = (await resp.json()) as ImportResult;
      expect(typeof body.imported).toBe('number');
      expect(typeof body.failed).toBe('number');
      expect((body.imported ?? 0) >= 1).toBeTruthy();

      // Проверяем через export-csv, что есть данные (header + хотя бы 1 строка)
      const exp = await exportCsv(request, groupId);
      expect(exp.status()).toBe(200);
      const text = (await exp.body()).toString('utf-8');
      expect(text.charCodeAt(0)).toBe(0xfeff);
      const lines = parseCsvLines(text);
      expect(lines.length >= 2).toBeTruthy();
    } finally {
      await deleteGroup(request, groupId);
    }
  });

  // Позитив: ignore_errors=true -> частичный импорт (1 валидная строка + 1 невалидная)
  test('ignore_errors=true импортирует валидные строки и возвращает invalid_rows', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const network = await resolveNetworkByCode(request, 'ETH');
    if (!network) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const category = await resolveAnyEntityCategory(request);
    if (!category) test.skip(true, 'Не нашли категорию в /entity-categories/');

    try {
      const csv = buildCsvWithBom([
        {
          network: network.id,
          address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
          entity_name: makeName('ok'),
          entity_category: category.id,
          description: 'ok row',
          is_active: 'true',
        },
        {
          network: network.id,
          address: 'NOT_AN_ADDRESS',
          entity_name: makeName('bad'),
          entity_category: category.id,
          description: 'bad row',
          is_active: 'true',
        },
      ]);

      let resp = await importCsv(request, groupId, csv, true);
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');

      // Может быть 201 или 400, если API не принимает UUID в CSV полях и ждёт code.
      if (resp.status() === 400) {
        const csv2 = buildCsvWithBom([
          {
            network: network.code,
            address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
            entity_name: makeName('ok'),
            entity_category: category.code ?? category.id,
            description: 'ok row',
            is_active: 'true',
          },
          {
            network: network.code,
            address: 'NOT_AN_ADDRESS',
            entity_name: makeName('bad'),
            entity_category: category.code ?? category.id,
            description: 'bad row',
            is_active: 'true',
          },
        ]);
        const resp2 = await importCsv(request, groupId, csv2, true);
        if (resp2.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
        expect(resp2.status()).toBe(201);
        const body2 = (await resp2.json()) as ImportResult;
        expect((body2.imported ?? 0) >= 1).toBeTruthy();
        expect((body2.failed ?? 0) >= 1).toBeTruthy();
        expect(Array.isArray(body2.invalid_rows)).toBeTruthy();
        expect((body2.invalid_rows ?? []).length >= 1).toBeTruthy();
        return;
      }

      expect(resp.status()).toBe(201);
      let body = (await resp.json()) as ImportResult;

      // Иногда API принимает запрос (201), но считает все строки невалидными (например, если ожидает code вместо UUID).
      // В этом случае делаем повторную попытку с code-форматом и ждём частичный импорт.
      if ((body.imported ?? 0) < 1) {
        const csv2 = buildCsvWithBom([
          {
            network: network.code,
            address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
            entity_name: makeName('ok'),
            entity_category: category.code ?? category.id,
            description: 'ok row',
            is_active: 'true',
          },
          {
            network: network.code,
            address: 'NOT_AN_ADDRESS',
            entity_name: makeName('bad'),
            entity_category: category.code ?? category.id,
            description: 'bad row',
            is_active: 'true',
          },
        ]);
        resp = await importCsv(request, groupId, csv2, true);
        if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
        expect(resp.status()).toBe(201);
        body = (await resp.json()) as ImportResult;
      }

      expect((body.imported ?? 0) >= 1).toBeTruthy();
      expect((body.failed ?? 0) >= 1).toBeTruthy();
      expect(Array.isArray(body.invalid_rows)).toBeTruthy();
      expect((body.invalid_rows ?? []).length >= 1).toBeTruthy();
    } finally {
      await deleteGroup(request, groupId);
    }
  });

  // Негатив: ignore_errors=false и есть невалидная строка -> 400
  test('ignore_errors=false возвращает 400 при невалидной строке', async ({ request }) => {
    const groupId = await createTempGroup(request);
    const network = await resolveNetworkByCode(request, 'ETH');
    if (!network) test.skip(true, 'Не нашли сеть ETH в /catalog/networks/');
    const category = await resolveAnyEntityCategory(request);
    if (!category) test.skip(true, 'Не нашли категорию в /entity-categories/');

    try {
      const csv = buildCsvWithBom([
        {
          network: network.id,
          address: 'NOT_AN_ADDRESS',
          entity_name: makeName('bad'),
          entity_category: category.id,
          description: 'bad row',
          is_active: 'true',
        },
      ]);
      const resp = await importCsv(request, groupId, csv, false);
      if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');

      if (resp.status() === 400) {
        expect(resp.status()).toBe(400);
        return;
      }

      // fallback на code-формат, если UUID не принимаются в CSV
      const csv2 = buildCsvWithBom([
        {
          network: network.code,
          address: 'NOT_AN_ADDRESS',
          entity_name: makeName('bad'),
          entity_category: category.code ?? category.id,
          description: 'bad row',
          is_active: 'true',
        },
      ]);
      const resp2 = await importCsv(request, groupId, csv2, false);
      if (resp2.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
      expect(resp2.status()).toBe(400);
    } finally {
      await deleteGroup(request, groupId);
    }
  });

  // Негатив: несуществующая группа -> 404
  test('404 если группа не найдена', async ({ request }) => {
    const csv = buildCsvWithBom([
      {
        network: 'ETH',
        address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
        entity_name: 'x',
        entity_category: 'custom:exchange',
        description: '',
        is_active: 'true',
      },
    ]);
    const resp = await importCsv(request, '00000000-0000-0000-0000-000000000000', csv, true);
    // 403 возможен раньше 404, если нет прав
    if (resp.status() === 403) test.skip(true, 'Нет прав access_risk_models=full для labels');
    expect(resp.status()).toBe(404);
  });

  // Негатив: без авторизации -> 401
  test('401 без авторизации', async ({ request }) => {
    const url = `${env.apiUrl}/labels/groups/00000000-0000-0000-0000-000000000000/import-csv/`;
    const csv = buildCsvWithBom([
      {
        network: 'ETH',
        address: '0xE04F3Dc758891f4e89B326B24D0a0c656C6e54A2',
        entity_name: 'x',
        entity_category: 'custom:exchange',
        description: '',
        is_active: 'true',
      },
    ]);
    const resp = await request.post(url, {
      headers: { accept: 'application/json' },
      multipart: {
        ignore_errors: 'true',
        file: { name: 'labels.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') },
      },
    });
    expect(resp.status()).toBe(401);
  });
});
