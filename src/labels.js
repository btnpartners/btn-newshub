// NewsHub label set (same labels as the original btn-news app, plus additions).
// Groups are only for the filter menu. Hints help Claude with abbreviations.

export const LABEL_GROUPS = {
  'Produtos e mercados': [
    'Adquirentes', 'Agronegócios', 'Asset Management', 'Assessores Investimento', 'BaaS', 'Bancos', 'BNPL',
    'Cartão Benefício', 'Cartão Crédito', 'Consignado', 'Consórcio', 'Consultores Investimento', 'Contabilidade',
    'Cooperativa', 'Corretoras', 'Crédito', 'Crédito Agrícola', 'Crédito Imobiliário', 'Crédito Pessoal',
    'Crédito Privado', 'Crypto', 'Delivery', 'DREX', 'Duplicata', 'eCommerce', 'Embedded Finance', 'ERP', 'FIDC',
    'Financeira', 'Fintechs', 'Fundos Imobiliários', 'FX', 'Gestoras', 'Inadimplência', 'Insurtech', 'IPO', 'M&A',
    'Marketplace', 'Mercado de Capitais', 'Open Finance', 'Open Insurance', 'Pagamentos', 'PAT', 'PIX', 'Previdência',
    'Private Equity', 'Seguros', 'Stablecoin', 'Venture Capital', 'VGBL', 'Wealth Management',
  ],
  'Licenças': ['CCTVM', 'DTVM', 'IP', 'ITP', 'PSAV', 'SCD', 'SCFI', 'VASP'],
  'Reguladores': ['Banco Central', 'CMN', 'CVM', 'Susep', 'Regulação'],
  'Associações': [
    'ABAC', 'ABBAAS', 'ABBC', 'ABCD', 'ABcripto', 'ABECIP', 'ABECS', 'ABfintechs', 'ABIPAG', 'Abranet', 'ABRAC',
    'ABRACAM', 'ABRAPP', 'ABRASCA', 'ABtoken', 'ABVCAP', 'ACREFI', 'Anbima', 'Ancord', 'ANFIDC', 'CNseg', 'Febraban',
    'Fenacap', 'FENACOR', 'Fenaprev', 'Fenasaude', 'Fenaseg', 'Zetta',
  ],
};

export const ALL_LABELS = Object.values(LABEL_GROUPS).flat();

// Bump when labels or labeling rules change: stored articles are relabeled automatically.
export const LABELS_VERSION = '2026-11-18d';

export const HINTS = {
  'IP': 'instituição de pagamento (licença do BC)',
  'ITP': 'iniciador de transação de pagamento (Open Finance)',
  'PSAV': 'prestadora de serviços de ativos virtuais',
  'VASP': 'virtual asset service provider',
  'SCD': 'sociedade de crédito direto',
  'SCFI': 'sociedade de crédito, financiamento e investimento (financeira)',
  'CCTVM': 'corretora de câmbio, títulos e valores mobiliários',
  'DTVM': 'distribuidora de títulos e valores mobiliários',
  'PAT': 'Programa de Alimentação do Trabalhador / vale-refeição',
  'DREX': 'real digital do Banco Central',
  'VGBL': 'plano de previdência VGBL',
  'BaaS': 'banking as a service',
  'FX': 'câmbio / moedas',
  'Adquirentes': 'credenciadoras de cartões / maquininhas',
  'CNseg': 'Confederação Nacional das Seguradoras',
  'CMN': 'Conselho Monetário Nacional',
  'Regulação': 'normas e regulação do setor financeiro',
  'Agronegócios': 'agronegócio brasileiro como assunto principal: produtores, safras, tradings, insumos, CPR, CRA, Fiagro; não para comércio exterior, macroeconomia ou outros países em geral',
  'Crédito Agrícola': 'crédito rural / financiamento ao produtor (Plano Safra, CPR, CRA, Fiagro)',
};

// Associations and regulators are tagged automatically whenever their name appears in the title or excerpt
// (Claude sometimes skips them when the story is also about PIX, payments etc.).
export const ASSOCIATION_ALIASES = {
  ABfintechs: ['Associação Brasileira de Fintechs'],
  ABcripto: ['Associação Brasileira de Criptoeconomia'],
  ABECS: ['Associação Brasileira das Empresas de Cartões de Crédito e Serviços'],
  ABIPAG: ['Associação Brasileira de Instituições de Pagamentos'],
  Febraban: ['Federação Brasileira de Bancos'],
  ABVCAP: ['Associação Brasileira de Private Equity e Venture Capital'],
  Anbima: ['Associação Brasileira das Entidades dos Mercados Financeiro e de Capitais'],
  CNseg: ['Confederação Nacional das Seguradoras'],
  // Regulators (also tagged automatically). "Banco Central" alone is left to Claude: it is often a foreign central bank.
  CMN: ['Conselho Monetário Nacional'],
  CVM: ['Comissão de Valores Mobiliários'],
  Susep: ['Superintendência de Seguros Privados'],
  'Banco Central': ['Banco Central do Brasil', 'BCB'],
};

const strip = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const escape = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// ABCD is also the São Paulo ABCD region, so it is left to Claude.
const AUTO_LABELS = [...LABEL_GROUPS['Associações'].filter((l) => l !== 'ABCD'), 'CMN', 'CVM', 'Susep', 'Banco Central'];
const ASSOC_PATTERNS = AUTO_LABELS.map((label) => ({
  label,
  re: new RegExp(`(^|[^a-z0-9])(${[...(label === 'Banco Central' ? [] : [label]), ...(ASSOCIATION_ALIASES[label] || [])].map((n) => escape(strip(n))).join('|')})([^a-z0-9]|$)`),
}));

export function associationsIn(text) {
  const t = strip(text || '');
  return ASSOC_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.label);
}
