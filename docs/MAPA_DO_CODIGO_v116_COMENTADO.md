# Mapa do código — PET-Digital v1.1.6

## `frontend/app-core.js`

Base compartilhada: versão, constantes, regras comuns, WebCrypto, IndexedDB, localStorage, hash e utilitários.

## `frontend/app-system.js`

Sessão e API: login, bloqueio visual do login, troca/redefinição de senha, usuários, dispositivos, permissões e comunicação com o Worker.

## `frontend/app-form.js`

Fluxo da PET: checklist desktop/móvel, fotos, assinatura, participantes, supervisor automático, medições, validação por etapa e emissão oficial. Também contém a recuperação segura de tentativas interrompidas.

## `frontend/app-output.js`

Documentos: constrói o PDF sem bibliotecas externas, salva arquivos temporários, compartilha PDF/JSON, renderiza histórico e executa validação oficial.

## `worker/src/index.js`

Backend: rotas, autenticação, limitação de login, hierarquia de usuários/dispositivos, validação independente do payload, verificação ECDSA, idempotência, D1 e auditoria.

## `frontend/sw.js`

Cache estático fechado. Não intercepta API nem Authorization.
