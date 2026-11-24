# Testes — PET-Digital NR-33 v1.2.0

Guia completo: `../docs/COMO_TESTAR.md`.

```bash
npm install                       # uma vez
npx playwright install chromium   # uma vez
npm test                          # API + aplicativo (esperado: pass 17, fail 0)
npm run servidor                  # app local em http://localhost:8788 (token: token-de-teste-local)
```

| Arquivo | Para que serve |
|---|---|
| `api.test.mjs` | Regras de segurança do Worker |
| `e2e.test.mjs` | O aplicativo usado em tela de celular, do login à validação |
| `servidor-local.mjs` | Roda Worker + frontend no computador, sem Cloudflare |
| `d1-sqlite.mjs` | Banco D1 simulado com o SQLite do Node (sem instalar nada) |
| `preparar-homologacao.mjs` | Gera `frontend-homologacao/` apontando para o Worker de homologação |
