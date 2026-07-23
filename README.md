# PET-Digital NR-33 v1.1.4 - Cloudflare comentado

Versão de correção de segurança e consistência do **PET-Digital NR-33**, preparada para:

- frontend estático no **Cloudflare Pages**;
- API no **Cloudflare Worker**;
- usuários, dispositivos, hashes e auditoria no **Cloudflare D1**;
- PDF e comprovante técnico armazenados apenas temporariamente no dispositivo do usuário.

## URLs configuradas

- Worker/API: `https://pet-digital-api.nicholas-dmae.workers.dev`
- Pages/frontend: `https://pet-digital.pages.dev`

## Alterações principais da v1.1.4

### 1. Validação oficial não confia apenas no JSON

A aba **Validar** agora exige os dois arquivos correspondentes:

- PDF oficial;
- comprovante técnico JSON.

O frontend recalcula o hash dos bytes reais dos dois arquivos e consulta o Worker. O servidor somente confirma a PET quando houver coincidência exata de:

- número da PET;
- hash do payload;
- hash do PDF;
- hash do JSON;
- usuário emissor;
- matrícula do emissor;
- dispositivo/chave previamente autorizada na data da emissão.

Um JSON criado com uma chave própria, mas nunca registrado, não é mais apresentado como documento oficialmente válido.

### 2. Cache offline restrito aos arquivos estáticos

O Service Worker foi refeito. Ele nunca armazena:

- chamadas do Worker/API;
- `/auth/me`, `/users`, `/devices` ou outras respostas autenticadas;
- requisições com `Authorization`;
- consulta de IP;
- respostas de outra origem;
- dados de sessão.

Na instalação da v1.1.4, os caches anteriores são removidos e o novo Service Worker assume imediatamente.

### 3. Regras impeditivas no frontend e no Worker

A PET é recusada em ambos os lados quando houver, entre outros:

- valores negativos nas medições;
- gases fora dos limites configurados;
- item crítico marcado como N/A;
- mais de 5 respostas N/A;
- N/A sem justificativa objetiva de pelo menos 10 caracteres;
- matrícula repetida;
- supervisor da identificação diferente do supervisor assinante;
- detector não informado, não confirmado ou vencido;
- foto, assinatura ou respectivos hashes ausentes/incompatíveis;
- quantidade inválida de supervisor, entrante ou vigia;
- item impeditivo do checklist.

Os itens que aceitam N/A e o limite de cinco são regras de aplicação desta versão e devem ser homologados pelo setor responsável por Segurança do Trabalho antes do uso definitivo.

### 4. Dados locais separados por usuário

Rascunhos, histórico, arquivos oficiais temporários e a chave criptográfica local usam identificadores vinculados ao usuário autenticado. Ao sair ou trocar de conta, o estado em memória é limpo e a próxima conta carrega somente seus próprios dados locais.

As antigas chaves globais de rascunho e registros são removidas durante o login. A chave criptográfica global das versões anteriores só é migrada quando o Worker confirma que o respectivo código já pertence à conta atual; ela nunca é atribuída automaticamente a outro usuário.

Essa separação é feita pela aplicação. Em dispositivo compartilhado, um usuário com acesso administrativo ao navegador/DevTools ainda pode alcançar dados locais; por isso, o envio imediato ao supervisor e a limpeza controlada do dispositivo continuam obrigatórios.

### 5. PDF e JSON vinculados ao registro do servidor

A ordem de finalização agora é:

1. validar a PET;
2. gerar número e chave de idempotência;
3. assinar o payload;
4. coletar prova de geração, IP, data/hora e geolocalização disponível;
5. gerar o PDF final;
6. calcular o SHA-256 dos bytes reais do PDF;
7. gerar o JSON final;
8. calcular o SHA-256 do texto exato do JSON;
9. enviar temporariamente arquivos, hashes e assinaturas ao Worker;
10. o Worker recalcula os hashes, valida tudo e grava somente hashes/metadados no D1.

O PDF e o JSON não são persistidos no D1.

### 6. Proteção contra finalização duplicada

- o botão é bloqueado durante o processamento;
- a mesma tentativa reutiliza número, conteúdo e `idempotencyKey`;
- após sucesso, o botão permanece bloqueado;
- para nova emissão, é necessário limpar/iniciar outro formulário;
- o D1 possui índice único para a chave de idempotência;
- requisições simultâneas também são reconsultadas após eventual conflito de índice e só retornam sucesso quando todo o conjunto coincide.

### 7. Conflitos retornam HTTP 409

Repetição só é aceita como sucesso quando número, payload, PDF, JSON e usuário correspondem ao mesmo registro. Divergência de número, conteúdo ou arquivo retorna conflito `409`; o frontend não informa registro concluído.

## Migração obrigatória do D1

Antes de publicar o Worker v1.1.4, execute **uma única vez** no console SQL do D1:

```text
migrations/0003_security_v114.sql
```

Ela adiciona:

- coluna `pet_records.idempotency_key`;
- índice único de idempotência;
- índice para validação exata.

Para verificar antes/depois:

```sql
PRAGMA table_info(pet_records);
```

Se `idempotency_key` já existir, não execute novamente o comando `ALTER TABLE`.

## Ordem de instalação

1. Faça backup/exportação do D1, se desejar preservar uma cópia antes da alteração.
2. Execute `migrations/0003_security_v114.sql` no D1.
3. No Worker `pet-digital-api`, substitua o código por:
   - `worker/src/index.js`; ou
   - `worker-pet-digital-api-v1.1.4.js`.
4. Faça o deploy do Worker.
5. Teste `/health` e `/db-test`.
6. Publique todo o conteúdo de `frontend/` no Cloudflare Pages.
7. Abra o Pages e aguarde a atualização automática do Service Worker.
8. Faça os testes descritos em `docs/INSTALACAO_E_TESTE.md`.

## Estrutura do pacote

```text
pet-digital-v1.1.4/
├── frontend/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── sw.js
│   ├── manifest.json
│   └── logo-dmae-2026.png
├── worker/
│   ├── src/index.js
│   ├── wrangler.toml
│   └── package.json
├── migrations/
│   ├── 0001_schema_v110.sql
│   ├── 0002_roles_v110.sql
│   └── 0003_security_v114.sql
├── docs/
└── worker-pet-digital-api-v1.1.4.js
```

## Compatibilidade com registros anteriores

A validação oficial exata da v1.1.4 exige que o registro no D1 possua `pdf_hash`, `json_hash`, prova do PDF e vínculo de dispositivo. PETs antigas registradas antes dessa correção, com esses campos nulos, não passam pelo novo validador oficial. Elas não são alteradas automaticamente; a regra vale para novas emissões feitas pela v1.1.4.

## Aviso operacional exibido no app

Os dados e arquivos da PET permanecem temporariamente no dispositivo. Após concluir a emissão, o usuário deve compartilhar imediatamente o PDF e o comprovante técnico com o supervisor responsável. Limpeza do navegador, troca de aparelho, falta de espaço ou atualização do sistema pode apagar o conteúdo local.

## Limites desta revisão

- Não foi realizado deploy dentro da conta Cloudflare do DMAE a partir deste pacote.
- Os testes incluídos foram executados localmente sobre sintaxe, estrutura, migração, política de cache, idempotência, validação criptográfica simulada e integridade do pacote.
- A homologação final deve incluir teste real no Pages/Worker/D1 e validação do fluxo pelo setor de Segurança do Trabalho e pela área responsável por proteção de dados.
