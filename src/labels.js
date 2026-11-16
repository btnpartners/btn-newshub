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
  'Reguladores': ['Banco Central', 'CVM', 'Susep', 'Regulação'],
  'Associações': [
    'ABAC', 'ABBAAS', 'ABBC', 'ABCD', 'ABcripto', 'ABECIP', 'ABECS', 'ABfintechs', 'ABIPAG', 'Abranet', 'ABRAC',
    'ABRACAM', 'ABRAPP', 'ABRASCA', 'ABtoken', 'ABVCAP', 'ACREFI', 'Anbima', 'Ancord', 'ANFIDC', 'CNseg', 'Febraban',
    'Fenacap', 'FENACOR', 'Fenaprev', 'Fenasaude', 'Fenaseg', 'Zetta',
  ],
  'Temas gerais': ['Educação', 'Energia', 'Infraestrutura', 'Saúde'],
};

export const ALL_LABELS = Object.values(LABEL_GROUPS).flat();

// Bump when labels or labeling rules change: stored articles are relabeled automatically.
export const LABELS_VERSION = '2026-11-16d';

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
  'Regulação': 'normas e regulação do setor financeiro',
};
