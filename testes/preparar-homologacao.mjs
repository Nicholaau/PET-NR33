/**
 * PET-Digital v1.3.0 — prepara o frontend do ambiente de homologação.
 *
 * O quê: copia `frontend/` para `frontend-homologacao/`, trocando o endereço da API e
 *        acrescentando uma faixa "HOMOLOGAÇÃO" no topo, para ninguém confundir com a produção.
 * Como:  node testes/preparar-homologacao.mjs https://pet-digital-api-homolog.<conta>.workers.dev
 * Quando: a cada versão que for testada em celulares reais antes de ir para produção.
 *
 * Os arquivos de `frontend/` (produção) não são alterados.
 */
import { cp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROD_API = 'https://pet-digital-api.nicholas-dmae.workers.dev';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];

if (!target || !/^https:\/\/[a-z0-9.-]+$/i.test(target.replace(/\/$/, ''))) {
  console.error('Informe o endereço do Worker de homologação. Ex.:\n  node testes/preparar-homologacao.mjs https://pet-digital-api-homolog.minha-conta.workers.dev');
  process.exit(1);
}
const api = target.replace(/\/$/, '');
if (api === PROD_API) { console.error('Esse é o endereço de PRODUÇÃO. Use o Worker de homologação.'); process.exit(1); }

const src = join(root, 'frontend');
const out = join(root, 'frontend-homologacao');
await rm(out, { recursive: true, force: true });
await cp(src, out, { recursive: true });

for (const file of ['app-core.js', 'index.html', '_headers']) {
  const path = join(out, file);
  const text = await readFile(path, 'utf8');
  await writeFile(path, text.split(PROD_API).join(api));
}

// Faixa visível de homologação e cache separado do Service Worker.
const indexPath = join(out, 'index.html');
let index = await readFile(indexPath, 'utf8');
index = index.replace('<body>', '<body class="homologacao">\n  <div class="homolog-ribbon">HOMOLOGAÇÃO — dados de teste, sem valor oficial</div>');
await writeFile(indexPath, index);
const cssPath = join(out, 'styles.css');
await writeFile(cssPath, (await readFile(cssPath, 'utf8')) + '\n.homolog-ribbon { background: #7a1f14; color: #fff; text-align: center; font-size: 13px; font-weight: 700; padding: 6px; letter-spacing: .04em; }\n');
const swPath = join(out, 'sw.js');
await writeFile(swPath, (await readFile(swPath, 'utf8')).replace(/const CACHE_NAME = '([^']+)';/, "const CACHE_NAME = '$1-homologacao';"));

console.log(`Pronto: ${out}\nAPI de homologação: ${api}\nPublique esta pasta como publicação de teste (branch "homologacao") do projeto Pages.`);
