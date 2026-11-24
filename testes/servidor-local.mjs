/**
 * PET-Digital v1.2.0 — servidor local de testes.
 *
 * O quê: roda no computador, sem Cloudflare, o MESMO código do Worker (API) e do frontend.
 * Como: o Worker é executado pelo Node com o banco simulado (SQLite local); o frontend é servido
 * com o endereço da API trocado para o servidor local. Os arquivos originais não são alterados.
 * Quando: para testar uma versão nova antes de publicar, manualmente no navegador ou pelos testes automáticos.
 *
 * Uso manual:
 *   node testes/servidor-local.mjs
 *   Abra http://localhost:8788 no navegador.
 *   Crie o primeiro administrador em "Configuração inicial do sistema" com o token: token-de-teste-local
 *   Os dados ficam em testes/.dados-locais.sqlite (apague o arquivo para começar do zero).
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestDatabase } from './d1-sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PROD_API = 'https://pet-digital-api.nicholas-dmae.workers.dev';
export const TEST_BOOTSTRAP_TOKEN = 'token-de-teste-local';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

export async function startLocalServers({ apiPort = 8787, webPort = 8788, dbFile = ':memory:', quiet = true } = {}) {
  const { default: worker } = await import(pathToFileURL(join(root, 'worker', 'src', 'index.js')).href);
  const db = createTestDatabase(join(root, 'migrations'), dbFile);
  const webUrl = `http://localhost:${webPort}`;
  const apiUrl = `http://localhost:${apiPort}`;
  const env = {
    DB: db,
    APP_NAME: 'PET-DIGITAL-NR33',
    APP_ENV: 'teste-local',
    VALIDATION_PROFILE: 'PET-DIGITAL-NR33-v1',
    SESSION_SECRET: 'segredo-de-teste-local',
    PASSWORD_PEPPER: 'pimenta-de-teste-local',
    BOOTSTRAP_ADMIN_TOKEN: TEST_BOOTSTRAP_TOKEN,
    SESSION_TTL_SECONDS: '28800',
    CORS_ALLOWED_ORIGIN: webUrl
  };

  // Contadores e "falhas simuladas" usados pelos testes (ex.: derrubar o próximo envio da PET).
  const control = { failNext: new Map(), calls: [] };

  const api = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const path = req.url.split('?')[0];
      control.calls.push(`${req.method} ${path}`);
      const failure = control.failNext.get(path);
      if (failure && req.method !== 'OPTIONS') {
        control.failNext.delete(path);
        if (failure === 'drop') { req.socket.destroy(); return; }
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      headers.set('CF-Connecting-IP', '127.0.0.1');
      const request = new Request(apiUrl + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const response = await worker.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      if (!quiet) console.error(error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
  });

  const web = http.createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(req.url.split('?')[0]);
      if (path === '/') path = '/index.html';
      const file = normalize(join(root, 'frontend', path));
      if (!file.startsWith(join(root, 'frontend')) || !existsSync(file) || !(await stat(file)).isFile()) { res.writeHead(404); res.end('Não encontrado'); return; }
      let content = await readFile(file);
      const type = TYPES[extname(file)] || 'application/octet-stream';
      if (path === '/app-core.js' || path === '/index.html') content = Buffer.from(content.toString('utf8').split(PROD_API).join(apiUrl));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(content);
    } catch (error) {
      res.writeHead(500); res.end(error.message);
    }
  });

  const listen = (server, port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await listen(api, apiPort);
  await listen(web, webPort);
  return {
    apiUrl, webUrl, db, env, worker, control,
    close: () => Promise.all([new Promise(r => api.close(r)), new Promise(r => web.close(r))])
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const servers = await startLocalServers({ dbFile: join(here, '.dados-locais.sqlite'), quiet: false });
  console.log(`\nPET-Digital — servidor local de testes`);
  console.log(`  Aplicativo: ${servers.webUrl}`);
  console.log(`  API:        ${servers.apiUrl}`);
  console.log(`  Token do primeiro administrador: ${TEST_BOOTSTRAP_TOKEN}`);
  console.log(`  Dados em testes/.dados-locais.sqlite (apague o arquivo para recomeçar).`);
  console.log(`  Ctrl+C para encerrar.\n`);
}
