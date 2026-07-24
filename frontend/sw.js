/**
 * Service Worker do PET-Digital NR-33 v1.1.5.
 *
 * O quê: mantém offline somente os arquivos estáticos do próprio aplicativo.
 * Como: usa uma lista fechada; nunca intercepta API, Authorization, CDN, sessão ou IP.
 * Quando: instalado/atualizado ao acessar o Cloudflare Pages.
 *
 * v1.1.5:
 * - apaga imediatamente caches anteriores;
 * - atualiza a lista para os quatro módulos JavaScript;
 * - não armazena bibliotecas externas nem respostas autenticadas.
 */

const CACHE_NAME = 'pet-digital-static-v1.1.5';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app-core.js',
  './app-system.js',
  './app-form.js',
  './app-output.js',
  './manifest.json',
  './logo-dmae-2026.png'
];

const STATIC_PATHS = new Set([
  '/',
  '/index.html',
  '/styles.css',
  '/app-core.js',
  '/app-system.js',
  '/app-form.js',
  '/app-output.js',
  '/manifest.json',
  '/logo-dmae-2026.png'
]);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
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
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('Authorization')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate';
  const isAllowedStatic = STATIC_PATHS.has(url.pathname);
  if (!isNavigation && !isAllowedStatic) return;

  if (isNavigation) {
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
