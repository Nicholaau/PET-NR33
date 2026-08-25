# PET-Digital NR-33 v1.1.6 — Cloudflare comentado

Versão de correção e refinamento da experiência de emissão da PET Digital NR-33. Esta entrega mantém a arquitetura **Cloudflare Pages + Worker + D1**, sem armazenar PDF, JSON, fotos ou imagens de assinatura no D1.

## Arquitetura

- **Cloudflare Pages:** interface do aplicativo.
- **Cloudflare Worker:** autenticação, autorização, validação, registro e auditoria.
- **Cloudflare D1:** usuários, sessões, dispositivos autorizados, hashes, participantes e auditoria.
- **Dispositivo do usuário:** rascunho, chave privada não exportável e cópias temporárias do PDF/arquivo de validação (JSON).

URLs configuradas nesta versão:

- API: `https://pet-digital-api.nicholas-dmae.workers.dev`
- Frontend: `https://pet-digital.pages.dev`

> O D1 não guarda os arquivos finais. Durante o registro/validação, o Worker recebe temporariamente PDF e JSON, recalcula os hashes e grava somente hashes/metadados necessários à prova e auditoria.

## Alterações principais da v1.1.6

### 1. Correção do erro de finalização `pdfGenerationProofs.push`

Foi corrigido o erro observado no celular:

`Cannot read properties of undefined (reading 'push')`

Agora toda tentativa reaproveitada é normalizada antes do uso. O array `integrity.pdfGenerationProofs` é criado quando estiver ausente, sem inventar hashes ou assinaturas.

Também foi corrigido o estado de **registro pendente**:

- uma PET só é marcada como pendente depois de PDF + JSON existirem de fato;
- o botão **Repetir envio pendente** só aparece quando os dois arquivos e seus hashes estão disponíveis no IndexedDB;
- se a geração falhar antes disso, o formulário é preservado e o usuário deve apenas finalizar novamente.

### 2. Checklist: resposta obrigatória, sem forçar “Sim”

Todos os 22 itens continuam obrigatórios, porém o usuário pode registrar a condição real:

- **Sim**;
- **Não**;
- **N/A**.

O aplicativo não altera a resposta do usuário. A regra é separar **registro da condição** de **autorização da entrada**:

- respostas inseguras são aceitas durante o preenchimento;
- ao avançar, o usuário recebe aviso quando aplicável;
- na emissão oficial, condições impeditivas bloqueiam a PET;
- todo N/A exige justificativa;
- N/A em item crítico pode ser registrado, mas impede a emissão até revisão.

As mesmas regras de segurança continuam sendo repetidas no Worker para não depender somente do navegador.

### 3. Validação por etapa

O formulário passou a validar cada etapa ao clicar em **Próxima etapa**.

Fluxo:

1. Identificação;
2. Checklist;
3. Atmosfera;
4. Equipe;
5. Ciência;
6. Finalização.

Quando há erro:

- a etapa não avança;
- a mensagem mostra o que deve ser corrigido;
- o aplicativo leva o usuário ao primeiro campo/bloco relacionado ao erro.

A validação completa é repetida antes da emissão oficial.

### 4. Navegação móvel mais compacta

Os seis botões fixos de etapa foram removidos da área principal. A navegação utiliza:

- nome da etapa atual;
- barra de progresso;
- contador `etapa / total`;
- botões **Voltar** e **Próxima etapa**.

Isso reduz a área ocupada no celular.

### 5. Checklist otimizado para celular

No desktop permanece a tabela tradicional. Em telas pequenas, cada item vira um cartão com três opções grandes:

`Sim | Não | N/A`

A justificativa de N/A aparece no próprio cartão. Os controles móvel e desktop são sincronizados e geram o mesmo payload.

### 6. Supervisor informado uma única vez

O campo “Supervisor de entrada” deixou de ser digitado na Identificação.

O nome e a matrícula são obtidos automaticamente do participante com função **Supervisor de Entrada** cadastrado na etapa **Equipe**. Esses dados são copiados para o payload/PDF na finalização.

Isso elimina divergência entre dois campos preenchidos manualmente.

### 7. Tela de login simplificada

O acesso diário recebeu prioridade visual. A criação do primeiro administrador ficou recolhida em:

**Configuração inicial do sistema**

Ela continua disponível para implantação, mas não ocupa metade da tela de login.

O botão **Entrar no sistema** fica desabilitado e mostra `Entrando...` enquanto aguarda a API. Isso evita cliques repetidos consumindo tentativas do limitador de login.

### 8. Aba ativa destacada

