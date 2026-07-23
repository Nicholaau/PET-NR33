# Alterações da v1.1.4

## Problemas corrigidos

### Comprovante independente/falso aceito

Antes, o resultado local podia declarar integridade e assinatura válidas usando apenas a chave que vinha no próprio JSON. Agora a validação oficial exige PDF + JSON e correspondência exata no Worker/D1 com usuário e dispositivo autorizados.

### Vazamento por cache offline

O Service Worker anterior podia armazenar qualquer GET. A v1.1.4 usa lista fechada de arquivos estáticos, bloqueia cache de Authorization e de outras origens, apaga caches legados e aplica a atualização imediatamente.

### PET insegura aceita

Foram adicionadas regras equivalentes no frontend e no Worker para gases, checklist, N/A, detector, participantes, duplicidade de matrícula, supervisor e integridade de foto/assinatura.

### Dados locais visíveis entre contas

Rascunhos, histórico, arquivos e chave criptográfica local usam escopo por `userId`. Logout e troca de conta limpam a memória e carregam apenas o espaço do usuário atual. Uma chave global antiga só é migrada quando o D1 confirma que pertence à conta atual.

### PDF não vinculado ao servidor

A geração dos arquivos ocorre antes do registro. O Worker recebe os arquivos apenas durante a requisição, recalcula os hashes reais e grava no D1 somente os hashes e metadados.

### Finalização duplicada

Foi adicionada chave de idempotência, bloqueio de interface, reaproveitamento da mesma tentativa em caso de falha/reenvio e tratamento de corrida entre requisições simultâneas.

### Conflito tratado como sucesso

Somente correspondência integral retorna repetição válida. Número, hash ou arquivos divergentes retornam HTTP 409.

### Compatibilidade de registros antigos

Registros criados antes da v1.1.4 que não possuam hashes reais de PDF/JSON e prova vinculada permanecem no histórico, mas não são declarados válidos pelo novo validador oficial.
