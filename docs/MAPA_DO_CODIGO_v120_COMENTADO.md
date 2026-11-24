# Mapa do código — v1.2.0

Onde está cada coisa, para revisão e manutenção. Todos os arquivos seguem comentados no padrão **O quê / Como / Quando**.

## frontend/app-core.js — núcleo

| Item | Função |
|---|---|
| `APP_VERSION`, `PAYLOAD_SCHEMA`, perfis e algoritmos | Identificação da versão e padrões criptográficos |
| `FORM_STEPS`, `GAS_LIMITS`, `CHECKLIST_GROUPS`, `checklistItems` | Etapas, limites das medições, grupos e texto dos 22 itens |
| `workspaceUserId`, `triedSteps` | Usuário carregado na tela; etapas em que o usuário já tentou avançar |
| `loadUserWorkspace({ force })` | Carrega rascunho, tentativa pendente e Minhas PETs só quando o usuário muda |
| `writePendingPointer`, `restorePendingAttempt`, `clearPendingPointer` | Tentativa gerada e não registrada (evita PET duplicada) |
| `notify`, `askConfirm`, `setBusy` | Avisos na tela, confirmação e tela de processamento |
| IndexedDB (`saveOfficialFiles`, `readOfficialFiles`, `hydrateRecord`) | PDF, JSON e cópia completa da PET no aparelho |
| `ensureKeyPair`, `createKeyPair`, `signPayloadHash`, `verifySignature` | Chave ECDSA P-256 não exportável |

## frontend/app-system.js — sessão, conta e gestão

| Item | Função |
|---|---|
| `loadAuthState`, `saveAuthState` | Sessão em `localStorage` até `expiresAt` |
| `apiFetch` | Chamada à API; erro com `status` ou `network`; 401 → `handleSessionRejected` |
| `setOffline`, `refreshMe` | Faixa “Sem conexão”; reconfirma a sessão sem mexer no formulário |
| `renderAuthState`, `updateDeviceChip` | Login × app, abas por perfil, selo do aparelho |
| `ensureOfficialAccessOrGuide` | Confere senha definitiva, internet e aparelho autorizado antes de emitir |
| `registerDevice`, `refreshDevices`, `renderDevicesList`, `changeDeviceStatus` | Autorização de aparelhos (pendentes primeiro, número na aba Gestão) |
| Usuários (`createUser`, `renderUsers`, `openEditUser`, `confirmResetPassword`, `deleteUser`) | Cadastro e hierarquia |

## frontend/app-form.js — preenchimento e emissão

| Item | Função |
|---|---|
| `renderChecklist`, `updateChecklistUi`, `scrollToNextChecklistItem` | Checklist em grupos, contador, rolagem automática |
| `parseGasValue`, `evaluateGasTest`, `updateGasUi` | Medições com vírgula, indicação de limite e teste após ventilação |
| `renderPeople`, `openPerson`, `renderPersonView`, `closePerson` | Lista da equipe e editor por pessoa |
| `openSignature`, `setupSignaturePad`, `confirmSignature` | Assinatura em tela cheia |
| `showFormView`, `showFormStep`, `goToNextFormStep`, `updateStepBar` | Navegação e barra inferior |
| `refreshStepIssues`, `focusIssue` | Destaque dos campos com pendência e “Ir para o primeiro” |
| `validate*Section`, `validateFormStep`, `validateCurrentForm` | Regras de cada etapa (Sim/Não/N/A nunca bloqueiam) |
| `renderReview`, `renderPendingAttempt` | Etapa de revisão e caixa “Envio pendente” |
| `formFingerprint` | Detecta se o formulário mudou desde a tentativa pendente |
| `finalizeRecord`, `completeRegistration`, `discardPendingAttempt`, `showDone`, `startNewPet` | Emissão, conclusão e nova PET |
| `bindEvents`, `showTab` | Todos os eventos da interface |

## frontend/app-output.js — saída e início

| Item | Função |
|---|---|
| `registerRecordOnServer`, `retryPendingRecordRegistration` | Envio e reenvio ao Worker (mesma idempotência) |
| `buildPdfChecklistPage`, `buildPdfAtmospherePages`, `buildPdfParticipantPages`, `createPdfFile` | PDF nativo (página 2 com detector, N/A e ciência) |
| `saveDraft`, `loadDraft`, `serializeForm`, `restoreForm` | Rascunho |
| `renderRecords`, `handleRecordAction`, `recordStatus` | Minhas PETs |
| `verifyFiles` | Validação oficial de PDF + JSON |
| `init` | Abre o app (com sessão salva, mesmo sem internet) |

## worker/src/index.js — API

Mesmas rotas da v1.1.6 (ver `docs/ROTAS_API.md`). Novidades: `API_VERSION`, `buildCorsHeaders` + `isPagesPreviewOf` e `/db-test` restrito a administrador.

## testes/

| Arquivo | Função |
|---|---|
| `d1-sqlite.mjs` | Banco D1 simulado com o SQLite do Node |
| `servidor-local.mjs` | Worker + frontend locais (manual ou para os testes) |
| `api.test.mjs` | Regras de segurança do Worker |
| `e2e.test.mjs` | Aplicativo no navegador, em tela de celular |
| `preparar-homologacao.mjs` | Gera o frontend do ambiente de homologação |
