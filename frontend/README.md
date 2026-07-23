# Frontend - PET-Digital NR-33 v1.1.4

Publique **todo o conteúdo desta pasta** no projeto Cloudflare Pages `pet-digital`.

## Fluxo oficial

1. Login.
2. Dispositivo autorizado.
3. Preenchimento e validação.
4. Geração local do PDF e do comprovante.
5. Cálculo dos hashes reais dos arquivos.
6. Registro atômico no Worker/D1.
7. Compartilhamento manual dos dois arquivos com o supervisor.

## Segurança local

- rascunhos, registros, arquivos oficiais e chave criptográfica local são separados por usuário;
- arquivos oficiais ficam no IndexedDB com chave composta por usuário e registro;
- logout limpa o estado em memória;
- o Service Worker armazena somente HTML, CSS, JavaScript, manifesto e logo;
- chamadas de API e respostas autenticadas nunca entram no cache offline.

## Validação

A aba Validar exige PDF + JSON e consulta o Worker. Uma conferência apenas local não é apresentada como validação oficial.

## Compatibilidade

Registros antigos com hashes de PDF/JSON ausentes não podem ser confirmados pela validação oficial exata da v1.1.4. O novo fluxo é aplicado às emissões realizadas após a atualização do Worker, D1 e Pages.
