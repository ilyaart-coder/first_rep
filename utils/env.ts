import * as dotenv from 'dotenv';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function normalizeApiUrl(raw: string): string {
  // Делаем поведение устойчивым к разным env-файлам:
  // - если передали "https://api-kyt.../v1" или ".../v1/" -> используем как есть (без trailing slash)
  // - если передали базовый "https://api-kyt..." -> добавляем "/v1"
  let url = raw.trim();
  url = url.replace(/\/+$/, ''); // убираем trailing slash
  if (url.endsWith('/v1')) return url;
  return `${url}/v1`;
}

export const env = {
  appUrl: requireEnv('APP_URL'),
  apiUrl: normalizeApiUrl(requireEnv('API_URL')),
  email: requireEnv('USER_EMAIL'),
  password: requireEnv('USER_PASSWORD'),
  assignAlertId: process.env.ASSIGN_ALERT_ID,
};
