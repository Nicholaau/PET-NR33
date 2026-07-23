/**
 * Service Worker do PET-Digital NR-33 v1.1.4.
 *
 * O quê: mantém offline somente os arquivos estáticos necessários para abrir a interface.
 * Como: utiliza uma lista fechada de arquivos do próprio Pages e ignora integralmente API,
 * autenticação, IP, sessão, respostas com Authorization e qualquer origem externa.
 * Quando: é instalado/atualizado pelo navegador ao acessar o aplicativo publicado.
 *
 * Correção de segurança v1.1.4:
 * - versões anteriores armazenavam qualquer requisição GET, inclusive respostas autenticadas;
 * - esta versão apaga imediatamente os caches antigos e nunca grava respostas da API.
 */

const CACHE_NAME = 'pet-digital-static-v1.1.4';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './logo-dmae-2026.png'
];

// Caminhos que podem ser armazenados. Qualquer caminho não listado sempre segue direto para a rede.
const STATIC_PATHS = new Set([
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/logo-dmae-2026.png'
]);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Exclui caches legados já no install para reduzir a janela de exposição da versão antiga.
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;

  // Nunca interfere em POST/PATCH/DELETE, nem em requisições autenticadas.
  if (request.method !== 'GET' || request.headers.has('Authorization')) return;

  const url = new URL(request.url);

  // Nunca intercepta Worker/API, CDN, consulta de IP ou qualquer origem externa.
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate';
  const isAllowedStatic = STATIC_PATHS.has(url.pathname);
  if (!isNavigation && !isAllowedStatic) return;

  if (isNavigation) {
    // Navegação é network-first: prioriza versão atual; usa index offline apenas se a rede falhar.
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('./index.html', response.clone());
        }
        return response;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Arquivos estáticos: network-first para receber correções rapidamente; cache apenas como fallback offline.
  event.respondWith((async () => {
    try {
      const response = await fetch(request, { cache: 'no-store' });
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return (await caches.match(request)) || Response.error();
    }
  })());
});
