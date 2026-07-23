# Instalação e teste - PET-Digital v1.1.4

## 1. D1 - etapa obrigatória

No console SQL do banco `pet_digital_db`, confira:

```sql
PRAGMA table_info(pet_records);
```

Se não existir `idempotency_key`, execute uma vez:

```text
migrations/0003_security_v114.sql
```

Depois confirme:

```sql
SELECT name FROM sqlite_master
WHERE type = 'index' AND name IN (
  'idx_pet_records_idempotency',
  'idx_pet_records_exact_validation'
);
```

## 2. Worker

No `pet-digital-api`, substitua o código por:

```text
worker-pet-digital-api-v1.1.4.js
```

Faça deploy e teste:

```text
https://pet-digital-api.nicholas-dmae.workers.dev/health
https://pet-digital-api.nicholas-dmae.workers.dev/db-test
```

O `/health` deve indicar D1 e secrets configurados.

## 3. Pages

Publique o conteúdo da pasta `frontend/` no projeto `pet-digital`.

Abra:

```text
https://pet-digital.pages.dev
```

A v1.1.4 elimina caches antigos automaticamente. Em teste, feche abas antigas e recarregue a página uma vez.

## 4. Testes de aceitação recomendados

### Sessão/cache

1. Entre como usuário A.
2. Abra Sistema e Registros.
3. Saia.
4. Entre como usuário B no mesmo navegador.
5. Confirme que rascunhos/registros de A não aparecem e que o dispositivo de A não é apresentado como autorizado para B.
6. No DevTools > Application > Cache Storage, confirme que só há `pet-digital-static-v1.1.4` e apenas arquivos estáticos.

### PET insegura

Confirme que a finalização é bloqueada para:

- valor negativo de gás;
- todos os itens em N/A;
- item crítico em N/A;
- N/A sem justificativa;
- matrículas repetidas;
- supervisor divergente;
- detector vencido;
- assinatura/foto ausente.

### Emissão e idempotência

1. Finalize uma PET válida.
2. Durante o processamento, tente clicar novamente.
3. Confirme que não é criado outro número.
4. Após sucesso, confirme botão bloqueado.
5. Para nova PET, use Limpar formulário.

### Falha/repetição

1. Interrompa a internet imediatamente antes do registro.
2. Confirme a situação pendente.
3. Restaure a internet e use Repetir registro pendente.
4. Confirme que o mesmo número e a mesma tentativa são reutilizados.

### Validação oficial

1. Receba PDF e JSON de uma PET registrada.
2. Entre como verificador/gestor/admin.
3. Selecione os dois arquivos.
4. Confirme resultado válido.
5. Altere um byte/campo do JSON e repita: deve falhar.
6. Selecione outro PDF: deve falhar.
7. Crie um JSON com chave própria não registrada: deve falhar na consulta ao servidor.

### Conflitos

Tente enviar o mesmo número com conteúdo diferente. A API deve responder `409`, nunca `ok:true`.

## 5. Compatibilidade

Registros anteriores que tenham `pdf_hash`, `json_hash` ou prova do PDF nulos não passam pela validação oficial exata. Faça os testes de aceitação com uma nova PET emitida integralmente na v1.1.4.

## 6. Aviso

O Worker recebe PDF e JSON de forma transitória para recalcular hashes, mas não os grava no D1. Verifique no ambiente real o limite de tamanho e a qualidade das fotos em celulares utilizados pela equipe.
