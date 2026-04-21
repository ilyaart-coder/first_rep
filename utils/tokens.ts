import * as fs from 'fs';
import * as path from 'path';

export type AuthTokens = {
  access_token: string;
  refresh_token: string;
};

const authDir = path.resolve(process.cwd(), '.auth');
const tokenFilePath = path.join(authDir, 'tokens.json');

export function saveTokens(tokens: AuthTokens): void {
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(tokenFilePath, JSON.stringify(tokens, null, 2), 'utf-8');
}

export function readTokens(): AuthTokens {
  const raw = fs.readFileSync(tokenFilePath, 'utf-8');
  return JSON.parse(raw) as AuthTokens;
}

export function tokenFileExists(): boolean {
  return fs.existsSync(tokenFilePath);
}

export function getTokenFilePath(): string {
  return tokenFilePath;
}
