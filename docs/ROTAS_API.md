# Rotas da API v1.1.3

Principais rotas do Worker:

```text
GET  /health
GET  /db-test
POST /setup/admin
POST /auth/login
POST /auth/logout
GET  /auth/me
POST /users
GET  /users
PATCH /users/:id/status
POST /devices/register
GET  /devices
POST /devices/:id/approve
POST /devices/:id/revoke
POST /pet-records
GET  /pet-records/:numero_pet
POST /validate
GET  /audit
```

A v1.1.3 mantém a mesma API da v1.1.0, com ajuste no fluxo do frontend e compatibilidade do PBKDF2 no Worker.


## Gestão de usuários v1.1.3

- `PATCH /users/:id` — edita cadastro/perfil/situação conforme hierarquia.
- `POST /users/:id/reset-password` — define senha temporária e revoga sessões.
- `DELETE /users/:id` — exclui logicamente o acesso, preservando histórico.
- `POST /auth/change-password` — usuário altera a própria senha.

A exclusão é lógica para não romper referências de PET, auditoria, dispositivos e sessões.
