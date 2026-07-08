/*
 * Service Worker do PET Digital NR-33.
 *
 * Função geral:
 * - Permite que o aplicativo funcione offline depois do primeiro carregamento.
 * - Mantém em cache o “app shell”: HTML, CSS, JavaScript e manifesto.
 * - Controla atualização: quando uma nova versão do SW aparece, o app mostra o banner
 *   e só aplica a atualização quando o usuário confirma, evitando perder preenchimento.
 */

// Nome do cache. Cache versionado para controlar atualização entre versões publicadas.
const CACHE_NAME = 'pet-digital-cache-v1.0.4';

// Arquivos essenciais para abrir o aplicativo mesmo sem internet.
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './logo-dmae-2026.png'
];

/*
 * Evento install.
 * Quando ativa: quando o navegador instala este Service Worker pela primeira vez
 * ou detecta alteração no arquivo sw.js.
 * O que faz: abre o cache versionado e grava os arquivos principais do app.
 */
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

/*
 * Evento activate.
 * Quando ativa: quando este Service Worker passa a controlar o app.
 * O que faz: remove caches antigos que tenham nome diferente de CACHE_NAME.
 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
});

/*
 * Evento message.
 * Quando ativa: quando o app envia mensagem para o Service Worker.
 * O que faz: ao receber SKIP_WAITING, aplica imediatamente a nova versão que estava aguardando.
 */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/*
 * Evento fetch.
 * Quando ativa: em cada requisição GET feita pelo app.
 * O que faz: tenta responder pelo cache; se não houver cache, busca na rede e salva uma cópia.
 * Se a rede falhar, tenta devolver o index.html para manter o app abrindo offline.
 */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});
