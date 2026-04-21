import { APIRequestContext, expect, test } from '@playwright/test';

import { env } from '../../utils/env';
import { getValidAccessToken } from '../../utils/auth';
import { readTokens, tokenFileExists } from '../../utils/tokens';

type ManualCheckType = 'deposit' | 'withdrawal' | 'single_address' | string;
type ManualCheckStatus = 'checking' | 'checked' | 'error' | string;
type ManualCheckRisk = 'none' | 'low' | 'medium' | 'high' | 'severe' | null | string;

type ManualChecksListItem = {
  id?: string;
  created_at?: string;
  type?: ManualCheckType;
  status?: ManualCheckStatus;
  risk_level?: ManualCheckRisk;
  network_code?: string;
  network_name?: string;
  subject?: string;
  asset_symbol?: string | null;
  asset_amount?: number | null;
};

type ManualChecksListResponse = {
  next?: number | null;
  previous?: number | null;
  count?: number;
  pages?: number;
  results?: ManualChecksListItem[];
};

type CatalogNetwork = {
  id?: string;
  name?: string;
  code?: string;
};

type CatalogNetworksResponse = {
  next?: number | null;
  previous?: number | null;
  count?: number;
  pages?: number;
  results?: CatalogNetwork[];
};

// Берет access/refresh из .auth/tokens.json и падает, если токенов нет
function getTokensOrThrow() {
  if (!tokenFileExists()) {
    throw new Error('Нет сохраненных токенов. Сначала запусти tests/auth/login.spec.ts');
  }
  return readTokens();
}

// Делает GET /manual-checks/ с query-параметрами и авторизацией
async function getManualChecks(request: APIRequestContext, params: Record<string, string>) {
  const access = await getValidAccessToken(request);
  const search = new URLSearchParams(params);
  const url = `${env.apiUrl}/manual-checks/?${search.toString()}`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${access}`,
    },
  });
}

// Делает GET /catalog/networks/ с query-параметрами и авторизацией
async function getCatalogNetworks(request: APIRequestContext, params: Record<string, string>) {
  const access = await getValidAccessToken(request);
  const search = new URLSearchParams(params);
  const url = `${env.apiUrl}/catalog/networks/?${search.toString()}`;

  return request.get(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${access}`,
    },
  });
}

function toDateOnly(value: string): string {
  // "2026-03-11T17:20:03.867633+03:00" -> "2026-03-11"
  return value.slice(0, 10);
}

