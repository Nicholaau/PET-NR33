# Testes realizados na montagem da v1.1.5

Executados localmente:

- sintaxe individual e concatenada dos quatro módulos do frontend;
- carregamento dos quatro módulos em um mesmo contexto de scripts clássicos;
- sintaxe do Service Worker;
- sintaxe e igualdade das duas cópias do Worker;
- aplicação sequencial das migrations 0001, 0003 e 0004 em SQLite temporário;
- teste do UPSERT de tentativas de login até o bloqueio;
- conferência da coluna `participant_count` e tabela `auth_rate_limits`;
- busca por referências obsoletas a `app.js`, IPify e carregamento dinâmico de scripts;
- conferência de arquivos estáticos do Service Worker;
- conferência dos campos de gases com `aria-label` e cabeçalhos semânticos;
- teste da data local às 23h30 em `America/Sao_Paulo`;
- conferência dos scripts, SRI, CSP e `_headers`;
- conferência de que referências locais compactas não levam fotos/assinaturas;
- verificação da estrutura e integridade do ZIP.

Não executado neste ambiente:

- deploy na conta Cloudflare;
- teste ponta a ponta contra o D1 remoto;
- teste visual em todos os modelos de celular;
- auditoria independente de segurança;
- homologação de Segurança do Trabalho, jurídica ou de proteção de dados.
