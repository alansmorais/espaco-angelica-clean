import {
  Service,
  Appointment,
  ClientProfile,
  PixPendingVerification,
  PixHistoryItem,
  TimeSlotConfig,
  DayScheduleConfig,
  BlacklistEntry,
  StudioAddressConfig
} from '../types';

export const BRAND_ASSETS = {
  logoGold: 'https://raw.githubusercontent.com/alansmorais/espacoangelica/refs/heads/main/images/angelica_logo.png',
  logoSmall: 'https://raw.githubusercontent.com/alansmorais/espacoangelica/refs/heads/main/images/angelica_logo_round_emblem.png',
  logoRoundEmblem: 'https://raw.githubusercontent.com/alansmorais/espacoangelica/refs/heads/main/images/angelica_logo_round_emblem.png',
  mapTexture: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCWy_TcZiS3uIGwD9bdGCtXWm2roeCEzMJj9yF1zF-ge-cgvlAn80asVXClBRNLm__GoYVJE_UaLAIdFwOaecu5EXOgsLxyg0hkQuXBWjNYTBTf6L8bdkDP1HTyYdFMMeSSpQQNN_KNx7E_CMnY8MceOS9itYgrBZ9ECAJXEcFQ_OfU-fKk2XatDmfqHlGU812jGFNHaLYu-9fztBT6EqBSJFs6Dp4Mhy8OpA3cL22AhyPBMeleYcBAiw'
};