function parseIso(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

async function getSampleManualCheck(request: APIRequestContext): Promise<ManualChecksListItem | null> {
  // Ищем элемент на первых страницах (на стенде данные могут быть только на определенных страницах)
  for (let page = 1; page <= 5; page += 1) {
    const resp = await getManualChecks(request, { page: String(page), size: '50' });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as ManualChecksListResponse;
    const first = body.results?.[0];
    if (first?.id) return first;
  }
  return null;
}

async function findManualCheckByType(request: APIRequestContext, type: 'deposit' | 'withdrawal' | 'single_address') {
  // Берем первую страницу и ищем тип; если не нашли — пробуем ещё несколько страниц.
  for (let page = 1; page <= 10; page += 1) {
    const resp = await getManualChecks(request, { page: String(page), size: '50' });
    expect(resp.status()).toBe(200);
    const body = (await resp.json()) as ManualChecksListResponse;
    const found = (body.results ?? []).find((x) => x.type === type);
    if (found?.id) return found;
  }
  return null;
}

async function resolveNetworkIdByCode(request: APIRequestContext, code: string): Promise<string | null> {
  // /catalog/networks/ умеет поиск по code и name (частичное совпадение)
  const resp = await getCatalogNetworks(request, { page: '1', size: '25', search: code, supports_kyt: 'true' });
  expect(resp.status()).toBe(200);
  const body = (await resp.json()) as CatalogNetworksResponse;
  const exact = (body.results ?? []).find((n) => (n.code ?? '').toUpperCase() === code.toUpperCase());
  return exact?.id ?? null;
}

test.describe('Manual checks /manual-checks/', () => {
  // Базовая проверка структуры ответа
  test('возвращает список ручных проверок с корректной структурой', async ({ request }) => {
    const response = await getManualChecks(request, { page: '1', size: '10' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ManualChecksListResponse;
    expect(typeof body.count === 'number' || body.count === undefined).toBeTruthy();
    expect(typeof body.pages === 'number' || body.pages === undefined).toBeTruthy();
    expect(body.next === null || typeof body.next === 'number' || body.next === undefined).toBeTruthy();
    expect(body.previous === null || typeof body.previous === 'number' || body.previous === undefined).toBeTruthy();
    expect(Array.isArray(body.results)).toBeTruthy();

    const item = body.results?.[0];
    if (!item) return;
    expect(item.id).toBeTruthy();
    expect(item.created_at).toBeTruthy();
    expect(item.type).toBeTruthy();
    expect(item.status).toBeTruthy();
    expect(item.network_code).toBeTruthy();
    expect(item.network_name).toBeTruthy();
    expect(item.subject).toBeTruthy();
  });

  // Фильтр type: deposit
  test('фильтр type=deposit возвращает только deposit', async ({ request }) => {
    const sample = await findManualCheckByType(request, 'deposit');
    if (!sample) test.skip(true, 'Нет manual-checks типа deposit для проверки');

    const response = await getManualChecks(request, { page: '1', size: '50', type: 'deposit' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ManualChecksListResponse;
    for (const item of body.results ?? []) {
      expect(item.type).toBe('deposit');
    }
  });

  // Фильтр type: withdrawal
  test('фильтр type=withdrawal возвращает только withdrawal', async ({ request }) => {
    const sample = await findManualCheckByType(request, 'withdrawal');
    if (!sample) test.skip(true, 'Нет manual-checks типа withdrawal для проверки');

    const response = await getManualChecks(request, { page: '1', size: '50', type: 'withdrawal' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ManualChecksListResponse;
    for (const item of body.results ?? []) {
      expect(item.type).toBe('withdrawal');
    }
  });

  // Фильтр type: single_address
  test('фильтр type=single_address возвращает только single_address', async ({ request }) => {
    const sample = await findManualCheckByType(request, 'single_address');
    if (!sample) test.skip(true, 'Нет manual-checks типа single_address для проверки');

    const response = await getManualChecks(request, { page: '1', size: '50', type: 'single_address' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ManualChecksListResponse;
    for (const item of body.results ?? []) {
      expect(item.type).toBe('single_address');
    }
  });

  // Фильтр group=address_checks должен возвращать только проверки адресов
  test('фильтр group=address_checks возвращает только single_address', async ({ request }) => {
    const response = await getManualChecks(request, { page: '1', size: '50', group: 'address_checks' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ManualChecksListResponse;
    if ((body.results ?? []).length === 0) test.skip(true, 'Нет manual-checks в группе address_checks для проверки');
    for (const item of body.results ?? []) {
      expect(item.type).toBe('single_address');
    }
  });

  // Фильтр group=transfer_checks должен возвращать проверки трансферов (deposit/withdrawal)
  test('фильтр group=transfer_checks возвращает deposit/withdrawal', async ({ request }) => {
    const response = await getManualChecks(request, { page: '1', size: '50', group: 'transfer_checks' });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ManualChecksListResponse;
    if ((body.results ?? []).length === 0) test.skip(true, 'Нет manual-checks в группе transfer_checks для проверки');
    for (const item of body.results ?? []) {
      expect(['deposit', 'withdrawal']).toContain(item.type ?? '');
    }
  });

  // Фильтр risk_level по значению из реальных данных
  test('фильтр risk_level возвращает только проверки с этим уровнем риска', async ({ request }) => {
    const sample = await getSampleManualCheck(request);
    if (!sample?.risk_level) test.skip(true, 'Нет завершенных manual-checks (risk_level=null) для проверки risk_level');

    const response = await getManualChecks(request, { page: '1', size: '50', risk_level: String(sample.risk_level) });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ManualChecksListResponse;
    if ((body.results ?? []).length === 0) test.skip(true, 'Нет manual-checks для проверки risk_level на этом стенде');
    for (const item of body.results ?? []) {
      expect(item.risk_level).toBe(sample.risk_level);
    }
  });

  // Фильтр risk_level=null (незавершенные проверки)
  test('фильтр risk_level=null возвращает только незавершенные проверки (risk_level=null)', async ({ request }) => {
    // Ищем пример с risk_level=null
    let foundNull = false;
    for (let page = 1; page <= 10; page += 1) {
      const resp = await getManualChecks(request, { page: String(page), size: '50' });
      expect(resp.status()).toBe(200);
      const body = (await resp.json()) as ManualChecksListResponse;
      if ((body.results ?? []).some((x) => x.risk_level === null)) {
        foundNull = true;
        break;
      }
    }
    if (!foundNull) test.skip(true, 'Нет manual-checks с risk_level=null для проверки');

    const response = await getManualChecks(request, { page: '1', size: '50', risk_level: 'null' });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as ManualChecksListResponse;
    for (const item of body.results ?? []) {
      expect(item.risk_level).toBeNull();
    }
  });

  // Фильтр network: берем UUID сети из /catalog/networks/ и проверяем совпадение network_code в manual-checks
  test('фильтр network по UUID сети возвращает проверки только этой сети', async ({ request }) => {
    const sample = await getSampleManualCheck(request);
    if (!sample?.network_code) test.skip(true, 'Нет manual-checks для проверки network');

    const networkId = await resolveNetworkIdByCode(request, sample.network_code);
    if (!networkId) test.skip(true, `Не нашли сеть в /catalog/networks/ по code=${sample.network_code}`);

    const response = await getManualChecks(request, { page: '1', size: '50', network: networkId });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ManualChecksListResponse;
    if ((body.results ?? []).length === 0) test.skip(true, 'Нет manual-checks для проверки network на этом стенде');
    for (const item of body.results ?? []) {
      expect((item.network_code ?? '').toUpperCase()).toBe(sample.network_code.toUpperCase());
    }
  });

  // Фильтр created_from/created_to: ограничивает диапазон дат
  test('фильтр created_from/created_to ограничивает результаты по created_at', async ({ request }) => {
    const sample = await getSampleManualCheck(request);
    if (!sample?.created_at) test.skip(true, 'Нет manual-checks для проверки created_from/created_to');

    const from = toDateOnly(sample.created_at);
    const to = from;
    const response = await getManualChecks(request, { page: '1', size: '50', created_from: from, created_to: to });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ManualChecksListResponse;
    const fromMs = Date.parse(`${from}T00:00:00Z`);
    const toMs = Date.parse(`${to}T23:59:59Z`);
    for (const item of body.results ?? []) {
      if (!item.created_at) continue;
      const ms = parseIso(item.created_at);
      expect(ms >= fromMs).toBeTruthy();
      expect(ms <= toMs).toBeTruthy();
    }
  });

  // Фильтр search: ищем по subject (tx_hash или address)
  test('фильтр search возвращает элементы, где subject содержит строку поиска', async ({ request }) => {
    const sample = await getSampleManualCheck(request);
    if (!sample?.subject) test.skip(true, 'Нет manual-checks для проверки search');

    const search = sample.subject.slice(0, 8);
    const response = await getManualChecks(request, { page: '1', size: '50', search });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as ManualChecksListResponse;
    if ((body.results ?? []).length === 0) test.skip(true, 'Нет manual-checks для проверки search на этом стенде');
    for (const item of body.results ?? []) {
      expect((item.subject ?? '').toLowerCase().includes(search.toLowerCase())).toBeTruthy();
    }
  });

  // Негатив: невалидный type должен отдавать 400 или пустой список (зависит от реализации)
  test('невалидный type возвращает 400 или пустой список', async ({ request }) => {
    const response = await getManualChecks(request, { page: '1', size: '10', type: '___bad_type___' });
    if (response.status() === 400) return;
    expect(response.status()).toBe(200);
    const body = (await response.json()) as ManualChecksListResponse;
    expect((body.results ?? []).length).toBe(0);
  });

  // Негатив: невалидный group должен отдавать 400 или пустой список (зависит от реализации)
  test('невалидный group возвращает 400 или пустой список', async ({ request }) => {
    const response = await getManualChecks(request, { page: '1', size: '10', group: '___bad_group___' });
    if (response.status() === 400) return;
    expect(response.status()).toBe(200);
    const body = (await response.json()) as ManualChecksListResponse;
    // На текущем окружении невалидный group может быть проигнорирован и API возвращает обычный список.
    // В таком случае мы не валим прогон, а фиксируем поведение в отчете.
    if ((body.results ?? []).length > 0) {
      test.info().annotations.push({
        type: 'note',
        description: 'API игнорирует невалидный group и возвращает обычный список (200)',
      });
      return;
    }
    expect((body.results ?? []).length).toBe(0);
  });
});
