# PET-Digital NR-33 v1.1.5 — Cloudflare comentado

Versão de endurecimento de segurança, estabilidade, acessibilidade e experiência móvel do PET-Digital NR-33.

## Arquitetura

- **Cloudflare Pages:** interface do aplicativo.
- **Cloudflare Worker:** autenticação, autorização, validação e registro.
- **Cloudflare D1:** usuários, sessões, dispositivos, hashes, participantes e auditoria.
- **Dispositivo do usuário:** PDF, comprovante técnico, rascunho e chave privada não exportável.

URLs configuradas:

- API: `https://pet-digital-api.nicholas-dmae.workers.dev`
- Frontend: `https://pet-digital.pages.dev`

O D1 não armazena PDF, JSON, foto ou imagem de assinatura. Os arquivos são recebidos apenas durante a requisição de registro/validação para recálculo independente dos hashes.

## Alterações principais da v1.1.5

### 1. Hierarquia de dispositivos corrigida

- **Admin:** administra dispositivos de todos os perfis.
- **Gestor:** visualiza e administra somente dispositivos de `operacional` e `verificador`.
- Gestor não aprova, reativa, rejeita nem revoga dispositivo de outro gestor ou de administrador.
- A mesma regra existe na listagem e nos endpoints do Worker.

### 2. Proteção contra força bruta

O Worker limita tentativas de login por dois escopos independentes:

- matrícula normalizada;
- endereço IP observado pelo Worker.

Padrão adotado:

- 5 falhas por matrícula em 15 minutos;
- 20 falhas por IP em 15 minutos;
- bloqueio temporário de 15 minutos;
- contadores apagados depois de login válido.

Os identificadores de matrícula/IP são transformados em códigos opacos antes de serem gravados. Os limites podem ser alterados pelas variáveis opcionais `LOGIN_WINDOW_SECONDS`, `LOGIN_LOCK_SECONDS`, `LOGIN_MAX_ACCOUNT` e `LOGIN_MAX_IP`.

### 3. Registro de PET e participantes em lote

O Worker monta um único `DB.batch()` com:

- registro principal da PET;
- todos os participantes;
- atualização de uso do dispositivo.

Depois do lote, confere a quantidade realmente gravada. Se houver qualquer divergência, remove o conjunto e não retorna a PET como aceita. A coluna `participant_count` também é conferida na validação oficial.

### 4. Limites defensivos

Frontend e Worker limitam:

- 20 participantes no total;
- 15 entrantes;
- 4 vigias;
- exatamente 1 supervisor;
- tamanho da requisição, PDF, comprovante e imagens dos participantes;
- nome e matrícula excessivamente longos.

Fotos selecionadas são redimensionadas para reduzir consumo de memória, rede e banco.

### 5. Armazenamento local reduzido e erro visível

- `localStorage` mantém no máximo **30 referências compactas**, sem fotos, assinaturas ou dossiê completo.
- PDF, comprovante e snapshot completo ficam no IndexedDB, separados por usuário.
- Falha por falta de espaço agora gera aviso visível, em vez de interromper silenciosamente o fluxo.
- Se a PET já tiver sido aceita pelo Worker, uma falha posterior no armazenamento local não transforma o registro oficial em pendência.
- O app continua avisando que os arquivos locais são temporários e devem ser enviados imediatamente ao supervisor.

### 6. Data local correta

O campo de data usa o calendário local do aparelho (`getFullYear/getMonth/getDate`), e não UTC. Isso evita preencher o dia seguinte no período noturno de Uberlândia.

### 7. Login tradicional por formulário

Pressionar **Enter** na matrícula ou senha envia o formulário de login. O primeiro cadastro de administrador também usa um formulário próprio.

### 8. Preenchimento guiado

O formulário foi dividido em seis etapas:

1. Identificação;
2. Checklist;
3. Atmosfera;
4. Equipe;
5. Ciência;
6. Finalização.

Há indicador de progresso, botões de etapa, avançar/voltar e deslocamento automático para o primeiro campo ou bloco com erro.

### 9. Acessibilidade das medições

Os 12 campos da tabela de gases receberam nomes acessíveis específicos, e a tabela usa cabeçalhos de coluna e linha. O resultado da validação usa região `aria-live`.

### 10. Dependências de PDF e política de segurança

- `html2canvas` 1.4.1 e `jsPDF` 4.2.1 são declarados no HTML com SRI, `crossorigin` e `referrerpolicy`.
- O frontend inclui CSP no HTML e no arquivo `_headers` do Cloudflare Pages.
- O app não injeta scripts de CDN dinamicamente.
- A consulta de IP passou a usar o próprio Worker (`/client-context`), sem serviço público adicional.

### 11. Frontend dividido em módulos

O antigo arquivo único foi separado em:

- `app-core.js` — utilitários, criptografia e armazenamento;
- `app-system.js` — login, usuários, dispositivos e API;
- `app-form.js` — formulário, fotos, assinaturas, etapas e finalização;
- `app-output.js` — PDF, histórico, compartilhamento, validação e inicialização.

Os arquivos continuam sendo scripts clássicos carregados, com `defer`, na ordem indicada pelo `index.html`.

## Migração obrigatória do D1

Depois da v1.1.4 e antes de publicar o Worker v1.1.5, execute **uma única vez**:

```text
migrations/0004_hardening_v115.sql
```

Ela cria `auth_rate_limits` e adiciona `participant_count` em `pet_records`.

Confirmação:

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name='auth_rate_limits';
PRAGMA table_info(pet_records);
```

Não execute novamente o `ALTER TABLE` se `participant_count` já existir.

## Instalação resumida

1. Execute `migrations/0004_hardening_v115.sql` no D1.
2. Substitua o código do Worker por `worker-pet-digital-api-v1.1.5.js` ou `worker/src/index.js`.
3. Faça o deploy e teste `/health` e `/db-test`.
4. Publique **todo o conteúdo** de `frontend/`, incluindo `_headers` e os quatro arquivos `app-*.js`.
5. Reabra o Pages; o Service Worker v1.1.5 remove os caches anteriores.
6. Execute o roteiro de `docs/INSTALACAO_E_TESTE.md`.

## Estrutura

```text
pet-digital-v1.1.5/
├── frontend/
│   ├── index.html
│   ├── app-core.js
│   ├── app-system.js
│   ├── app-form.js
│   ├── app-output.js
│   ├── styles.css
│   ├── sw.js
│   ├── _headers
│   ├── manifest.json
│   └── logo-dmae-2026.png
├── worker/
│   ├── src/index.js
│   ├── wrangler.toml
│   └── package.json
├── migrations/
│   ├── 0001_schema_v110.sql
│   ├── 0002_roles_v110.sql
│   ├── 0003_security_v114.sql
│   └── 0004_hardening_v115.sql
├── docs/
└── worker-pet-digital-api-v1.1.5.js
```

## Observações de homologação

- Faça primeiro emissões fictícias no ambiente real Pages/Worker/D1.
- Confirme os limites de participantes e de N/A com a Segurança do Trabalho.
- Teste câmera, geolocalização, compartilhamento e armazenamento nos aparelhos usados em campo.
- Arquivos locais podem desaparecer; PDF e comprovante devem ser enviados ao supervisor logo após a emissão.
