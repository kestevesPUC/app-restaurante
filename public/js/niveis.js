// Níveis de acesso (espelha src/domain/niveis.js) e registro de rotas da interface.
export const NIVEIS = [
  { id: 'A', nome: 'Administrador', descricao: 'Acesso total: cardápio, configurações, usuários, auditoria e backup.' },
  { id: 'B', nome: 'Atendente', descricao: 'Lança pedidos, mesas e fila; consulta o cardápio. Sem a área de Gestão.' },
  { id: 'C', nome: 'Cozinha', descricao: 'Vê somente o Andon da cozinha (sem menu).' },
];
export const nivelNome = (id) => NIVEIS.find((n) => n.id === id)?.nome || id;

/**
 * Registro de rotas. Para criar uma tela: acrescente a entrada aqui e a função da tela em `main.js` (VIEWS).
 * `menu: false` = acessível pelo endereço (#/id) mas fora do menu; `grupo` = seção do menu ('' = sem seção).
 * Ainda por vir (tarefas seguintes): pedido-novo, pedidos, clientes, relatorios, bebidas, configuracoes.
 */
export const ROTAS = [
  { id: 'andon', rotulo: 'Cozinha', subtitulo: 'Pedidos em preparo', icone: 'chef', grupo: '', niveis: ['A', 'C'] },
  { id: 'cardapio', rotulo: 'Cardápio', subtitulo: 'Pratos e bebidas (consulta)', icone: 'book', grupo: '', niveis: ['A', 'B'] },
  { id: 'ingredientes', rotulo: 'Ingredientes', subtitulo: 'Ingredientes e preço de adicional', icone: 'leaf', grupo: 'Cadastros', niveis: ['A'] },
  { id: 'pratos', rotulo: 'Pratos', subtitulo: 'Cadastro de pratos, preços, fotos e ingredientes', icone: 'dish', grupo: 'Cadastros', niveis: ['A'] },
  { id: 'categorias', rotulo: 'Categorias', subtitulo: 'Seções do cardápio e destino da cozinha', icone: 'tag', grupo: 'Cadastros', niveis: ['A'] },
  { id: 'usuarios', rotulo: 'Usuários', subtitulo: 'Acesso ao sistema', icone: 'users', grupo: 'Gestão', niveis: ['A'] },
  { id: 'auditoria', rotulo: 'Auditoria', subtitulo: 'Quem fez o quê e quando', icone: 'shield', grupo: 'Gestão', niveis: ['A'] },
  { id: 'sobre', rotulo: 'Sobre', subtitulo: 'O sistema', icone: 'info', grupo: '', niveis: ['A', 'B'] },
];

/** Rotas que o nível pode abrir. */
export const rotasDoNivel = (nivel) => ROTAS.filter((r) => r.niveis.includes(nivel));
/** Itens do menu lateral do nível (o nível C não tem menu). */
export const menuPara = (nivel) => (nivel === 'C' ? [] : rotasDoNivel(nivel).filter((r) => r.menu !== false));
export const podeAcessar = (nivel, id) => rotasDoNivel(nivel).some((r) => r.id === id);
/** Tela inicial após o login: Andon para a cozinha; senão a primeira do menu (será "Novo pedido" quando existir). */
export const rotaInicial = (nivel) => (nivel === 'C' ? 'andon' : menuPara(nivel)[0]?.id || 'sobre');
