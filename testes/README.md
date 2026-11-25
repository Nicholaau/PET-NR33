# Testes — PET-Digital NR-33 v1.3.0

Guia completo: `../docs/COMO_TESTAR.md`.

```bash
npm install                       # uma vez
npx playwright install chromium   # uma vez
npm test                          # API + aplicativo (esperado: pass 27, fail 0)
npm run servidor                  # app local em http://localhost:8788 (token: token-de-teste-local)
```

| Arquivo | Para que serve |
|---|---|
| `api.test.mjs` | Regras de segurança e permissões do Worker (18 testes) |
| `e2e.test.mjs` | O aplicativo usado em tela de celular, do login à validação, com unidades e aparelhos (9 cenários) |
| `servidor-local.mjs` | Roda Worker + frontend no computador, sem Cloudflare |
| `d1-sqlite.mjs` | Banco D1 simulado com o SQLite do Node; aplica todas as migrations, inclusive a 0005 |
| `preparar-homologacao.mjs` | Gera `frontend-homologacao/` apontando para o Worker de homologação |
