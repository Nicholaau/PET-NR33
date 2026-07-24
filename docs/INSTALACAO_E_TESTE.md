# Instalação e teste — PET-Digital v1.1.5

## 1. D1

Execute uma única vez:

```text
migrations/0004_hardening_v115.sql
```

Confirme:

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name='auth_rate_limits';
PRAGMA table_info(pet_records);
```

A tabela deve existir e `pet_records` deve possuir `participant_count`.

## 2. Worker

Substitua o código por:

```text
worker-pet-digital-api-v1.1.5.js
```

ou `worker/src/index.js`, e faça deploy.

Teste:

```text
https://pet-digital-api.nicholas-dmae.workers.dev/health
https://pet-digital-api.nicholas-dmae.workers.dev/db-test
```

Variáveis opcionais para alterar os limites de login:

```text
LOGIN_WINDOW_SECONDS = 900
LOGIN_LOCK_SECONDS = 900
LOGIN_MAX_ACCOUNT = 5
LOGIN_MAX_IP = 20
```

## 3. Pages

Publique toda a pasta `frontend/`, incluindo `_headers`. Abra:

```text
https://pet-digital.pages.dev
```

O cache esperado é `pet-digital-static-v1.1.5`.

## 4. Testes de aceitação

### Permissões de dispositivos

1. Entre como gestor.
2. Confirme que só aparecem dispositivos de operacional/verificador.
3. Tente chamar manualmente o endpoint de dispositivo de gestor/admin: deve retornar `403`.
4. Entre como admin e confirme acesso a todos.

### Limite de login

1. Use uma conta de teste e erre a senha cinco vezes.
2. Confirme resposta `429` e mensagem de bloqueio.
3. Confirme registro em `auth_rate_limits`.
4. Após o período ou limpeza controlada do registro de teste, faça login correto.

### Registro completo

1. Emita PET com vários participantes.
2. Confirme `participant_count` igual ao número de linhas em `pet_participant_hashes`.
3. Valide PDF + comprovante e confirme `participantSetComplete: true`.

### Limites

- tente adicionar mais de 15 entrantes, 4 vigias ou 20 participantes;
- selecione foto maior que 12 MB;
- envie requisição artificial acima dos limites do Worker;
- confirme mensagens claras e ausência de registro incompleto.

### Data local

Em um aparelho configurado para Uberlândia, teste próximo da meia-noite. A data sugerida deve ser o dia local, não o dia UTC.

### Login e formulário

- pressione Enter no campo de senha;
- percorra as seis etapas;
- provoque erro em etapa anterior e clique Validar/Finalizar;
- confirme que o app abre a etapa e desloca para o primeiro problema.

### Acessibilidade

Com leitor de tela ou ferramenta automática, confirme nomes dos 12 campos de gases e cabeçalhos de linha/coluna.

### CSP/SRI/cache

- confira os cabeçalhos de resposta do Pages;
- confirme que os scripts da CDN apresentam `integrity`;
- confirme que Cache Storage contém apenas os arquivos estáticos listados no `sw.js`;
- confirme que `/auth/me`, `/users`, `/devices` e `/client-context` não são cacheados.

### Armazenamento local

- confirme que `localStorage` não contém fotos/assinaturas de registros finalizados;
- confirme no máximo 30 referências;
- simule cota cheia e verifique o aviso visível;
- confirme que uma PET já aceita no Worker não volta ao estado pendente apenas porque a cópia local falhou.

## 5. Observação

Use PETs fictícias até concluir a homologação do fluxo no ambiente real e nos celulares da equipe.
