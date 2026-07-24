# Alterações da v1.1.5

## Correções do relatório de testes

1. **Hierarquia de dispositivos:** gestor só lista e administra dispositivos de operacional/verificador.
2. **Força bruta:** limite por matrícula e IP, bloqueio temporário e auditoria de falhas.
3. **Equipe incompleta no banco:** registro, participantes e uso da chave são enviados em um `DB.batch`, com contagem posterior.
4. **Abuso de tamanho:** limites de corpo, PDF, JSON, fotos e quantidade de participantes no frontend e Worker.
5. **Cota do navegador:** histórico compacto de 30 itens, snapshot no IndexedDB, aviso explícito de falta de espaço e preservação do sucesso oficial quando somente a cópia local falhar.
6. **Data em UTC:** preenchimento inicial passou a usar a data civil local.
7. **Enter no login:** login e bootstrap são formulários com evento `submit`.
8. **Formulário longo:** seis etapas, progresso, navegação e atalho para erro.
9. **Acessibilidade:** rótulos dos campos de gases, cabeçalhos semânticos e mensagens dinâmicas anunciáveis.
10. **Dependências externas:** SRI, CSP, `_headers`, remoção do carregamento dinâmico e atualização do jsPDF para 4.2.1.
11. **Manutenção:** frontend dividido em quatro módulos comentados.
