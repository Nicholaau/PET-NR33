# Testes realizados na montagem da v1.1.6

Foram executadas verificações locais de desenvolvimento. Elas não substituem homologação no Cloudflare e nos aparelhos reais.

- `node --check` em todos os arquivos JavaScript do frontend e Worker.
- Conferência de igualdade entre `worker/src/index.js` e a cópia avulsa do Worker.
- Busca por scripts/CDNs externos: nenhum script externo permanece no frontend.
- Conferência da CSP: `script-src 'self'`.
- Conferência da versão do Service Worker/cache `v1.1.6`.
- Conferência de referências antigas `v1.1.5` nos arquivos ativos; referências históricas permanecem apenas em migrations/docs antigos.
- Conferência dos 12 rótulos acessíveis da tabela de gases.
- Conferência da presença dos três controles S/N/N/A para todos os 22 itens do checklist.
- Conferência de que a finalização normaliza `pdfGenerationProofs` antes de inserir a prova.
- Conferência de que o reenvio pendente exige PDF + JSON + hashes existentes.
- Conferência de que o login bloqueia o botão enquanto a chamada está em andamento.
- Conferência de que o supervisor é derivado da relação de profissionais no payload final.
- Teste unitário do montador PDF com páginas JPEG sintéticas: cabeçalho PDF, xref, trailer e `%%EOF` presentes.
- Teste de integridade do ZIP final com `unzip -t`.

- Verificação do hotfix: `setDefaultDateTime()` está definida no `app-core.js` antes dos módulos que a chamam.
