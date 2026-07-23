# Rotas da API v1.1.4

Base: `https://pet-digital-api.nicholas-dmae.workers.dev`

## Públicas

- `GET /`
- `GET /health`
- `GET /db-test`
- `POST /setup/admin` - somente instalação inicial.
- `POST /auth/login`

## Sessão autenticada

- `GET /auth/me`
- `POST /auth/logout`
- `POST /auth/change-password`

## Usuários - admin/gestor conforme hierarquia

- `GET /users`
- `POST /users`
- `PATCH /users/:id`
- `PATCH /users/:id/status`
- `POST /users/:id/reset-password`
- `DELETE /users/:id`

## Dispositivos

- `POST /devices/register`
- `GET /devices`
- `POST /devices/:id/approve`
- `POST /devices/:id/revoke`

## PET

- `POST /pet-records`
  - requer usuário autenticado e dispositivo ativo;
  - recebe payload, assinaturas, PDF Base64 e JSON exato apenas durante a requisição;
  - recalcula hashes e aplica regras de segurança;
  - usa `idempotencyKey`;
  - não grava os arquivos.

- `GET /pet-records/:numeroOuHash`
  - admin, gestor ou verificador.

- `POST /validate`
  - consulta simples por hash;
  - admin, gestor ou verificador.

- `POST /validate-document`
  - validação oficial do conjunto PDF + JSON;
  - exige número, hashes reais, emissor, matrícula e código do dispositivo;
  - consulta o registro exato no D1;
  - admin, gestor ou verificador.

## Auditoria

- `GET /audit?limit=50`
  - admin ou gestor.

## Respostas e cache

As respostas do Worker incluem `Cache-Control: no-store, private, max-age=0`. Conflitos de número/idempotência/conteúdo retornam `409`.
