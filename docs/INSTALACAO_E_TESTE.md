# Instalação — PET-Digital v1.2.0

## 0. Antes de publicar

Rode os testes automáticos (ver `docs/COMO_TESTAR.md`):

```bash
cd testes && npm install && npx playwright install chromium && npm test
```

Só publique com `fail 0`.

## 1. D1

**Não há migration nova.** Se a v1.1.5 ou v1.1.6 já está funcionando, não altere o banco.

Instalação nova: rode `0001_schema_v110.sql`, `0003_security_v114.sql` e `0004_hardening_v115.sql`, nessa ordem. A `0002` só serve para bases antigas com perfis antigos.

## 2. Worker

1. No Worker `pet-digital-api`, substitua o código por `worker-pet-digital-api-v1.2.0.js` (ou `worker/src/index.js`).
2. Variáveis: as mesmas da v1.1.6. Novidade opcional: `CORS_ALLOW_PREVIEWS`.
   - sem a variável ou com `"true"`: aceita `https://pet-digital.pages.dev` e as publicações de teste `https://<id>.pet-digital.pages.dev`;
   - `"false"`: aceita só o endereço principal.
3. Publique (Deploy).
4. Abra `https://pet-digital-api.nicholas-dmae.workers.dev/health` e confira:
   - `"version": "1.2.0"`;
   - `dbBindingConfigured`, `sessionSecretConfigured`, `passwordPepperConfigured` como `true`.
5. `/db-test` agora responde `401` sem login de administrador. É o esperado.

## 3. Pages

1. Publique **todo** o conteúdo de `frontend/` (os quatro `app-*.js`, `index.html`, `styles.css`, `sw.js`, `_headers`, `manifest.json` e o logotipo).
2. Abra `https://pet-digital.pages.dev` no computador e no celular.
3. Se aparecer “Nova versão disponível”, toque em **Atualizar agora**. Se continuar a versão antiga, feche a aba e abra de novo.
4. Em **Conta**, confira “PET Digital versão 1.2.0”.

> Na primeira abertura da v1.2.0, cada usuário precisa entrar de novo uma vez. Os rascunhos continuam salvos.

## 4. Conferência rápida depois de publicar

1. Entrar e sair; entrar de novo e fechar/abrir o app (deve continuar conectado).
2. Fazer uma PET fictícia completa e conferir o PDF (página 2: detector, N/A e ciência).
3. Validar essa PET na aba Gestão com o PDF e o arquivo de validação.
4. Seguir o roteiro de campo em `docs/COMO_TESTAR.md`, seção 4.

## 5. Voltar à versão anterior (se necessário)

- Worker: publique de novo o código da v1.1.6.
- Pages: no painel, promova a publicação anterior (“Rollback”).
- Banco: nada a desfazer.