export const SERVICES_CATALOG: Service[] = [
  {
    id: 'alongamento-fibra-slim',
    title: 'Alongamento em Fibra Slim',
    category: 'alongamento',
    price: 220,
    priceFormatted: 'R$ 220,00',
    duration: '2h 30min',
    badge: 'Mais Pedido',
    badgeType: 'primary',
    specs: ['2h 30min de sessão', 'Curvatura C Slim'],
    description: 'Construção fio a fio de alta precisão anatômica. Proporciona resistência e naturalidade com acabamento fino e leve.',
    note: 'Garantia estrutural de 7 dias',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBC8JBNJyvkEeAy0630S0fGsE55eTp7Li-0T1I7Q_mWO2hX3yrBKHrvENB5T2slvhZDLaop2Clci89x8r6JA82ckGK4NXkPqEYg30ejscHlXalZBF6c_hyjKpWtFBmf91Otv01YkUYL0khfoEJSiaZ-DV6LLSUzGSMunPe870yyOTjRXrYfq4iQw6WAbYueHIaow4qWFdlGno-QPivf8PnVAEcyQS_n8Ev1l41UDBuvAc05eiSZtBu5-A'
  },
  {
    id: 'manutencao-fibra-vidro',
    title: 'Manutenção Fibra de Vidro',
    category: 'alongamento',
    price: 140,
    priceFormatted: 'R$ 140,00',
    duration: '1h 45min',
    badge: 'Manutenção Periódica',
    badgeType: 'neutral',
    specs: ['1h 45min de sessão', 'Até 25 dias'],
    description: 'Reposição de gel, reforço do ponto de tensão, alinhamento do crescimento da lâmina e nova esmaltação completa.',
    note: 'Inclui cutilagem russa combinada',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBn8kGMStsjS25HdfnPlacUAwJfg-7JMC25rFkUmw7VctpnhUi4qomUfoaFl8onqsRQyJ2LnVDReRSxf1MtHzh5STVI3-1496wkjwQMZ6GR53IoUIiPOKdhoquACuaGt_yAbUDYLagDnmeLWz8UxftXOSe7QnUJDhkQLxQnszFfPrDdutYJG9mMmdNeCsEW6Gcrehw2jFeGI0qtXHNhGOaap2TLm44Km5q4ty2k2uk0uOmXfnaRpH1qeQ'
  },
  {
    id: 'blindagem-diamante',
    title: 'Blindagem Diamante & Banho Gel',
    category: 'blindagem',
    price: 130,
    priceFormatted: 'R$ 130,00',
    duration: '1h 15min',
    badge: 'Unhas Naturais',
    badgeType: 'secondary',
    specs: ['1h 15min de sessão', 'Escudo Protetor'],
    description: 'Tratamento de reforço para unhas naturais fracas ou que descamam. Cria uma camada protetora flexível sem necessidade de extensão.',
    note: 'Auxilia no crescimento natural',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBUpbOpsjoTUsrp5st19IUYwkAPVHbZ3v3gIsNPQiH_oLSLZSMwDdOSLn-nh9hx_XVKjEWuU2G-Abh8NNiX0Kw8yHqZsP05CdxAiYZvK5XhYq32BgH7UrFdHmR-KYDFzEIBl4L879N1JptVKtdGOQOAqHlr5HAEML5LRSnRSPoC2f5tegYF11-esE6Ywj23D2qGfzhxLMYfZy-8qJk684lk9TIybRpdICWVJ160FaQtNGiELvedGSXu5w'
  },
  {
    id: 'esmaltacao-gel-premium',
    title: 'Esmaltação em Gel Premium',
    category: 'blindagem',
    price: 95,
    priceFormatted: 'R$ 95,00',
    duration: '1h 00min',
    specs: ['1h 00min de sessão', 'Secagem em Cabine'],
    description: 'Pigmentação intensa com durabilidade de 20 a 25 dias sem lascar ou perder o brilho característico do procedimento.',
    note: 'Diversas tonalidades disponíveis',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBcxRhd-NbixCUy1Vd3a1qbH-RD3zbppoCev8-e37fzd0h3MuxHV7kPLN0JaHVoXDfovftivZEx90LhRwZW75FloPI_EsJeBAxpiP_utAjlCGOs7h7hSgWiXYY-ddjD-B6Hh9VAUfZe95PLXPKihEp2q8QivmR1XL1XfAhDZ8DXa4Nz3rShHnY-a6rYwUGwA8jDSGBOllZfVDPWtYaYasgPd7ywiRDGXfrgjSi4iGa5CQEPa7rpXnBfRQ'
  },
  {
    id: 'nail-art-encapsulada',
    title: 'Nail Art Autoral & Encapsulada',
    category: 'nailart',
    price: 30,
    priceFormatted: 'A partir de R$ 30,00',
    duration: '30min adic.',
    badge: 'Técnica Manual',
    badgeType: 'primary',
    specs: ['Feito à Mão Livre', 'Design Autoral'],
    description: 'Madrepérola, fios dourados, efeito mármore e encapsulamento autoral com selamento em topo de vidro.',
    note: 'Valor adicional ao serviço principal',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBjPMM6SjS-lv5IrJZG0-UwwGGusmBcgFO6EAwYI9457KVSKa_v661gditfZu_hFQmr-D0doyzhmQ482YY1EYegBwa2JcYq2M5R5xQkur7TdCGEnxPCcHZbW17XUX2PZ7d7choQ_8SS1GX1aBw1BzuS7c5_-VtemjhqEloAVbZwSGVfW3aRexFtosldMEz9elsVpFPMzwHL26Me_8n3AlKo627lFdSL9do3nnMlmmoFOqulDxYTVf9b3A'
  },
  {
    id: 'spa-das-maos-ouro',
    title: 'Spa das Mãos & Esfoliação',
    category: 'spa',
    price: 85,
    priceFormatted: 'R$ 85,00',
    duration: '45min',
    specs: ['45min de sessão', 'Cuidado & Hidratação'],
    description: 'Esfoliação com micropartículas nutritivas, hidratação profunda com óleos selecionados e massagem relaxante.',
    note: 'Hidratação profunda',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBdqSHAhESSp8iPoehwteJRjpF6ujcBISrW-P_KUaLPwdhG1Uhym-PQV_1h_fhmnC8UrMkD-sge-5aaBcjXUSVMzaWmXs3dEfbzlWN0aAIIy-POfwBnSMx8ZxtW7tfyp-gq02MzBfOS4G5sg9MLlkwG43yu-KgDP10_I-5z-OCtUTrgwbjA8ZcOnmOp6ZyEWRrIpDSJrRTqHjhmOj0XuMQM4httzX0pi_5osssKWPq4oc3qr2UnEjkjQQ'
  }
];

