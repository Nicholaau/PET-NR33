# Mapa do código - PET-Digital NR-33 v1.1.4

## Frontend

### `frontend/index.html`

Estrutura da tela: login, formulário, sistema, registros, validação e diálogos administrativos.

### `frontend/app.js`

Principais blocos:

- constantes e padrões de prova;
- armazenamento local por usuário;
- IndexedDB da chave privada por usuário e dos arquivos temporários;
- autenticação e usuários;
- autorização de dispositivo;
- captura de foto e assinatura;
- checklist e medições;
- validação impeditiva;
- geração do PDF/JSON;
- registro atômico no Worker;
- compartilhamento;
- validação conjunta de PDF + JSON no servidor.

### `frontend/sw.js`

Cache fechado apenas para arquivos estáticos do Pages. Não intercepta API ou respostas autenticadas.

## Worker

### `worker/src/index.js`

Arquivo principal para projeto organizado/Wrangler.

### `worker-pet-digital-api-v1.1.4.js`

Cópia idêntica e avulsa para colar diretamente no editor do painel Cloudflare.

Principais blocos:

- roteamento e CORS;
- autenticação e sessões;
- gestão de usuários;
- dispositivos e chaves públicas;
- registro da PET;
- validação independente no servidor;
- regras de segurança repetidas no backend;
- auditoria;
- funções de hash, assinatura e senha.

## D1

A migration `0003_security_v114.sql` adiciona a chave de idempotência e índices necessários para impedir duplicação e realizar validação exata.