O menu superior destaca visualmente a área aberta e usa `aria-current="page"` para tecnologias assistivas.

### 9. Menos botões na finalização

Na etapa final ficam em destaque apenas as ações principais. Depois da emissão:

- **Compartilhar PDF**;
- **Compartilhar arquivo de validação (JSON)**.

Ações secundárias ficam recolhidas em **Outras opções**.

### 10. Terminologia de produção

Na interface, “Comprovante técnico” foi substituído por:

**Arquivo de validação da PET (JSON)**

Termos criptográficos detalhados continuam concentrados em áreas de **Detalhes técnicos**.

### 11. PDF sem bibliotecas externas

A v1.1.6 remove `jsPDF`, `html2canvas` e qualquer script de CDN.

O PDF é produzido localmente com APIs nativas do navegador:

1. o aplicativo desenha as páginas em `Canvas 2D`;
2. converte cada página para JPEG;
3. monta localmente a estrutura PDF 1.4;
4. calcula o SHA-256 dos bytes finais;
5. gera o JSON correspondente;
6. registra os dois hashes no Worker.

Consequências:

- nenhuma biblioteca de PDF é baixada de terceiros durante o uso;
- `script-src` da CSP pode permanecer somente `'self'`;
- o PDF continua contendo dados, checklist, medições, fotos, assinaturas e elementos de integridade.

### 12. Segurança e endurecimentos da v1.1.5 mantidos

Continuam ativos:

- limite de tentativas de login por matrícula e IP;
- hierarquia de administração de dispositivos;
- limites de participantes e tamanho de requisição;
- verificação de números negativos nas medições;
- separação dos dados locais por usuário;
- Service Worker limitado a arquivos estáticos;
- registro do principal + participantes em `DB.batch()` e conferência posterior;
- idempotência e conflito HTTP 409;
- validação oficial por PDF + JSON + registro do D1 + chave autorizada.

## D1 / migrations

### Atualizando da v1.1.5 para a v1.1.6

**Não há nova migration do D1.**

Se `0004_hardening_v115.sql` já foi executada, não rode novamente.

### Instalação nova ou atualização de versão anterior à v1.1.5

Confira se as migrations existentes foram aplicadas na ordem necessária:

- `0001_schema_v110.sql`
- `0002_roles_v110.sql` — somente para base que ainda possua perfis antigos;
- `0003_security_v114.sql`
- `0004_hardening_v115.sql`

## Instalação resumida da v1.1.6

1. **Não altere o D1** se a v1.1.5 já estava funcionando.
2. No Worker `pet-digital-api`, substitua o código pelo arquivo `worker-pet-digital-api-v1.1.6.js` ou por `worker/src/index.js`.
3. Faça deploy do Worker.
4. Teste:
   - `/health`
   - `/db-test`
5. Publique **todo o conteúdo** de `frontend/` no Cloudflare Pages.
6. Reabra o aplicativo. O Service Worker `pet-digital-static-v1.1.6` elimina caches antigos e atualiza os arquivos estáticos.
7. Faça uma PET fictícia completa antes de liberar a versão para uso real.

## Estrutura

```text
pet-digital-v1.1.6/
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
├── docs/
└── worker-pet-digital-api-v1.1.6.js
```

## Arquivos importantes para revisão do código

- `frontend/app-core.js`: constantes, armazenamento, WebCrypto, IndexedDB e utilitários.
- `frontend/app-system.js`: login, usuários, dispositivos, sessão e chamadas à API.
- `frontend/app-form.js`: checklist, medições, participantes, assinatura, etapas e finalização.
- `frontend/app-output.js`: criação do PDF, compartilhamento, histórico e validação.
- `worker/src/index.js`: autenticação, autorização, validação independente e D1.

Todos continuam comentados no padrão **O quê / Como / Quando**.

## Pontos que ainda exigem homologação em campo

Antes de considerar a versão definitiva:

- testar câmera em Android/iPhone utilizados pela equipe;
- testar assinatura com dedo em diferentes tamanhos de tela;
- testar geolocalização permitida/negada;
- testar rede instável durante a finalização e o botão de repetição pendente;
- testar compartilhamento do PDF e JSON por WhatsApp/e-mail/app corporativo;
- validar visualmente PDFs com 1, 5, 10 e 20 participantes;
- confirmar com Segurança do Trabalho quais respostas “Não” e N/A devem permanecer impeditivas.

> Os arquivos do dispositivo são temporários. Após a emissão oficial, PDF e Arquivo de validação da PET (JSON) devem ser encaminhados imediatamente ao supervisor responsável.