export const GALLERY_ITEMS = [
  {
    title: 'Baby Boomer',
    subtitle: 'Formato Almond Slim',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAfjJGXR9Givft8PVQD0vN8JsB-NtWZE4cYanw_vBeI5KFZm5qnGlHUmYp4jsDb9V1ehtHUefFv7I-CGXsEyoKhWbndVnWFzUq1rQjCYo9lwCW8Jx1VCO80joYzbbleQKSGCwEFipAyWWdrnoE3C-ELKD4Tz7ZkmpDp1EF7UaHh3u-6ZkGyYrep_-gWyJTfOb0HeWD3MZ4VgrGo6DSHkcGOQVSeuDSS3llTZr6toPlK1EoxueNur0f4tA'
  },
  {
    title: 'Francesa Reversa',
    subtitle: 'Encapsulada com Glitter',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCfuy0ubiG1fUW6a0ATZ3_vVMa3mXLwsPIFwcfHNgFTn7hUx2Hm7pk8_x4GUYFqQiG1vr0i9JagDaUfUpkx8gs5Is52GkAX4O-ipqZ6FFod7MlCqBa0iQuJjLzmNCDf48-U1uIAma29XZV-wGhgtjLJeweXv5s5NwcEcNrvhBK8lJwuOPCsxTiFi8O80JOWN81fe-0wdxD8N1R7Ng1p1p43p8TUoPXzp9qTAFja8V1IYInj-0-eck-eOA'
  },
  {
    title: 'Mármore & Foil',
    subtitle: 'Madrepérola Natural',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDYheJX3HjnzByXkYC8i2IrjJcaDUxfvel-VS_ziQj3LJpTRL4CjxDHvRlLj6c4OYqrGUptgxogzKE_P4s0W4z0AerJnjvQ9bGIgG4cSjVf_9IYqRz8obTWA8luKd0uQnbD0nb3z1ko9Txd8-PAlIBjomEtSYZgIY0LrjL66IJu0-jH0UT0G300OXlfyAnWMl0MKAVRy7SSukpfB4lPDLBiRliETBIfAACwy9fRQANFVKiZ80A-bMaxzg'
  },
  {
    title: 'Glazed Nails',
    subtitle: 'Blindagem Diamante',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuC5Z0QEAZFeGhTSUdj0b0_YfkCtjpnrIdZGNKIS3WB8jQmEcn70sU-lg3AFKh3zCoRnLOUShB2gQoKNtOJjNZe0OgEpUNC3ZPxjXsVIYzcjuNyVnrog6lNmbDY1H78S5mkJNzHgcty2dvhxlum3b1mSfDW7j8zdhFYu6EJZ4UyH4qYgxGV4OxjJw2V1Uq2uSVEN6NSq27N6f9XIjLFySDbzgRJBZCxFr0njfYedv9yQfrNyhdtFWIOpzg'
  }
];

// Fictional appointments, clients, and mock bank ledgers removed as per audit.
// Real appointments and clients are managed in application state/localStorage.
export const INITIAL_TODAY_APPOINTMENTS: Appointment[] = [];
export const INITIAL_CLIENTS: ClientProfile[] = [];
export const INITIAL_PENDING_PIX: PixPendingVerification[] = [];
export const INITIAL_PIX_HISTORY: PixHistoryItem[] = [];
export const INITIAL_BLACKLIST: BlacklistEntry[] = [];

