# Instalação — PET-Digital v1.3.0

A ordem importa: **banco → Worker → Pages**. O Worker v1.3.0 consulta a tabela `units`; publicado antes da migration, o login para de funcionar.

## 0. Antes de publicar

Rode os testes automáticos (ver `docs/COMO_TESTAR.md`):

```bash
cd testes && npm install && npx playwright install chromium && npm test
```

Só publique com `fail 0`. O esperado é `pass 27`.

## 1. D1 — migration 0005

1. No painel da Cloudflare, abra o banco D1 da produção → **Console**.
2. Cole o conteúdo de `migrations/0005_unidades_v130.sql` e execute **uma única vez**.
3. Confira com:
   ```sql
   SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'units';
   ```
   Deve aparecer `units`.

A migration só acrescenta tabela, colunas e índices. Nada é apagado.

Instalação nova (banco vazio): rode `0001`, `0003`, `0004` e `0005`, nessa ordem. A `0002` só serve para bases antigas com perfis antigos.

## 2. Worker

1. No Worker `pet-digital-api`, substitua o código por `worker-pet-digital-api-v1.3.0.js` (ou `worker/src/index.js`).
2. Variáveis e secrets: os mesmos da v1.2.0.
3. Publique (**Deploy**).
4. Abra `https://pet-digital-api.nicholas-dmae.workers.dev/health` e confira `"version": "1.3.0"`.
5. Entre no app com o admin para confirmar que o login continua funcionando.

## 3. Pages

1. Publique **todo** o conteúdo de `frontend/`. Há um arquivo novo: `app-gestao.js`.
2. Abra o app no computador e no celular. Se aparecer “Nova versão disponível”, toque em **Atualizar agora**.
3. Em **Conta**, confira “PET Digital versão 1.3.0”.

## 4. Primeiros passos depois de publicar (admin)

1. **Gestão → Unidades → + Nova:** cadastre as unidades, equipes e núcleos que vão usar o sistema.
2. **Gestão → Unidades → Cadastros antigos:** para cada texto digitado à mão nos cadastros atuais, escolha a unidade oficial e toque **Aplicar**. Se a unidade ainda não existir, use “Criar a unidade … e aplicar”.
3. **Gestão → Usuários:** confira se ninguém ficou com “Sem unidade”. Use o filtro “Sem unidade” para achar quem falta e defina em **Editar**.
4. Gestores e admins podem continuar sem unidade (“Empresa toda”).

> Enquanto um operacional estiver sem unidade, ele continua emitindo PET normalmente, mas as PETs dele não aparecem para nenhum verificador. Gestor e admin veem todas.

## 5. Conferência rápida

1. Gestor: a faixa “N aparelhos aguardando aprovação” aparece quando há pedidos; “Ver agora” abre os pendentes.
2. Operacional: o campo “Nome da unidade” da etapa 1 vem preenchido e travado.
3. Verificador: aba **Conferência** mostra só as PETs da unidade dele.
4. Validar uma PET de outra unidade com um verificador: deve aparecer “Documento autêntico”, sem o nome do emissor.
5. Seguir o roteiro de campo em `docs/COMO_TESTAR.md`, seção 4.

## 6. Voltar à versão anterior (se necessário)

- Worker: publique de novo o código da v1.2.0. Ele funciona com o banco já migrado (as colunas novas são ignoradas).
- Pages: no painel, promova a publicação anterior (“Rollback”).
- Banco: não é preciso desfazer a migration.
- Publique Worker e Pages da mesma versão: o app v1.2.0 com o Worker v1.3.0 não consegue cadastrar operacional nem verificador, porque não envia a unidade.
