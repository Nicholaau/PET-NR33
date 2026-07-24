# Mapa do código — PET-Digital v1.1.5

## Frontend

### `app-core.js`

Constantes, normalização, SHA-256, Base64, IndexedDB de chave/arquivos, armazenamento seguro e estado compartilhado.

### `app-system.js`

Sessão, login, troca de senha, usuários, dispositivos, hierarquia, consulta ao Worker e status de acesso.

### `app-form.js`

Foto, assinatura, profissionais, checklist, medições, etapas, rascunho automático, validação e finalização oficial.

### `app-output.js`

Comprovante, registro no servidor, PDF, compartilhamento, histórico compacto, validação PDF+JSON, utilitários visuais e inicialização.

### `sw.js`

Cache fechado de arquivos estáticos. Não intercepta API, Authorization ou origem externa.

### `_headers`

CSP, proteção contra iframe, política de referência/permissões e não-cache do HTML/Service Worker.

## Worker

### `worker/src/index.js`

Roteamento, autenticação, limitação de login, usuários, dispositivos, registro atômico, limites, validação e auditoria.

### Blocos importantes

- `login`, `assertLoginAllowed`, `recordLoginFailure`;
- `listDevices`, `assertCanManageDevice`;
- `createPetRecord`, `assertParticipantLimits`;
- `validatePetPayloadSafety`, `validateDocument`;
- `readJson` com limite de bytes.

## D1

### `0004_hardening_v115.sql`

Cria `auth_rate_limits` e adiciona `participant_count`.