export const STUDIO_ADDRESS: StudioAddressConfig = {
  street: 'Rua Vereador José Luiz Soares',
  number: '92',
  neighborhood: 'Pontal da Cruz',
  city: 'São Sebastião',
  state: 'SP',
  fullAddress: 'Rua Vereador José Luiz Soares, 92 - Pontal da Cruz, São Sebastião - SP',
  mapsUrl: 'https://maps.google.com/?q=Rua+Vereador+Jose+Luiz+Soares+92+Pontal+da+Cruz+Sao+Sebastiao+SP',
  wazeUrl: 'https://waze.com/ul?q=Rua+Vereador+Jose+Luiz+Soares+92+Pontal+da+Cruz+Sao+Sebastiao+SP'
};

export const INITIAL_TIME_SLOTS: TimeSlotConfig[] = [
  { id: 'slot-1', time: '09:00', status: 'disponivel', active: true },
  { id: 'slot-2', time: '10:30', status: 'disponivel', active: true },
  { id: 'slot-3', time: '11:30', status: 'disponivel', active: true },
  { id: 'slot-4', time: '13:00', status: 'bloqueado', note: 'Horário de Almoço & Descanso', active: true },
  { id: 'slot-5', time: '14:00', status: 'disponivel', active: true },
  { id: 'slot-6', time: '15:30', status: 'disponivel', active: true },
  { id: 'slot-7', time: '16:30', status: 'bloqueado', note: 'Ciclo de Autoclave & Biossegurança', active: true },
  { id: 'slot-8', time: '18:00', status: 'disponivel', active: true },
  { id: 'slot-9', time: '19:30', status: 'disponivel', active: true }
];

export const INITIAL_DAY_SCHEDULES: DayScheduleConfig[] = [
  { dayKey: 'ter', dayLabel: 'Terça-feira', isOpen: true, openTime: '09:00', closeTime: '19:30' },
  { dayKey: 'qua', dayLabel: 'Quarta-feira', isOpen: true, openTime: '09:00', closeTime: '19:30' },
  { dayKey: 'qui', dayLabel: 'Quinta-feira', isOpen: true, openTime: '09:00', closeTime: '19:30' },
  { dayKey: 'sex', dayLabel: 'Sexta-feira', isOpen: true, openTime: '09:00', closeTime: '20:00' },
  { dayKey: 'sab', dayLabel: 'Sábado', isOpen: true, openTime: '08:30', closeTime: '18:00' },
  { dayKey: 'dom', dayLabel: 'Domingo', isOpen: false, openTime: '00:00', closeTime: '00:00' },
  { dayKey: 'seg', dayLabel: 'Segunda-feira', isOpen: false, openTime: '00:00', closeTime: '00:00' }
];

