# Alterações da v1.1.6

## Correções funcionais

- Corrigida tentativa de `.push()` quando `integrity.pdfGenerationProofs` não existia.
- Registro pendente só existe depois de PDF e JSON completos no IndexedDB.
- Tentativa incompleta deixa de oferecer reenvio impossível e preserva o formulário.

## Checklist

- S, N e N/A são respostas válidas para preenchimento.
- Todos os itens continuam obrigatórios.
- N/A exige justificativa.
- Respostas inseguras são registradas, mas podem impedir emissão oficial.
- No celular, checklist usa cartões responsivos sincronizados com o mesmo payload do desktop.

## Fluxo do formulário

- Validação ao avançar cada etapa.
- Barra de progresso compacta.
- Foco/rolagem para o primeiro erro.
- Supervisor obtido automaticamente do participante da equipe.
- Ações finais simplificadas.
- Aba ativa destacada.

## Login

- Primeiro administrador recolhido em “Configuração inicial do sistema”.
- Botão de login bloqueado durante requisição para impedir cliques repetidos.

## Documentos

- “Comprovante técnico” passa a “Arquivo de validação da PET (JSON)”.
- Removidas dependências externas `jsPDF` e `html2canvas`.
- PDF criado por Canvas 2D + gerador PDF local.
- CSP alterada para `script-src 'self'`.

## Banco de dados

Não há nova migration para quem já está na v1.1.5.


## Hotfix 1 — data/hora após login

- Restaurada `setDefaultDateTime()` no núcleo compartilhado.
- A função usa `todayISO()` e `nowTime()` e, portanto, mantém a data/hora local do dispositivo.
- Corrigido o erro `setDefaultDateTime is not defined` observado após login.
- Cache estático alterado para `pet-digital-static-v1.1.6-hotfix1` para impedir reutilização do JavaScript quebrado.
