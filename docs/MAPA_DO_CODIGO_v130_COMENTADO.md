# Mapa do código — v1.3.0

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
| `registerDevice`, `refreshDevices` | Pedido e situação do **próprio** aparelho (`/devices?mine=1`), com horário do pedido, recusa e revogação |
| Usuários (`createUser`, `renderUsers`, `openEditUser`, `saveUserEdit`, `confirmResetPassword`, `deleteUser`) | Cadastro com unidade da lista, filtro por unidade e hierarquia |

## frontend/app-gestao.js — aparelhos, unidades e PETs registradas (v1.3.0)

| Item | Função |
|---|---|
| `deviceKind`, `timeAgo` | “Android · Chrome”; “há 2 h” |
| `loadUnits`, `fillUnitSelects`, `updateNewUserUnitOptions`, `fillEditUserUnitSelect` | Lista oficial de unidades e campos de escolha |
| `renderUnits`, `createUnitFromPanel`, `openUnitEdit`, `saveUnitEdit`, `changeUnitStatus` | Gestão → Unidades |
| `refreshLegacyUnits`, `applyLegacyMapping` | Cadastros antigos (texto livre → unidade oficial) |
| `filterUsersForView`, `renderUnmappedNotice` | Filtro da lista de usuários e aviso de quem está sem unidade |
| `setManageSection`, `refreshManageSection` | Áreas PETs / Usuários / Unidades da aba Gestão |
| `refreshPetList`, `petCardHtml`, `teamLine`, `renderPager` | PETs registradas (verificador: só a unidade) |
| `refreshDeviceAdmin`, `renderDeviceCounts`, `deviceCardHtml` | Aba Aparelhos: filtros, contadores, busca, paginação |
| `approveDeviceRequest`, `openDeviceAction`, `confirmDeviceAction` | Aprovar (com ou sem revogar o anterior), recusar e revogar com motivo |
| `setPendingDevicesCount`, `updatePendingBanner`, `refreshPendingDevicesCount`, `startPendingWatch` | Número na aba e faixa “aguardando aprovação” |
| `applyUserUnitToForm` | “Nome da unidade” preenchido e travado pela unidade do cadastro |
| `bindGestaoEvents`, `resetGestaoState` | Eventos e limpeza ao sair |

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
| `bindEvents`, `showTab` | Eventos da interface; chama `bindGestaoEvents()`; abas Aparelhos e Gestão por perfil |

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

Rotas e permissões em `docs/ROTAS_API.md`.

| Item | Função |
|---|---|
| `USER_SELECT`, `requireAuth`, `publicUser` | Usuário sempre com `unitId`/`unitName` (e `legacyUnit` enquanto não mapeado) |
| `listUnits`, `createUnit`, `updateUnit` | Unidades: lista, criação, renomear, tipo, desativar/reativar |
| `listLegacyUnits`, `mapLegacyUnit` | Cadastros antigos (admin) |
| `resolveUnitForUser`, `validateUnitInput`, `unitNameKey` | Regras de unidade no cadastro e nome único |
| `registerDevice` | Novo pedido após recusa; guarda o navegador do pedido |
| `listDevices`, `decorateDevice` | `mine=1`; `view=manage` com filtros, contadores, busca e paginação |
| `approveDevice`, `revokeDevice` | `revokeOthers`; motivo; recusa × revogação |
| `createPetRecord` | Grava unidade do emissor, data, local, trabalho e supervisor |
| `listPetRecords`, `getPetRecord`, `validateHash`, `validateDocument`, `canSeePetDetails` | Escopo por unidade do verificador |
| `searchTerm`, `pagination`, `shortText`, `formatBrDate` | Auxiliares |

## testes/

| Arquivo | Função |
|---|---|
| `d1-sqlite.mjs` | Banco D1 simulado com o SQLite do Node |
| `servidor-local.mjs` | Worker + frontend locais (manual ou para os testes) |
| `api.test.mjs` | Regras de segurança do Worker |
| `e2e.test.mjs` | Aplicativo no navegador, em tela de celular |
| `preparar-homologacao.mjs` | Gera o frontend do ambiente de homologação |