export const SERVICE_PHOTO_PRESETS = [
  {
    title: 'Alongamento Fibra Slim',
    url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBC8JBNJyvkEeAy0630S0fGsE55eTp7Li-0T1I7Q_mWO2hX3yrBKHrvENB5T2slvhZDLaop2Clci89x8r6JA82ckGK4NXkPqEYg30ejscHlXalZBF6c_hyjKpWtFBmf91Otv01YkUYL0khfoEJSiaZ-DV6LLSUzGSMunPe870yyOTjRXrYfq4iQw6WAbYueHIaow4qWFdlGno-QPivf8PnVAEcyQS_n8Ev1l41UDBuvAc05eiSZtBu5-A'
  },
  {
    title: 'Manutenção Fibra de Vidro',
    url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBn8kGMStsjS25HdfnPlacUAwJfg-7JMC25rFkUmw7VctpnhUi4qomUfoaFl8onqsRQyJ2LnVDReRSxf1MtHzh5STVI3-1496wkjwQMZ6GR53IoUIiPOKdhoquACuaGt_yAbUDYLagDnmeLWz8UxftXOSe7QnUJDhkQLxQnszFfPrDdutYJG9mMmdNeCsEW6Gcrehw2jFeGI0qtXHNhGOaap2TLm44Km5q4ty2k2uk0uOmXfnaRpH1qeQ'
  },
  {
    title: 'Blindagem Diamante',
    url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBUpbOpsjoTUsrp5st19IUYwkAPVHbZ3v3gIsNPQiH_oLSLZSMwDdOSLn-nh9hx_XVKjEWuU2G-Abh8NNiX0Kw8yHqZsP05CdxAiYZvK5XhYq32BgH7UrFdHmR-KYDFzEIBl4L879N1JptVKtdGOQOAqHlr5HAEML5LRSnRSPoC2f5tegYF11-esE6Ywj23D2qGfzhxLMYfZy-8qJk684lk9TIybRpdICWVJ160FaQtNGiELvedGSXu5w'
  },
  {
    title: 'Esmaltação em Gel',
    url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBcxRhd-NbixCUy1Vd3a1qbH-RD3zbppoCev8-e37fzd0h3MuxHV7kPLN0JaHVoXDfovftivZEx90LhRwZW75FloPI_EsJeBAxpiP_utAjlCGOs7h7hSgWiXYY-ddjD-B6Hh9VAUfZe95PLXPKihEp2q8QivmR1XL1XfAhDZ8DXa4Nz3rShHnY-a6rYwUGwA8jDSGBOllZfVDPWtYaYasgPd7ywiRDGXfrgjSi4iGa5CQEPa7rpXnBfRQ'
  },
  {
    title: 'Nail Art Encapsulada',
    url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBjPMM6SjS-lv5IrJZG0-UwwGGusmBcgFO6EAwYI9457KVSKa_v661gditfZu_hFQmr-D0doyzhmQ482YY1EYegBwa2JcYq2M5R5xQkur7TdCGEnxPCcHZbW17XUX2PZ7d7choQ_8SS1GX1aBw1BzuS7c5_-VtemjhqEloAVbZwSGVfW3aRexFtosldMEz9elsVpFPMzwHL26Me_8n3AlKo627lFdSL9do3nnMlmmoFOqulDxYTVf9b3A'
  },
  {
    title: 'Spa das Mãos & Ritual',
    url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBdqSHAhESSp8iPoehwteJRjpF6ujcBISrW-P_KUaLPwdhG1Uhym-PQV_1h_fhmnC8UrMkD-sge-5aaBcjXUSVMzaWmXs3dEfbzlWN0aAIIy-POfwBnSMx8ZxtW7tfyp-gq02MzBfOS4G5sg9MLlkwG43yu-KgDP10_I-5z-OCtUTrgwbjA8ZcOnmOp6ZyEWRrIpDSJrRTqHjhmOj0XuMQM4httzX0pi_5osssKWPq4oc3qr2UnEjkjQQ'
  },
  {
    title: 'Baby Boomer Clássico',
    url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAfjJGXR9Givft8PVQD0vN8JsB-NtWZE4cYanw_vBeI5KFZm5qnGlHUmYp4jsDb9V1ehtHUefFv7I-CGXsEyoKhWbndVnWFzUq1rQjCYo9lwCW8Jx1VCO80joYzbbleQKSGCwEFipAyWWdrnoE3C-ELKD4Tz7ZkmpDp1EF7UaHh3u-6ZkGyYrep_-gWyJTfOb0HeWD3MZ4VgrGo6DSHkcGOQVSeuDSS3llTZr6toPlK1EoxueNur0f4tA'
  },
  {
    title: 'Francesa Reversa',
    url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCfuy0ubiG1fUW6a0ATZ3_vVMa3mXLwsPIFwcfHNgFTn7hUx2Hm7pk8_x4GUYFqQiG1vr0i9JagDaUfUpkx8gs5Is52GkAX4O-ipqZ6FFod7MlCqBa0iQuJjLzmNCDf48-U1uIAma29XZV-wGhgtjLJeweXv5s5NwcEcNrvhBK8lJwuOPCsxTiFi8O80JOWN81fe-0wdxD8N1R7Ng1p1p43p8TUoPXzp9qTAFja8V1IYInj-0-eck-eOA'
  }
];
