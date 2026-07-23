# Testes realizados na montagem da v1.1.4

Executados localmente no pacote:

- verificação de sintaxe de `frontend/app.js`;
- verificação de sintaxe de `frontend/sw.js`;
- verificação de sintaxe das duas cópias do Worker;
- comparação para garantir que `worker/src/index.js` e o arquivo avulso são idênticos;
- conferência de IDs HTML referenciados diretamente pelo JavaScript;
- aplicação das migrations em banco SQLite temporário;
- simulação do Worker com D1 em memória para:
  - registrar uma PET válida;
  - repetir a mesma requisição com a mesma idempotência;
  - validar PDF + JSON com a chave pública armazenada;
  - recusar JSON alterado;
  - recusar PET com medição negativa;
- simulação da política do Service Worker para confirmar:
  - remoção do cache legado;
  - ausência de interceptação de API/requisição autenticada;
  - cache somente da lista fechada de arquivos estáticos;
- teste de integridade do arquivo ZIP final;
- busca por referências residuais da versão anterior.

Não executado neste ambiente:

- deploy real na conta Cloudflare;
- teste ponta a ponta com Worker/D1 remoto;
- teste visual completo em todos os navegadores/celulares da equipe;
- homologação jurídica, de Segurança do Trabalho ou de LGPD.
