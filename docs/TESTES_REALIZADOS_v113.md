# Testes realizados — v1.1.3

Foram executados testes automatizados locais do Worker com banco SQLite compatível com o schema D1:

- criação do primeiro administrador;
- login e sessão;
- cadastro de gestor, verificador, operacional e segundo administrador;
- obrigação de troca da senha temporária;
- troca da própria senha;
- bloqueio de gestor ao tentar criar/editar gestor ou admin;
- edição de operacional/verificador por gestor;
- edição de outro admin por admin;
- redefinição de senha e revogação das sessões antigas;
- cadastro idempotente do mesmo dispositivo;
- bloqueio de uma mesma chave vinculada a outro usuário;
- exclusão lógica de acesso com preservação do cadastro/histórico.

Também foram executadas verificações de sintaxe (`node --check`) no frontend e no Worker.
