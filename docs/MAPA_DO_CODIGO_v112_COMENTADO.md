# Mapa do Código — PET-Digital NR-33 v1.1.2 comentado

## Frontend

- `frontend/index.html`: estrutura visual do aplicativo.
- `frontend/app.js`: lógica principal, autenticação, autorização do dispositivo, preenchimento da PET, validação, assinatura, PDF e comprovante técnico.
- `frontend/styles.css`: layout e responsividade.
- `frontend/sw.js`: funcionamento offline e cache versionado.

## Worker

- `worker/src/index.js`: API Cloudflare Worker.
- `worker-pet-digital-api-v1.1.2.js`: cópia avulsa do mesmo código para colar direto no painel da Cloudflare.

## Fluxo v1.1.2

1. Usuário faz login.
2. Dispositivo é preparado localmente.
3. Dispositivo é registrado/autorizado no sistema.
4. Usuário preenche a PET.
5. App valida campos, fotos, assinaturas e checklist.
6. App assina tecnicamente a PET.
7. Worker registra a emissão no D1.
8. PDF oficial e comprovante técnico são liberados para compartilhamento.

## Mudança principal

Sem login e sem dispositivo autorizado, o usuário pode preencher rascunho, mas não consegue finalizar a PET oficial nem gerar PDF/comprovante técnico.
