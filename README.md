# PET-Digital NR-33 v1.3.0 — Cloudflare comentado

Permissão de Entrada e Trabalho em espaço confinado, digital, com assinatura, foto, geolocalização e validação por PDF + arquivo de validação (JSON).

A v1.3.0 reorganiza a **autorização de aparelhos** e cria a **separação por unidade**, com a lista oficial de unidades no banco e as permissões de cada perfil aplicadas no Worker.

> **Tem migration nova:** `migrations/0005_unidades_v130.sql`. Ordem de publicação: **banco → Worker → Pages** (ver “Instalação”).

---

## 1. O que mudou na v1.3.0

Detalhes em `docs/ALTERACOES_v130.md`. Resumo:

### Aparelhos

- Aba própria **Aparelhos** para gestor e admin, com filtros **Pendentes / Ativos / Revogados / Sem uso**, contadores, busca e paginação.
- Faixa “**N aparelhos aguardando aprovação — Ver agora**” e número no ícone da aba.
- Cada pedido mostra unidade, tipo do aparelho (ex.: “Android · Chrome”) e há quanto tempo foi feito.
- Se a pessoa já tem aparelho ativo: aviso e opção **Aprovar e revogar o anterior** ou **Manter os dois** (sem bloqueio).
- **Recusar** (pedido) e **Revogar** (aparelho ativo) com motivo; aparecem como “Recusado” ou “Revogado”, com data e responsável.
- O operador vê a hora do pedido, o motivo de uma recusa e pode enviar novo pedido depois de recusado.

### Unidades

- Lista oficial de **unidades, equipes e núcleos**, mantida por gestor e admin. Sem exclusão: só desativação, depois de mover os usuários.
- Operacional e verificador escolhem a unidade **da lista** no cadastro. Gestor e admin podem ficar como “Empresa toda”.
- O admin liga os textos digitados à mão nos cadastros antigos à unidade oficial, em um passo.
- A PET recebe a unidade do emissor **no servidor**. No formulário, “Nome da unidade” vem preenchido e travado.

### Permissões

| Ação | Operacional | Verificador | Gestor | Admin |
|---|:-:|:-:|:-:|:-:|
| Emitir PET, Minhas PETs, aparelho próprio, senha própria | ✔ | ✔ | ✔ | ✔ |
| Lista e consulta de PETs registradas | — | Só da unidade | Todas | Todas |
| Validar PDF + JSON | — | Unidade: completo · Outra: só autenticidade | ✔ | ✔ |
| Aparelhos e usuários | — | — | Operacionais e verificadores | Todos |
| Unidades | — | — | ✔ | ✔ |
| Cadastros antigos, `/db-test` | — | — | — | ✔ |

O servidor continua sem guardar PDF, JSON, fotos ou assinaturas. Para a lista de conferência, passa a guardar também data, local, trabalho e supervisor da PET.

---

## 2. Arquitetura (sem mudança)

- **Cloudflare Pages:** interface (`frontend/`).
- **Cloudflare Worker:** autenticação, autorização, validação, registro e auditoria (`worker/src/index.js`).
- **Cloudflare D1:** usuários, unidades, sessões, aparelhos autorizados, hashes, participantes e auditoria.
- **Aparelho do usuário:** rascunho, chave privada não exportável, sessão e cópias temporárias do PDF/JSON.

---

## 3. Instalação

1. **D1:** execute `migrations/0005_unidades_v130.sql` uma vez, no Console do banco de produção.
2. **Worker:** substitua o código por `worker-pet-digital-api-v1.3.0.js` (ou `worker/src/index.js`) e publique. `/health` deve mostrar `"version": "1.3.0"`.
3. **Pages:** publique **todo** o conteúdo de `frontend/` (há o arquivo novo `app-gestao.js`).
4. **Admin:** cadastre as unidades e use **Gestão → Unidades → Cadastros antigos** para padronizar os usuários atuais.

Passo a passo completo: `docs/INSTALACAO_E_TESTE.md`.

---

## 4. Como testar

Guia completo: `docs/COMO_TESTAR.md`.

```bash
cd testes
npm install                       # uma vez
npx playwright install chromium   # uma vez
npm test                          # esperado: pass 27, fail 0
```

Servidor local, sem Cloudflare: `node testes/servidor-local.mjs` e abra `http://localhost:8788`.

---

## 5. Estrutura

```text
pet-digital-v1.3.0/
├── frontend/                 → publicar no Cloudflare Pages
│   ├── index.html            telas
│   ├── styles.css            aparência
│   ├── app-core.js           constantes, armazenamento, criptografia, avisos
│   ├── app-system.js         sessão, conta, aparelho próprio, usuários, API
│   ├── app-gestao.js         aba Aparelhos, unidades, PETs registradas, aviso de pendentes (novo)
│   ├── app-form.js           etapas, checklist, medições, equipe, revisão, emissão
│   ├── app-output.js         PDF, arquivo de validação, Minhas PETs, validação, início
│   ├── sw.js, _headers, manifest.json, logo-dmae-2026.png
├── worker/                   → código do Worker (src/index.js, wrangler.toml)
├── worker-pet-digital-api-v1.3.0.js   cópia do Worker para colar no painel
├── migrations/               esquema do D1 (nova: 0005_unidades_v130.sql)
├── testes/                   testes automáticos e servidor local
└── docs/                     alterações, instalação, testes, rotas e mapa do código
```

Todo o código segue comentado no padrão **O quê / Como / Quando**. Mapa: `docs/MAPA_DO_CODIGO_v130_COMENTADO.md`.

---

## 6. Pontos que ainda exigem homologação em campo

- Mapeamento dos cadastros antigos com os dados reais da produção.
- Aviso de pendentes no celular do gestor (abrir o app, voltar de outro app).
- Troca de celular de um operador com “Aprovar e revogar o anterior”.
- Verificador conferindo PETs da unidade e validando documento de outra unidade.
- Itens anteriores continuam valendo: câmera e assinatura nos modelos usados, geolocalização, rede instável na finalização e compartilhamento por WhatsApp/e-mail.

Histórico: `docs/ALTERACOES_v120.md`, `v116`, `v115` e `v114`.
