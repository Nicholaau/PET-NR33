# Rotas da API v1.1.5

Base: `https://pet-digital-api.nicholas-dmae.workers.dev`

## Públicas

- `GET /`
- `GET /health`
- `GET /db-test`
- `POST /setup/admin`
- `POST /auth/login` — sujeito a limite por matrícula e IP.

## Sessão autenticada

- `GET /auth/me`
- `GET /client-context` — hora/IP observados pelo Worker para a prova do PDF.
- `POST /auth/logout`
- `POST /auth/change-password`

## Usuários

- `GET /users`
- `POST /users`
- `PATCH /users/:id`
- `PATCH /users/:id/status`
- `POST /users/:id/reset-password`
- `DELETE /users/:id`

Admin administra todos. Gestor administra somente operacional/verificador.

## Dispositivos

- `POST /devices/register`
- `GET /devices`
- `POST /devices/:id/approve`
- `POST /devices/:id/revoke`

Admin administra todos. Gestor lista e administra somente operacional/verificador. O Worker repete a verificação no endpoint de alteração.

## PET

- `POST /pet-records`
  - exige autenticação, dispositivo ativo e senha não temporária;
  - aplica limites de corpo, arquivos, imagens e participantes;
  - recalcula hashes e assinaturas;
  - grava registro + participantes em `DB.batch()`;
  - confere `participant_count`;
  - não persiste PDF/JSON.
- `GET /pet-records/:numeroOuHash`
- `POST /validate`
- `POST /validate-document`

## Auditoria

- `GET /audit?limit=50`

## Códigos relevantes

- `400`: dados inválidos;
- `401`: credenciais/sessão inválidas;
- `403`: perfil, chave ou dispositivo sem permissão;
- `409`: conflito de número, conteúdo ou idempotência;
- `413`: requisição/arquivo/equipe acima do limite;
- `422`: regra de segurança da PET recusada;
- `429`: tentativas de login temporariamente bloqueadas.
