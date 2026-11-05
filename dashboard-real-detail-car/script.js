/* ==========================================================
   RDC REAL DETAIL CAR — PAINEL DE GESTÃO
   JavaScript puro, sem dependências. Dados em localStorage.

   Índice
     1.  Configuração
     2.  Utilitários (DOM, texto, ids)
     3.  Datas locais
     4.  Dinheiro e telefone
     5.  Armazenamento (localStorage)
     6.  Modelo de dados e estado
     7.  Regras de reativação (alertas)
     8.  Operações de dados (criar, editar, excluir)
     9.  Cálculos financeiros
     10. Interface: avisos e modal
     11. Navegação
     12. Visão geral
     13. Formulário de serviço
     14. Histórico
     15. Clientes para reativar
     16. Relatórios
     17. Configurações, backup e CSV
     18. Eventos globais e inicialização
   ========================================================== */
'use strict';

/* ==========================================================
   1. CONFIGURAÇÃO
   ========================================================== */
const CONFIG = Object.freeze({
  REACTIVATION_DAYS: 15,
  STORAGE_KEYS: Object.freeze({
    services: 'rdc-dashboard:services',
    prefs: 'rdc-dashboard:prefs',
  }),
  BACKUP_APP: 'rdc-dashboard',
  SCHEMA_VERSION: 1,
  HISTORY_PAGE_SIZE: 50,
  MAX_VALUE_CENTS: 100000000, // R$ 1.000.000,00
  BACKUP_REMINDER_DAYS: 7,
  ZOOM_LEVELS: Object.freeze([0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]),
});

const DEFAULT_MESSAGE =
  'Olá, {nome}! Tudo bem? Aqui é da Real Detail Car. Estamos passando para saber como está o seu {veiculo} ' +
  'e lembrar que estamos à disposição para cuidar dele novamente. Será um prazer receber você! ' +
  'Gostaria de agendar um novo serviço?';

const ROUTES = Object.freeze({
  'visao-geral':   { title: 'Visão geral', index: '01' },
  'registrar':     { title: 'Registrar serviço', index: '02' },
  'historico':     { title: 'Histórico de serviços', index: '03' },
  'reativar':      { title: 'Clientes para reativar', index: '04' },
  'relatorios':    { title: 'Relatórios', index: '05' },
  'configuracoes': { title: 'Configurações e backup', index: '06' },
});
const DEFAULT_ROUTE = 'visao-geral';

const ALERT_LABELS = Object.freeze({
  waiting: 'Aguardando prazo',
  pending: 'Retorno pendente',
  done: 'Contato realizado',
});

const DEFAULT_PREFS = Object.freeze({
  overviewPeriod: 'month',
  history: { query: '', scope: 'all', period: 'all', from: '', to: '', sort: 'date-desc' },
  reactivationTab: 'pending',
  report: { period: 'current-month', month: '', from: '', to: '' },
  messageTemplate: DEFAULT_MESSAGE,
  whatsappMode: 'web',
  zoom: 1,
  lastBackupAt: null,
});

/* ==========================================================
   2. UTILITÁRIOS
   ========================================================== */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Escapa texto do usuário antes de inseri-lo em HTML. */
function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (ch) => map[ch]);
}

/** Texto de uma linha: remove espaços duplicados e limita o tamanho. */
function cleanText(value, max = 200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Texto de várias linhas: preserva quebras, remove espaços excedentes. */
function cleanMultiline(value, max = 600) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/** Normaliza texto para busca: minúsculas e sem acentos. */
function normalizeSearch(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Identificador único para cada serviço. */
function generateId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  return 'srv-' + Date.now().toString(36) + '-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function isValidIso(value) {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function icon(name, extraClass = '') {
  return `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function initials(name) {
  const parts = cleanText(name).split(' ').filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function firstName(name) {
  return cleanText(name).split(' ')[0] || '';
}

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/* ==========================================================
   3. DATAS LOCAIS
   Todas as datas de serviço são guardadas como "AAAA-MM-DD" e
   interpretadas no fuso local, evitando o deslocamento de UTC
   que acontece com new Date("AAAA-MM-DD").
   ========================================================== */
const DateUtil = {
  pad(n) {
    return String(n).padStart(2, '0');
  },

  /** Date local → "AAAA-MM-DD". */
  toKey(date) {
    return `${date.getFullYear()}-${this.pad(date.getMonth() + 1)}-${this.pad(date.getDate())}`;
  },

  /** "AAAA-MM-DD" → Date local à meia-noite, ou null se inválida. */
  parse(key) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
    if (!match) return null;
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(y, m - 1, d);
    // Rejeita datas como 31/02 que o Date "corrigiria" silenciosamente
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return date;
  },

  isValidKey(key) {
    return this.parse(key) !== null;
  },

  todayKey() {
    return this.toKey(new Date());
  },

  addDays(key, days) {
    const d = this.parse(key);
    return this.toKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
  },

  /** Diferença em dias corridos (to - from). Math.round absorve o horário de verão. */
  diffDays(fromKey, toKey) {
    return Math.round((this.parse(toKey) - this.parse(fromKey)) / 86400000);
  },

  /** Semana de segunda a domingo. */
  startOfWeek(key) {
    const d = this.parse(key);
    const offset = (d.getDay() + 6) % 7; // segunda = 0
    return this.addDays(key, -offset);
  },
  endOfWeek(key) {
    return this.addDays(this.startOfWeek(key), 6);
  },

  startOfMonth(key) {
    return key.slice(0, 8) + '01';
  },
  endOfMonth(key) {
    const d = this.parse(key);
    return this.toKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  },

  /** "AAAA-MM-DD" → "DD/MM/AAAA". */
  format(key) {
    if (!this.isValidKey(key)) return '—';
    const [y, m, d] = key.split('-');
    return `${d}/${m}/${y}`;
  },

  /** "AAAA-MM-DD" → "DD/MM". */
  formatShort(key) {
    if (!this.isValidKey(key)) return '—';
    const [, m, d] = key.split('-');
    return `${d}/${m}`;
  },

  /** ISO com horário → "DD/MM/AAAA às HH:MM" no fuso local. */
  formatDateTime(iso) {
    if (!isValidIso(iso)) return '—';
    const date = new Date(iso);
    return `${this.format(this.toKey(date))} às ${this.pad(date.getHours())}:${this.pad(date.getMinutes())}`;
  },

  /** "Quarta-feira, 28 de outubro de 2026". */
  formatLong(key) {
    const text = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(this.parse(key));
    return text.charAt(0).toUpperCase() + text.slice(1);
  },

  monthLabel(year, monthIndex, style = 'short') {
    const label = new Intl.DateTimeFormat('pt-BR', { month: style }).format(new Date(year, monthIndex, 1));
    return label.replace('.', '');
  },
};

/* ==========================================================
   4. DINHEIRO E TELEFONE
   Valores são guardados em centavos (inteiros) para evitar
   erros de arredondamento de ponto flutuante.
   ========================================================== */
const Money = {
  currency: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }),
  plain: new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),

  format(cents) {
    return this.currency.format((Number(cents) || 0) / 100);
  },

  /** Valor para CSV / campo de formulário: "1.234,56". */
  toInput(cents) {
    return this.plain.format((Number(cents) || 0) / 100);
  },

  /** Número para CSV, sem separador de milhar: "1234,56". */
  toCsv(cents) {
    return ((Number(cents) || 0) / 100).toFixed(2).replace('.', ',');
  },

  /**
   * Converte texto digitado em centavos. Aceita "1.234,56", "1234,56",
   * "1234.56", "R$ 80". Retorna null quando o valor não é válido.
   */
  parse(input) {
    let text = String(input ?? '').replace(/R\$/gi, '').replace(/\s/g, '');
    if (!text) return null;
    if (text.includes(',')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
      text = text.replace(/\./g, ''); // "1.500" = mil e quinhentos
    }
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
    const cents = Math.round(Number(text) * 100);
    return Number.isFinite(cents) ? cents : null;
  },
};

const Phone = {
  digits(value) {
    return String(value ?? '').replace(/\D/g, '').slice(0, 13);
  },

  /** Telefone brasileiro: DDD + 8 ou 9 dígitos. */
  isValid(digits) {
    return /^[1-9]{2}9?\d{8}$/.test(digits);
  },

  format(digits) {
    const d = this.digits(digits);
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    if (d.length > 11 && d.startsWith('55')) return '+55 ' + this.format(d.slice(2));
    return d || '—';
  },

  /** Máscara progressiva enquanto o usuário digita. */
  mask(value) {
    const d = this.digits(value).slice(0, 11);
    if (d.length === 0) return '';
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  },
};

/* ==========================================================
   5. ARMAZENAMENTO (localStorage)
   Funções reutilizáveis que nunca lançam exceção para a interface.
   ========================================================== */
const Storage = {
  /** Lê e interpreta JSON. ok=false indica conteúdo corrompido. */
  read(key) {
    let raw = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch (error) {
      return { ok: false, value: null, raw: null, unavailable: true };
    }
    if (raw === null) return { ok: true, value: null, raw };
    try {
      return { ok: true, value: JSON.parse(raw), raw };
    } catch (error) {
      return { ok: false, value: null, raw };
    }
  },

  /** Grava JSON. Retorna false se o navegador recusar (cota cheia, modo privado...). */
  write(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('[RDC] Falha ao salvar no localStorage:', error);
      return false;
    }
  },

  /** Guarda uma cópia do conteúdo corrompido para não perdê-lo de vez. */
  quarantine(key, raw) {
    if (!raw) return;
    try {
      window.localStorage.setItem(`${key}:corrompido:${Date.now()}`, raw);
    } catch (error) {
      console.error('[RDC] Não foi possível guardar cópia dos dados corrompidos:', error);
    }
  },

  /** Tamanho aproximado ocupado pelas chaves do painel, em bytes. */
  usage() {
    let total = 0;
    try {
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith('rdc-dashboard:')) {
          total += (key.length + (window.localStorage.getItem(key) || '').length) * 2;
        }
      }
    } catch (error) { /* armazenamento indisponível */ }
    return total;
  },
};

/* ==========================================================
   6. MODELO DE DADOS E ESTADO
   Cada serviço carrega os dados do cliente e o estado do seu
   próprio alerta. A data de reativação é sempre derivada da data
   do serviço, por isso editar a data recalcula o prazo.
   ========================================================== */
const state = {
  services: [],
  prefs: structuredClone(DEFAULT_PREFS),
  todayKey: DateUtil.todayKey(),
  route: null,
  editingId: null,
  historyLimit: CONFIG.HISTORY_PAGE_SIZE,
};

/** Valida e normaliza um registro vindo do armazenamento ou de um backup. */
function normalizeService(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const date = String(raw.date ?? '');
  const clientName = cleanText(raw.clientName, 120);
  const valueCents = Number(raw.valueCents);
  if (!DateUtil.isValidKey(date) || !clientName) return null;
  if (!Number.isInteger(valueCents) || valueCents <= 0 || valueCents > CONFIG.MAX_VALUE_CENTS) return null;

  const alert = raw.alert && typeof raw.alert === 'object' ? raw.alert : {};
  const contacted = alert.contacted === true;
  const now = new Date().toISOString();

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 80) : generateId(),
    clientName,
    phone: Phone.digits(raw.phone),
    vehicle: cleanText(raw.vehicle, 80),
    date,
    description: cleanMultiline(raw.description, 600),
    valueCents,
    alert: {
      contacted,
      contactedAt: contacted && isValidIso(alert.contactedAt) ? alert.contactedAt : (contacted ? now : null),
    },
    createdAt: isValidIso(raw.createdAt) ? raw.createdAt : now,
    updatedAt: isValidIso(raw.updatedAt) ? raw.updatedAt : now,
  };
}

/** Normaliza uma lista, descartando inválidos e corrigindo ids repetidos. */
function normalizeServiceList(list) {
  const services = [];
  const seen = new Set();
  let dropped = 0;
  for (const raw of Array.isArray(list) ? list : []) {
    const service = normalizeService(raw);
    if (!service) { dropped += 1; continue; }
    while (seen.has(service.id)) service.id = generateId();
    seen.add(service.id);
    services.push(service);
  }
  return { services, dropped };
}

/** Carrega os serviços. Dados corrompidos são preservados em quarentena. */
function loadServices() {
  const key = CONFIG.STORAGE_KEYS.services;
  const result = Storage.read(key);

  if (result.unavailable) {
    return { services: [], warning: 'O armazenamento local está bloqueado neste navegador. Os dados não serão salvos.' };
  }
  if (!result.ok) {
    Storage.quarantine(key, result.raw);
    return { services: [], warning: 'Os dados salvos estavam corrompidos e foram isolados. Importe um backup para recuperá-los.' };
  }
  if (result.value === null) return { services: [] };

  const list = Array.isArray(result.value) ? result.value : result.value.services;
  if (!Array.isArray(list)) {
    Storage.quarantine(key, result.raw);
    return { services: [], warning: 'Formato de dados desconhecido. Uma cópia foi guardada e o painel começou vazio.' };
  }

  const { services, dropped } = normalizeServiceList(list);
  if (dropped > 0) {
    Storage.quarantine(key, result.raw);
    return { services, warning: `${plural(dropped, 'registro inválido foi ignorado', 'registros inválidos foram ignorados')}. Uma cópia do original foi guardada.` };
  }
  return { services };
}

/** Persiste a lista inteira de serviços. */
function persistServices(services) {
  return Storage.write(CONFIG.STORAGE_KEYS.services, {
    version: CONFIG.SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    services,
  });
}

/** Mescla preferências salvas com os padrões, validando cada campo. */
function loadPrefs() {
  const result = Storage.read(CONFIG.STORAGE_KEYS.prefs);
  const prefs = structuredClone(DEFAULT_PREFS);
  const saved = result.ok && result.value && typeof result.value === 'object' ? result.value : {};

  if (['day', 'week', 'month'].includes(saved.overviewPeriod)) prefs.overviewPeriod = saved.overviewPeriod;
  if (['pending', 'waiting', 'done'].includes(saved.reactivationTab)) prefs.reactivationTab = saved.reactivationTab;
  if (typeof saved.messageTemplate === 'string' && saved.messageTemplate.trim()) prefs.messageTemplate = saved.messageTemplate.slice(0, 1000);
  if (isValidIso(saved.lastBackupAt)) prefs.lastBackupAt = saved.lastBackupAt;
  if (['web', 'app'].includes(saved.whatsappMode)) prefs.whatsappMode = saved.whatsappMode;
  if (CONFIG.ZOOM_LEVELS.includes(saved.zoom)) prefs.zoom = saved.zoom;

  const h = saved.history || {};
  prefs.history = {
    query: typeof h.query === 'string' ? h.query.slice(0, 100) : '',
    scope: ['all', 'name', 'phone', 'vehicle'].includes(h.scope) ? h.scope : 'all',
    period: ['all', 'day', 'week', 'month', 'custom'].includes(h.period) ? h.period : 'all',
    from: DateUtil.isValidKey(h.from) ? h.from : '',
    to: DateUtil.isValidKey(h.to) ? h.to : '',
    sort: ['date-desc', 'date-asc', 'value-desc', 'value-asc'].includes(h.sort) ? h.sort : 'date-desc',
  };

  const r = saved.report || {};
  prefs.report = {
    period: ['current-month', 'previous-month', 'month', 'year', 'custom', 'all'].includes(r.period) ? r.period : 'current-month',
    month: /^\d{4}-\d{2}$/.test(r.month) ? r.month : '',
    from: DateUtil.isValidKey(r.from) ? r.from : '',
    to: DateUtil.isValidKey(r.to) ? r.to : '',
  };
  return prefs;
}

function savePrefs() {
  Storage.write(CONFIG.STORAGE_KEYS.prefs, state.prefs);
}

function findService(id) {
  return state.services.find((s) => s.id === id) || null;
}

/* ==========================================================
   7. REGRAS DE REATIVAÇÃO
   O dia do atendimento é o dia 0. O alerta fica elegível a partir
   do início do 15º dia após o serviço (data + 15 dias corridos).
   ========================================================== */
function getReactivationDate(service) {
  return DateUtil.addDays(service.date, CONFIG.REACTIVATION_DAYS);
}

/** Situação do alerta: waiting | pending | done. */
function getAlertStatus(service, todayKey = state.todayKey) {
  if (service.alert.contacted) return 'done';
  return todayKey >= getReactivationDate(service) ? 'pending' : 'waiting';
}

function getAlertInfo(service, todayKey = state.todayKey) {
  const reactivationDate = getReactivationDate(service);
  return {
    status: getAlertStatus(service, todayKey),
    reactivationDate,
    daysSince: DateUtil.diffDays(service.date, todayKey),
    daysUntil: DateUtil.diffDays(todayKey, reactivationDate),
  };
}

function getPendingServices() {
  return state.services.filter((s) => getAlertStatus(s) === 'pending');
}

/** Chave que identifica o cliente: telefone, ou nome quando não houver telefone. */
function clientKey(service) {
  return service.phone || 'nome:' + normalizeSearch(service.clientName);
}

/** Retorna o serviço mais recente do mesmo cliente posterior a este, se houver. */
function findLaterVisit(service) {
  const key = clientKey(service);
  let later = null;
  for (const other of state.services) {
    if (other.id === service.id || clientKey(other) !== key || other.date <= service.date) continue;
    if (!later || other.date > later.date) later = other;
  }
  return later;
}

/** Monta a mensagem de reativação com os dados reais do cadastro. */
function buildMessage(service, template = state.prefs.messageTemplate) {
  const values = {
    nome: firstName(service.clientName),
    nome_completo: service.clientName,
    veiculo: service.vehicle || 'veículo',
    servico: service.description.replace(/\s*\n\s*/g, ' '),
    data: DateUtil.format(service.date),
  };
  return String(template || DEFAULT_MESSAGE).replace(/\{(nome_completo|nome|veiculo|servico|data)\}/g, (_, key) => values[key]);
}

/** No celular o link wa.me abre direto o aplicativo. */
function isMobileDevice() {
  return window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(max-width: 1024px)').matches;
}

/**
 * Como o WhatsApp será aberto:
 *  - "web":    WhatsApp Web sempre na mesma aba (nome fixo de janela)
 *  - "app":    aplicativo instalado no computador (protocolo whatsapp://)
 *  - "mobile": celular/tablet, link wa.me que abre o aplicativo
 */
function getWhatsappMode() {
  return isMobileDevice() ? 'mobile' : state.prefs.whatsappMode;
}

/** Nome da aba reutilizada pelo WhatsApp Web. */
const WHATSAPP_WINDOW = 'rdc-whatsapp';

/**
 * Link do WhatsApp com a mensagem já preenchida. Só abre a conversa:
 * o envio continua sendo feito manualmente pelo usuário.
 * Retorna null se o telefone não tiver DDD + número.
 */
function whatsappUrl(service, mode = getWhatsappMode()) {
  const digits = service.phone;
  let number = null;
  if (digits.length === 10 || digits.length === 11) number = '55' + digits;
  else if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) number = digits;
  if (!number) return null;
  const text = encodeURIComponent(buildMessage(service));
  if (mode === 'app') return `whatsapp://send?phone=${number}&text=${text}`;
  if (mode === 'web') return `https://web.whatsapp.com/send?phone=${number}&text=${text}`;
  return `https://wa.me/${number}?text=${text}`;
}

/** Atributos do link: a aba nomeada faz o WhatsApp Web reaproveitar sempre a mesma aba. */
function whatsappLinkTarget(mode = getWhatsappMode()) {
  if (mode === 'web') return `target="${WHATSAPP_WINDOW}"`;
  if (mode === 'app') return '';
  return 'target="_blank" rel="noopener noreferrer"';
}

/* ==========================================================
   8. OPERAÇÕES DE DADOS
   Toda alteração passa por commitServices: grava primeiro e só
   então atualiza a memória e a interface. Se a gravação falhar,
   nada muda e o usuário é avisado.
   ========================================================== */
function commitServices(nextServices) {
  if (!persistServices(nextServices)) {
    toast('Não foi possível salvar. O armazenamento do navegador pode estar cheio ou bloqueado.', 'error', 6000);
    return false;
  }
  state.services = nextServices;
  renderAll();
  return true;
}

function createService(data) {
  const now = new Date().toISOString();
  const service = {
    id: generateId(),
    ...data,
    alert: { contacted: false, contactedAt: null },
    createdAt: now,
    updatedAt: now,
  };
  return commitServices([...state.services, service]) ? service : null;
}

/**
 * Atualiza um serviço. Mudar a data recalcula o prazo e reabre o alerta
 * (é um novo prazo). Mudar outros campos preserva o estado do alerta.
 */
function updateService(id, data) {
  const current = findService(id);
  if (!current) return null;
  const dateChanged = current.date !== data.date;
  const updated = {
    ...current,
    ...data,
    alert: dateChanged ? { contacted: false, contactedAt: null } : { ...current.alert },
    updatedAt: new Date().toISOString(),
  };
  const ok = commitServices(state.services.map((s) => (s.id === id ? updated : s)));
  return ok ? { service: updated, dateChanged, reopened: dateChanged && current.alert.contacted } : null;
}

/** Exclui o serviço e, junto, o alerta dele. */
function deleteService(id) {
  return commitServices(state.services.filter((s) => s.id !== id));
}

function setContacted(id, contacted) {
  const current = findService(id);
  if (!current) return false;
  const updated = {
    ...current,
    alert: { contacted, contactedAt: contacted ? new Date().toISOString() : null },
    updatedAt: new Date().toISOString(),
  };
  return commitServices(state.services.map((s) => (s.id === id ? updated : s)));
}

/* ==========================================================
   9. CÁLCULOS FINANCEIROS
   ========================================================== */
function servicesInRange(start, end, list = state.services) {
  return list.filter((s) => (!start || s.date >= start) && (!end || s.date <= end));
}

/** Faturamento, quantidade e ticket médio de uma lista de serviços. */
function summarize(list) {
  const revenue = list.reduce((sum, s) => sum + s.valueCents, 0);
  const count = list.length;
  return { revenue, count, ticket: count ? Math.round(revenue / count) : 0 };
}

/** Intervalo [início, fim] de dia, semana (seg–dom) ou mês-calendário. */
function getPeriodRange(period, todayKey = state.todayKey) {
  switch (period) {
    case 'day': return { start: todayKey, end: todayKey };
    case 'week': return { start: DateUtil.startOfWeek(todayKey), end: DateUtil.endOfWeek(todayKey) };
    case 'month': return { start: DateUtil.startOfMonth(todayKey), end: DateUtil.endOfMonth(todayKey) };
    default: return { start: '', end: '' };
  }
}

function describeRange(start, end) {
  if (!start && !end) return 'Todo o período';
  if (start === end) return DateUtil.format(start);
  return `${DateUtil.format(start)} — ${DateUtil.format(end)}`;
}

/* ==========================================================
   10. INTERFACE: AVISOS E MODAL
   ========================================================== */
function toast(message, type = 'success', timeout = 3800) {
  const iconName = { success: 'check', error: 'alert', info: 'sparkle' }[type] || 'sparkle';
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(iconName)}<p>${escapeHtml(message)}</p>`;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 500); // garantia se a animação estiver desativada
  }, timeout);
}

const Modal = {
  el: null,
  resolve: null,
  pendingValue: null,

  init() {
    this.el = $('#modal');
    // Botões de ação do modal informam o valor de retorno
    this.el.addEventListener('click', (event) => {
      const button = event.target.closest('[data-modal-value]');
      if (button && !button.disabled) {
        this.close(button.dataset.modalValue || null);
      } else if (event.target === this.el) {
        this.close(null); // clique no fundo escurecido
      }
    });
    // Fechamento por Esc ou por close(): resolve a promessa pendente
    this.el.addEventListener('close', () => {
      const resolve = this.resolve;
      const value = this.pendingValue;
      this.resolve = null;
      this.pendingValue = null;
      if (resolve) resolve(value);
    });
  },

  /**
   * Abre o modal e devolve uma Promise com o valor do botão clicado
   * (ou null se fechado). Se já houver um modal aberto, o conteúdo é trocado.
   */
  open({ eyebrow = '', title, body, actions = [], wide = false, onRender }) {
    return new Promise((resolve) => {
      if (this.resolve) {
        const previous = this.resolve;
        this.resolve = null;
        previous(null);
      }
      $('#modal-eyebrow').textContent = eyebrow;
      $('#modal-title').textContent = title;
      $('#modal-body').innerHTML = body;
      $('#modal-actions').innerHTML = actions.map((a) => `
        <button type="button" class="btn btn--small ${a.variant || 'btn--ghost'}" data-modal-value="${escapeHtml(a.value)}" ${a.disabled ? 'disabled' : ''}>
          ${a.icon ? icon(a.icon) : ''}<span>${escapeHtml(a.label)}</span>
        </button>`).join('');
      this.el.classList.toggle('modal--wide', wide);
      this.resolve = resolve;
      if (!this.el.open) this.el.showModal();
      if (onRender) onRender(this.el);
      const focusTarget = $('[data-autofocus]', this.el) || $('#modal-actions button:last-child', this.el);
      if (focusTarget) focusTarget.focus();
    });
  },

  close(value = null) {
    if (!this.el.open) return;
    this.pendingValue = value;
    this.el.close();
  },
};

/** Confirmação genérica. requireText exige digitar uma palavra para liberar. */
async function confirmAction({ title, message, confirmLabel = 'Confirmar', danger = false, requireText = '' }) {
  const body = `
    <p>${message}</p>
    ${requireText ? `
      <div class="field">
        <label for="confirm-input">Digite <strong>${escapeHtml(requireText)}</strong> para confirmar</label>
        <input type="text" id="confirm-input" autocomplete="off" data-autofocus>
      </div>` : ''}`;
  const value = await Modal.open({
    eyebrow: danger ? 'Ação irreversível' : 'Confirmação',
    title,
    body,
    actions: [
      { label: 'Cancelar', value: 'cancel' },
      { label: confirmLabel, value: 'confirm', variant: danger ? 'btn--danger' : 'btn--primary', disabled: Boolean(requireText) },
    ],
    onRender(el) {
      if (!requireText) return;
      const input = $('#confirm-input', el);
      const button = $('[data-modal-value="confirm"]', el);
      input.addEventListener('input', () => {
        button.disabled = input.value.trim().toUpperCase() !== requireText.toUpperCase();
      });
    },
  });
  return value === 'confirm';
}

/** Copia texto para a área de transferência, com alternativa para contextos sem a API moderna. */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) { /* tenta a alternativa abaixo */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  // Dentro de um <dialog> aberto, só elementos do próprio dialog podem receber seleção
  (Modal.el && Modal.el.open ? Modal.el : document.body).appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
  area.remove();
  return ok;
}

/** Dispara o download de um arquivo gerado no navegador. */
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function emptyState({ iconName, title, text, action }) {
  return `
    <div class="empty">
      <span class="empty__icon">${icon(iconName)}</span>
      <p class="empty__title">${escapeHtml(title)}</p>
      <p class="empty__text">${escapeHtml(text)}</p>
      ${action ? `<a href="#${action.route}" class="btn btn--primary btn--small" ${action.attrs || ''}>${icon('plus')}<span>${escapeHtml(action.label)}</span></a>` : ''}
    </div>`;
}

function statusChip(status) {
  return `<span class="status status--${status}">${ALERT_LABELS[status]}</span>`;
}

/* ==========================================================
   11. NAVEGAÇÃO (hash, sem recarregar a página)
   ========================================================== */
function getRouteFromHash() {
  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''));
  return ROUTES[hash] ? hash : DEFAULT_ROUTE;
}

function navigate(route) {
  if (window.location.hash === '#' + route) showRoute(route);
  else window.location.hash = route;
}

function showRoute(route) {
  const previous = state.route;
  // Sair do formulário durante uma edição descarta a edição
  if (previous === 'registrar' && route !== 'registrar' && state.editingId) {
    cancelEditing({ silent: true });
  }
  state.route = route;

  $$('.view').forEach((view) => { view.hidden = view.dataset.view !== route; });
  $$('.nav__link').forEach((link) => {
    const active = link.dataset.route === route;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  $('#page-title').textContent = route === 'registrar' && state.editingId ? 'Editar serviço' : ROUTES[route].title;
  $('#page-index').textContent = ROUTES[route].index;
  document.title = `${ROUTES[route].title} · RDC Painel`;
  updateDocumentTitle();

  closeSidebar();
  if (previous !== null && previous !== route) {
    window.scrollTo({ top: 0, behavior: 'auto' });
    $('#page-title').focus({ preventScroll: true });
  }
  if (route === 'registrar') {
    setTimeout(() => $('#f-client').focus({ preventScroll: true }), 50);
  }
}

function openSidebar() {
  $('#sidebar').classList.add('is-open');
  $('#sidebar-overlay').hidden = false;
  $('#menu-toggle').setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  $('#sidebar').classList.remove('is-open');
  $('#sidebar-overlay').hidden = true;
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
}

/* ---------- Cabeçalho e indicadores globais ---------- */
function updateDocumentTitle() {
  const pending = getPendingServices().length;
  const base = `${ROUTES[state.route || DEFAULT_ROUTE].title} · RDC Painel`;
  document.title = pending ? `(${pending}) ${base}` : base;
}

function renderHeader() {
  $('#today-label').textContent = DateUtil.formatLong(state.todayKey);

  const pending = getPendingServices().length;
  const badge = $('#alert-badge');
  const navBadge = $('#nav-alert-badge');
  badge.hidden = navBadge.hidden = pending === 0;
  badge.textContent = navBadge.textContent = pending > 99 ? '99+' : String(pending);
  const button = $('#alert-button');
  button.classList.toggle('has-alerts', pending > 0);
  button.setAttribute('aria-label', pending
    ? `${plural(pending, 'cliente', 'clientes')} com retorno pendente`
    : 'Nenhum retorno pendente');
  button.title = button.getAttribute('aria-label');
  updateDocumentTitle();
}

/* ==========================================================
   12. VISÃO GERAL
   ========================================================== */
function renderOverview() {
  const today = state.todayKey;

  // Faturamento: dia, semana e mês sempre visíveis
  [['day', 'kpi-day'], ['week', 'kpi-week'], ['month', 'kpi-month']].forEach(([period, id]) => {
    const { start, end } = getPeriodRange(period, today);
    const summary = summarize(servicesInRange(start, end));
    $('#' + id).textContent = Money.format(summary.revenue);
    $(`#${id}-meta`).innerHTML = `<strong>${plural(summary.count, 'serviço', 'serviços')}</strong> · ${escapeHtml(
      period === 'day' ? DateUtil.format(start) : `${DateUtil.formatShort(start)} a ${DateUtil.formatShort(end)}`)}`;
  });

  // Veículos e ticket médio: período escolhido no controle segmentado
  const period = state.prefs.overviewPeriod;
  const periodName = { day: 'hoje', week: 'nesta semana', month: 'neste mês' }[period];
  $$('#overview-period button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === period)));
  const { start, end } = getPeriodRange(period, today);
  const summary = summarize(servicesInRange(start, end));
  $('#kpi-vehicles').textContent = String(summary.count);
  $('#kpi-vehicles-meta').textContent = `Atendimentos ${periodName}`;
  $('#kpi-ticket').textContent = Money.format(summary.ticket);
  $('#kpi-ticket-meta').textContent = summary.count ? `Média por serviço ${periodName}` : `Sem serviços ${periodName}`;

  const pending = getPendingServices().length;
  const waiting = state.services.filter((s) => getAlertStatus(s) === 'waiting').length;
  $('#kpi-pending').textContent = String(pending);
  $('#kpi-pending-meta').textContent = pending
    ? 'Clientes aguardando seu contato'
    : `Nenhum pendente · ${plural(waiting, 'aguardando prazo', 'aguardando prazo')}`;
  $('#kpi-pending-card').classList.toggle('is-alert', pending > 0);

  renderRevenueChart();
  renderRecentList();
  renderUpcomingList();
}

function renderRevenueChart() {
  const container = $('#revenue-chart');
  const today = DateUtil.parse(state.todayKey);
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const ref = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const startKey = DateUtil.toKey(ref);
    const total = summarize(servicesInRange(startKey, DateUtil.endOfMonth(startKey))).revenue;
    months.push({ year: ref.getFullYear(), month: ref.getMonth(), total, current: i === 0 });
  }
  const max = Math.max(...months.map((m) => m.total));

  if (max === 0) {
    container.innerHTML = emptyState({
      iconName: 'chart',
      title: 'Sem faturamento nos últimos meses',
      text: 'O gráfico aparece assim que houver serviços registrados nesse intervalo.',
      action: { route: 'registrar', label: 'Registrar serviço' },
    });
    return;
  }

  const description = months.map((m) => `${DateUtil.monthLabel(m.year, m.month, 'long')}: ${Money.format(m.total)}`).join('; ');
  container.innerHTML = `
    <div class="chart" role="img" aria-label="${escapeHtml('Faturamento mensal — ' + description)}">
      ${months.map((m, index) => `
        <div class="chart__col ${m.current ? 'is-current' : ''}" title="${escapeHtml(Money.format(m.total))}">
          <span class="chart__value">${escapeHtml(Money.format(m.total))}</span>
          <span class="chart__bar" style="height:${Math.max((m.total / max) * 100, 1.5).toFixed(1)}%; animation-delay:${index * 60}ms"></span>
        </div>`).join('')}
    </div>
    <div class="chart__labels" aria-hidden="true">
      ${months.map((m) => `<span class="${m.current ? 'is-current' : ''}">${escapeHtml(DateUtil.monthLabel(m.year, m.month))}/${String(m.year).slice(2)}</span>`).join('')}
    </div>`;
}

function renderRecentList() {
  const container = $('#recent-list');
  const recent = [...state.services]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  if (!recent.length) {
    container.innerHTML = emptyState({
      iconName: 'car',
      title: 'Nenhum serviço registrado',
      text: 'Registre o primeiro atendimento para começar a acompanhar faturamento e retornos.',
      action: { route: 'registrar', label: 'Registrar primeiro serviço' },
    });
    return;
  }
  container.innerHTML = `<div class="mini-list">${recent.map((s) => `
    <button type="button" class="mini-item" data-action="view" data-id="${escapeHtml(s.id)}">
      <span class="mini-item__avatar" aria-hidden="true">${escapeHtml(initials(s.clientName))}</span>
      <span class="mini-item__body">
        <span class="mini-item__title">${escapeHtml(s.clientName)}</span>
        <span class="mini-item__sub">${escapeHtml(s.vehicle)} · ${escapeHtml(s.description.split('\n')[0])}</span>
      </span>
      <span class="mini-item__end">
        <span class="mini-item__value">${escapeHtml(Money.format(s.valueCents))}</span><br>
        <span class="mini-item__date">${DateUtil.format(s.date)}</span>
      </span>
    </button>`).join('')}</div>`;
}

function renderUpcomingList() {
  const container = $('#upcoming-list');
  const open = state.services
    .map((s) => ({ service: s, info: getAlertInfo(s) }))
    .filter(({ info }) => info.status !== 'done')
    .sort((a, b) => a.info.reactivationDate.localeCompare(b.info.reactivationDate))
    .slice(0, 5);

  if (!open.length) {
    container.innerHTML = `<div class="empty empty--compact">
      <span class="empty__icon">${icon('check')}</span>
      <p class="empty__title">Tudo em dia</p>
      <p class="empty__text">Não há retornos pendentes nem prazos em andamento.</p>
    </div>`;
    return;
  }
  container.innerHTML = `<div class="mini-list">${open.map(({ service: s, info }) => {
    const when = info.status === 'pending'
      ? (info.daysUntil === 0 ? 'Retorno hoje' : `Atrasado ${plural(-info.daysUntil, 'dia', 'dias')}`)
      : `Em ${plural(info.daysUntil, 'dia', 'dias')}`;
    return `
    <button type="button" class="mini-item" data-action="goto-reactivation" data-tab="${info.status}">
      <span class="mini-item__avatar" aria-hidden="true">${escapeHtml(initials(s.clientName))}</span>
      <span class="mini-item__body">
        <span class="mini-item__title">${escapeHtml(s.clientName)}</span>
        <span class="mini-item__sub">${escapeHtml(s.vehicle)} · ${escapeHtml(when)}</span>
      </span>
      <span class="mini-item__end">
        ${statusChip(info.status)}<br>
        <span class="mini-item__date">${DateUtil.format(info.reactivationDate)}</span>
      </span>
    </button>`;
  }).join('')}</div>`;
}

/* ==========================================================
   13. FORMULÁRIO DE SERVIÇO
   ========================================================== */
const FORM_FIELDS = ['clientName', 'phone', 'vehicle', 'date', 'description', 'value'];

function getFormElements() {
  const form = $('#service-form');
  return Object.fromEntries(FORM_FIELDS.map((name) => [name, form.elements[name]]));
}

/** Valida os campos e devolve { errors, data } com os valores já normalizados. */
function validateServiceForm(values) {
  const errors = {};
  const data = {
    clientName: cleanText(values.clientName, 120),
    phone: Phone.digits(values.phone),
    vehicle: cleanText(values.vehicle, 80),
    date: String(values.date || ''),
    description: cleanMultiline(values.description, 600),
    valueCents: Money.parse(values.value),
  };

  if (!data.clientName) errors.clientName = 'Informe o nome do cliente.';
  else if (data.clientName.length < 3) errors.clientName = 'O nome precisa ter pelo menos 3 caracteres.';

  if (!data.phone) errors.phone = 'Informe o telefone com WhatsApp.';
  else if (!Phone.isValid(data.phone)) errors.phone = 'Telefone inválido. Use DDD + número, ex.: (11) 98765-4321.';

  if (!data.vehicle) errors.vehicle = 'Informe o modelo do veículo.';

  if (!data.date) errors.date = 'Informe a data do serviço.';
  else if (!DateUtil.isValidKey(data.date)) errors.date = 'Data inválida.';
  else if (data.date > state.todayKey) errors.date = 'A data do serviço não pode estar no futuro.';
  else if (data.date < '2000-01-01') errors.date = 'Data muito antiga. Confira o ano.';

  if (!data.description) errors.description = 'Descreva o serviço realizado.';

  if (!String(values.value || '').trim()) errors.value = 'Informe o valor cobrado.';
  else if (data.valueCents === null) errors.value = 'Valor inválido. Use o formato 150,00.';
  else if (data.valueCents <= 0) errors.value = 'O valor precisa ser maior que zero.';
  else if (data.valueCents > CONFIG.MAX_VALUE_CENTS) errors.value = 'Valor acima do limite permitido.';

  return { errors, data };
}

function showFormErrors(errors) {
  FORM_FIELDS.forEach((name) => {
    const message = errors[name] || '';
    const errorEl = $(`[data-error-for="${name}"]`);
    const input = getFormElements()[name];
    errorEl.textContent = message;
    input.closest('.field').classList.toggle('is-invalid', Boolean(message));
    input.setAttribute('aria-invalid', String(Boolean(message)));
    if (message) input.setAttribute('aria-describedby', errorEl.id || (errorEl.id = `err-${name}`));
    else input.removeAttribute('aria-describedby');
  });
}

function updateReactivationPreview() {
  const date = getFormElements().date.value;
  const preview = $('#reactivation-preview');
  if (!DateUtil.isValidKey(date) || date > state.todayKey) {
    preview.textContent = '';
    return;
  }
  const reactivation = DateUtil.addDays(date, CONFIG.REACTIVATION_DAYS);
  const status = state.todayKey >= reactivation ? ' · já entra como pendente' : '';
  preview.innerHTML = `Retorno previsto: <strong>${DateUtil.format(reactivation)}</strong>${status}`;
}

function resetForm() {
  const form = $('#service-form');
  form.reset();
  getFormElements().date.value = state.todayKey;
  showFormErrors({});
  updateReactivationPreview();
}

function fillForm(service) {
  const f = getFormElements();
  f.clientName.value = service.clientName;
  f.phone.value = Phone.mask(service.phone);
  f.vehicle.value = service.vehicle;
  f.date.value = service.date;
  f.description.value = service.description;
  f.value.value = Money.toInput(service.valueCents);
  showFormErrors({});
  updateReactivationPreview();
}

function setFormMode() {
  const editing = Boolean(state.editingId);
  const service = editing ? findService(state.editingId) : null;
  $('#form-title').textContent = editing ? 'Editar atendimento' : 'Novo atendimento';
  $('#form-sub').textContent = editing
    ? 'Altere os dados e salve. Mudar a data recalcula o prazo de retorno.'
    : 'Preencha os dados do serviço realizado. Campos com * são obrigatórios.';
  $('#edit-banner').hidden = !editing;
  if (service) {
    $('#edit-banner-text').textContent = `Editando o serviço de ${service.clientName} realizado em ${DateUtil.format(service.date)}.`;
  }
  $('#form-cancel').hidden = !editing;
  $('#form-clear').hidden = editing;
  $('#form-submit span').textContent = editing ? 'Salvar alterações' : 'Salvar serviço';
  if (state.route === 'registrar') $('#page-title').textContent = editing ? 'Editar serviço' : ROUTES.registrar.title;
}

function startEditing(id) {
  const service = findService(id);
  if (!service) return;
  Modal.close();
  state.editingId = id;
  fillForm(service);
  setFormMode();
  navigate('registrar');
}

function cancelEditing({ silent = false } = {}) {
  state.editingId = null;
  resetForm();
  setFormMode();
  if (!silent) toast('Edição cancelada.', 'info');
}

function handleFormSubmit(event) {
  event.preventDefault();
  const f = getFormElements();
  const values = Object.fromEntries(FORM_FIELDS.map((name) => [name, f[name].value]));
  const { errors, data } = validateServiceForm(values);
  showFormErrors(errors);

  const firstError = FORM_FIELDS.find((name) => errors[name]);
  if (firstError) {
    f[firstError].focus();
    toast('Revise os campos destacados.', 'error');
    return;
  }

  if (state.editingId) {
    const result = updateService(state.editingId, data);
    if (!result) return;
    state.editingId = null;
    resetForm();
    setFormMode();
    const extra = result.dateChanged
      ? ` Novo retorno previsto para ${DateUtil.format(getReactivationDate(result.service))}${result.reopened ? ' — alerta reaberto' : ''}.`
      : '';
    toast(`Alterações salvas.${extra}`, 'success', 5000);
    navigate('historico');
  } else {
    const service = createService(data);
    if (!service) return;
    resetForm();
    toast(`Serviço de ${service.clientName} registrado. Retorno previsto para ${DateUtil.format(getReactivationDate(service))}.`, 'success', 5000);
    f.clientName.focus();
  }
}

/** Sugestões de clientes já cadastrados (preenche telefone e veículo). */
function renderClientSuggestions() {
  const latestByName = new Map();
  [...state.services]
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((s) => latestByName.set(s.clientName, s));
  $('#client-suggestions').innerHTML = Array.from(latestByName.values())
    .map((s) => `<option value="${escapeHtml(s.clientName)}">${escapeHtml(s.vehicle)} · ${escapeHtml(Phone.format(s.phone))}</option>`)
    .join('');
}

function prefillFromKnownClient() {
  const f = getFormElements();
  const name = cleanText(f.clientName.value);
  if (!name || state.editingId) return;
  const matches = state.services.filter((s) => s.clientName === name).sort((a, b) => b.date.localeCompare(a.date));
  if (!matches.length) return;
  if (!f.phone.value.trim()) f.phone.value = Phone.mask(matches[0].phone);
  if (!f.vehicle.value.trim()) f.vehicle.value = matches[0].vehicle;
}

/* ==========================================================
   14. HISTÓRICO
   ========================================================== */
/** Intervalo efetivo do filtro: períodos rápidos acompanham a data atual. */
function getHistoryRange() {
  const h = state.prefs.history;
  if (h.period === 'custom') {
    let { from, to } = h;
    if (from && to && from > to) [from, to] = [to, from];
    return { start: from, end: to };
  }
  return getPeriodRange(h.period);
}

function filterHistory() {
  const h = state.prefs.history;
  const query = normalizeSearch(h.query);
  const queryDigits = h.query.replace(/\D/g, '');
  const { start, end } = getHistoryRange();

  const matchesQuery = (s) => {
    if (!query) return true;
    const name = normalizeSearch(s.clientName).includes(query);
    const vehicle = normalizeSearch(s.vehicle).includes(query);
    const phone = queryDigits.length > 0 && s.phone.includes(queryDigits);
    if (h.scope === 'name') return name;
    if (h.scope === 'vehicle') return vehicle;
    if (h.scope === 'phone') return phone;
    return name || vehicle || phone;
  };

  const list = servicesInRange(start, end).filter(matchesQuery);
  const sorters = {
    'date-desc': (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    'date-asc': (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
    'value-desc': (a, b) => b.valueCents - a.valueCents || b.date.localeCompare(a.date),
    'value-asc': (a, b) => a.valueCents - b.valueCents || b.date.localeCompare(a.date),
  };
  return list.sort(sorters[h.sort] || sorters['date-desc']);
}

/** Sincroniza os controles de filtro com as preferências salvas. */
function syncHistoryControls() {
  const h = state.prefs.history;
  const { start, end } = getHistoryRange();
  if ($('#history-search').value !== h.query) $('#history-search').value = h.query;
  $('#history-scope').value = h.scope;
  $('#history-sort').value = h.sort;
  $('#history-from').value = start;
  $('#history-to').value = end;
  $$('#history-period button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === h.period)));
}

function renderHistory() {
  syncHistoryControls();
  const container = $('#history-list');
  const list = filterHistory();
  const summary = summarize(list);
  const visible = list.slice(0, state.historyLimit);

  $('#history-summary').innerHTML = state.services.length
    ? `<strong>${plural(list.length, 'registro', 'registros')}</strong> · ${escapeHtml(Money.format(summary.revenue))} · ${escapeHtml(describeRange(getHistoryRange().start, getHistoryRange().end))}`
    : '';
  $('#history-export').disabled = list.length === 0;
  $('#history-more').hidden = list.length <= visible.length;
  $('#history-more').textContent = `Mostrar mais (${list.length - visible.length} restantes)`;

  if (!state.services.length) {
    container.innerHTML = emptyState({
      iconName: 'history',
      title: 'Histórico vazio',
      text: 'Os serviços registrados aparecem aqui, com busca, filtros por período e ordenação.',
      action: { route: 'registrar', label: 'Registrar serviço' },
    });
    return;
  }
  if (!list.length) {
    container.innerHTML = `<div class="empty">
      <span class="empty__icon">${icon('search')}</span>
      <p class="empty__title">Nenhum resultado</p>
      <p class="empty__text">Nenhum serviço corresponde aos filtros atuais. Ajuste a busca ou o período.</p>
      <button type="button" class="btn btn--ghost btn--small" data-action="reset-history">Limpar filtros</button>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="table table--responsive">
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Cliente</th>
            <th scope="col">Telefone</th>
            <th scope="col">Veículo</th>
            <th scope="col">Serviço</th>
            <th scope="col" class="num">Valor</th>
            <th scope="col">Reativação</th>
            <th scope="col">Situação</th>
            <th scope="col"><span class="sr-only">Ações</span></th>
          </tr>
        </thead>
        <tbody>
          ${visible.map((s) => {
            const info = getAlertInfo(s);
            const id = escapeHtml(s.id);
            return `
            <tr class="${info.status === 'pending' ? 'is-pending' : ''}">
              <td data-label="Data" class="mono">${DateUtil.format(s.date)}</td>
              <td data-label="Cliente"><strong>${escapeHtml(s.clientName)}</strong></td>
              <td data-label="Telefone" class="mono">${escapeHtml(Phone.format(s.phone))}</td>
              <td data-label="Veículo">${escapeHtml(s.vehicle)}</td>
              <td data-label="Serviço" class="cell-desc"><span title="${escapeHtml(s.description)}">${escapeHtml(s.description)}</span></td>
              <td data-label="Valor" class="num">${escapeHtml(Money.format(s.valueCents))}</td>
              <td data-label="Reativação" class="mono">${DateUtil.format(info.reactivationDate)}</td>
              <td data-label="Situação">${statusChip(info.status)}</td>
              <td class="cell-actions">
                <button type="button" class="icon-btn icon-btn--sm" data-action="view" data-id="${id}" aria-label="Ver detalhes de ${escapeHtml(s.clientName)}" title="Detalhes">${icon('eye')}</button>
                <button type="button" class="icon-btn icon-btn--sm" data-action="edit" data-id="${id}" aria-label="Editar serviço de ${escapeHtml(s.clientName)}" title="Editar">${icon('edit')}</button>
                <button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-action="delete" data-id="${id}" aria-label="Excluir serviço de ${escapeHtml(s.clientName)}" title="Excluir">${icon('trash')}</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function updateHistoryFilters(changes) {
  state.prefs.history = { ...state.prefs.history, ...changes };
  state.historyLimit = CONFIG.HISTORY_PAGE_SIZE;
  savePrefs();
  renderHistory();
}

function resetHistoryFilters() {
  updateHistoryFilters(structuredClone(DEFAULT_PREFS.history));
}

/** Janela de detalhes de um serviço. */
async function showServiceDetails(id) {
  const s = findService(id);
  if (!s) return;
  const info = getAlertInfo(s);
  const laterVisit = findLaterVisit(s);
  const alertDetail = {
    waiting: `Faltam ${plural(info.daysUntil, 'dia', 'dias')} para o prazo.`,
    pending: info.daysUntil === 0 ? 'O prazo vence hoje.' : `Pendente há ${plural(-info.daysUntil, 'dia', 'dias')}.`,
    done: `Contato registrado em ${DateUtil.formatDateTime(s.alert.contactedAt)}.`,
  }[info.status];

  const action = await Modal.open({
    eyebrow: `Atendimento · ${DateUtil.format(s.date)}`,
    title: s.clientName,
    wide: true,
    body: `
      <dl class="detail-list">
        <div><dt>Telefone (WhatsApp)</dt><dd class="mono">${escapeHtml(Phone.format(s.phone))}</dd></div>
        <div><dt>Veículo</dt><dd>${escapeHtml(s.vehicle)}</dd></div>
        <div class="full"><dt>Serviço realizado</dt><dd class="pre">${escapeHtml(s.description)}</dd></div>
        <div><dt>Valor cobrado</dt><dd class="value">${escapeHtml(Money.format(s.valueCents))}</dd></div>
        <div><dt>Dias desde o atendimento</dt><dd class="mono">${info.daysSince}</dd></div>
        <div><dt>Reativação prevista</dt><dd class="mono">${DateUtil.format(info.reactivationDate)}</dd></div>
        <div><dt>Situação do alerta</dt><dd>${statusChip(info.status)}<br><small>${escapeHtml(alertDetail)}</small></dd></div>
        ${laterVisit ? `<div class="full"><dt>Retorno do cliente</dt><dd>Voltou em ${DateUtil.format(laterVisit.date)} (${escapeHtml(laterVisit.description.split('\n')[0])}).</dd></div>` : ''}
        <div><dt>Cadastrado em</dt><dd class="mono">${DateUtil.formatDateTime(s.createdAt)}</dd></div>
        <div><dt>Última alteração</dt><dd class="mono">${DateUtil.formatDateTime(s.updatedAt)}</dd></div>
        <div class="full"><dt>Identificador</dt><dd class="mono"><small>${escapeHtml(s.id)}</small></dd></div>
      </dl>`,
    actions: [
      { label: 'Excluir', value: 'delete', icon: 'trash', variant: 'btn--danger' },
      { label: 'Copiar mensagem', value: 'copy', icon: 'copy' },
      ...(whatsappUrl(s) ? [{ label: 'WhatsApp', value: 'whatsapp', icon: 'message' }] : []),
      { label: 'Editar', value: 'edit', icon: 'edit', variant: 'btn--primary' },
    ],
  });

  if (action === 'edit') startEditing(id);
  else if (action === 'delete') requestDelete(id);
  else if (action === 'copy') copyMessage(id);
  else if (action === 'whatsapp') openWhatsapp(id);
}

async function requestDelete(id) {
  const s = findService(id);
  if (!s) return;
  const confirmed = await confirmAction({
    title: 'Excluir serviço?',
    message: `O atendimento de <strong>${escapeHtml(s.clientName)}</strong> em ${DateUtil.format(s.date)} (${escapeHtml(Money.format(s.valueCents))}) e o alerta de retorno dele serão removidos. Essa ação não pode ser desfeita.`,
    confirmLabel: 'Excluir',
    danger: true,
  });
  if (!confirmed) return;
  if (state.editingId === id) cancelEditing({ silent: true });
  if (deleteService(id)) toast('Serviço e alerta excluídos.', 'success');
}

/* ==========================================================
   15. CLIENTES PARA REATIVAR
   ========================================================== */
function renderReactivation() {
  const tab = state.prefs.reactivationTab;
  const groups = { pending: [], waiting: [], done: [] };
  state.services.forEach((s) => {
    const info = getAlertInfo(s);
    groups[info.status].push({ service: s, info });
  });
  // Pendentes: mais atrasados primeiro. Aguardando: prazo mais próximo. Contatados: mais recentes.
  groups.pending.sort((a, b) => a.info.reactivationDate.localeCompare(b.info.reactivationDate));
  groups.waiting.sort((a, b) => a.info.reactivationDate.localeCompare(b.info.reactivationDate));
  groups.done.sort((a, b) => String(b.service.alert.contactedAt).localeCompare(String(a.service.alert.contactedAt)));

  $$('#reactivation-tabs [data-tab]').forEach((button) => {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    $('.tabs__count', button).textContent = String(groups[button.dataset.tab].length);
  });

  const container = $('#reactivation-list');
  const items = groups[tab];
  if (!items.length) {
    const empty = {
      pending: { iconName: 'check', title: 'Nenhum retorno pendente', text: 'Quando um serviço completar 15 dias, o cliente aparece aqui com a mensagem pronta para copiar.' },
      waiting: { iconName: 'clock', title: 'Nenhum prazo em andamento', text: 'Serviços registrados há menos de 15 dias aparecem aqui até o prazo chegar.' },
      done: { iconName: 'message', title: 'Nenhum contato registrado', text: 'Os clientes marcados como contatados ficam guardados aqui.' },
    }[tab];
    container.innerHTML = emptyState(state.services.length ? empty : {
      ...empty, action: { route: 'registrar', label: 'Registrar serviço' },
    });
    return;
  }

  container.innerHTML = `<div class="cards">${items.map(({ service: s, info }, index) => {
    const id = escapeHtml(s.id);
    const laterVisit = findLaterVisit(s);
    const counter = {
      pending: info.daysUntil === 0 ? 'prazo vence hoje' : `atrasado ${plural(-info.daysUntil, 'dia', 'dias')}`,
      waiting: `faltam ${plural(info.daysUntil, 'dia', 'dias')} para o prazo`,
      done: `contatado em ${DateUtil.formatDateTime(s.alert.contactedAt)}`,
    }[info.status];
    const waUrl = whatsappUrl(s);
    const whatsappButton = waUrl
      ? `<a class="btn ${info.status === 'pending' ? 'btn--primary' : 'btn--ghost'} btn--small r-card__wa" href="${escapeHtml(waUrl)}" ${whatsappLinkTarget()} data-action="open-whatsapp" data-id="${id}">${icon('message')}<span>Abrir no WhatsApp</span></a>`
      : '';
    const copyButton = `<button type="button" class="btn btn--ghost btn--small" data-action="copy-message" data-id="${id}">${icon('copy')}<span>Copiar mensagem</span></button>`;
    const actions = {
      pending: `${whatsappButton}${copyButton}
        <button type="button" class="btn btn--gold btn--small" data-action="mark-contacted" data-id="${id}">${icon('check')}<span>Marcar como contatado</span></button>`,
      waiting: `${whatsappButton}${copyButton}
        <button type="button" class="btn btn--ghost btn--small" data-action="view" data-id="${id}">${icon('eye')}<span>Detalhes</span></button>`,
      done: `${whatsappButton}${copyButton}
        <button type="button" class="btn btn--ghost btn--small" data-action="reopen-alert" data-id="${id}">${icon('undo')}<span>Reabrir alerta</span></button>`,
    }[info.status];

    return `
    <article class="r-card ${info.status === 'pending' ? 'is-pending' : ''}" style="animation-delay:${Math.min(index, 8) * 40}ms">
      <header class="r-card__head">
        <div>
          <h3 class="r-card__name">${escapeHtml(s.clientName)}</h3>
          <p class="r-card__phone">${escapeHtml(Phone.format(s.phone))}</p>
        </div>
        ${statusChip(info.status)}
      </header>
      <div class="r-card__days">
        <strong>${info.daysSince}</strong>
        <span>${info.daysSince === 1 ? 'dia' : 'dias'} desde o atendimento · ${escapeHtml(counter)}</span>
      </div>
      <dl>
        <div><dt>Veículo</dt><dd>${escapeHtml(s.vehicle)}</dd></div>
        <div><dt>Valor</dt><dd class="mono">${escapeHtml(Money.format(s.valueCents))}</dd></div>
        <div class="dl-full"><dt>Último serviço realizado</dt><dd>${escapeHtml(s.description)}</dd></div>
        <div><dt>Data do serviço</dt><dd class="mono">${DateUtil.format(s.date)}</dd></div>
        <div><dt>Reativação prevista</dt><dd class="mono">${DateUtil.format(info.reactivationDate)}</dd></div>
      </dl>
      ${laterVisit && info.status !== 'done' ? `<p class="r-card__note">${icon('sparkle')}<span>Este cliente já voltou em ${DateUtil.format(laterVisit.date)}. Se não precisar de contato, marque como tratado.</span></p>` : ''}
      <div class="r-card__actions">${actions}</div>
    </article>`;
  }).join('')}</div>`;
}

async function copyMessage(id, button) {
  const s = findService(id);
  if (!s) return;
  const ok = await copyText(buildMessage(s));
  if (ok) {
    toast(`Mensagem para ${firstName(s.clientName)} copiada. Cole no WhatsApp para enviar.`, 'success');
    if (button) {
      const label = $('span', button);
      const original = label.textContent;
      label.textContent = 'Copiada!';
      setTimeout(() => { if (button.isConnected) label.textContent = original; }, 2000);
    }
  } else {
    // Sem acesso à área de transferência: mostra o texto para cópia manual
    Modal.open({
      eyebrow: 'Copie manualmente',
      title: `Mensagem para ${firstName(s.clientName)}`,
      body: `<div class="field"><label for="manual-copy">Selecione e copie o texto</label><textarea id="manual-copy" rows="6" readonly data-autofocus>${escapeHtml(buildMessage(s))}</textarea></div>`,
      actions: [{ label: 'Fechar', value: 'close' }],
      onRender(el) { $('#manual-copy', el).select(); },
    });
  }
}

/** Abre a conversa do cliente no WhatsApp com a mensagem pronta para enviar. */
function openWhatsapp(id) {
  const s = findService(id);
  const url = s && whatsappUrl(s);
  if (!url) {
    toast('Telefone sem DDD + número válido. Edite o cadastro para usar o WhatsApp.', 'error');
    return;
  }
  const mode = getWhatsappMode();
  if (mode === 'app') window.location.href = url; // o protocolo abre o aplicativo sem sair do painel
  else if (mode === 'web') window.open(url, WHATSAPP_WINDOW);
  else window.open(url, '_blank', 'noopener');
  showWhatsappHint(s);
}

function showWhatsappHint(service) {
  const hint = getAlertStatus(service) === 'pending' ? ' Depois de enviar, marque como contatado.' : '';
  const where = getWhatsappMode() === 'web' ? 'na aba do WhatsApp Web' : 'no WhatsApp';
  toast(`Conversa com ${firstName(service.clientName)} aberta ${where} — é só apertar enviar.${hint}`, 'info', 6000);
}

function markContacted(id) {
  const s = findService(id);
  if (!s) return;
  if (setContacted(id, true)) toast(`Contato com ${firstName(s.clientName)} registrado. Alerta encerrado.`, 'success');
}

function reopenAlert(id) {
  const s = findService(id);
  if (!s) return;
  if (setContacted(id, false)) {
    const status = getAlertStatus(findService(id));
    toast(`Alerta reaberto — ${ALERT_LABELS[status].toLowerCase()}.`, 'info');
  }
}

/* ==========================================================
   16. RELATÓRIOS
   ========================================================== */
function getReportRange() {
  const r = state.prefs.report;
  const today = state.todayKey;
  switch (r.period) {
    case 'previous-month': {
      const lastMonthDay = DateUtil.addDays(DateUtil.startOfMonth(today), -1);
      return { start: DateUtil.startOfMonth(lastMonthDay), end: lastMonthDay };
    }
    case 'month': {
      const month = r.month || today.slice(0, 7);
      const start = `${month}-01`;
      return { start, end: DateUtil.endOfMonth(start) };
    }
    case 'year':
      return { start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` };
    case 'custom': {
      let from = r.from || DateUtil.startOfMonth(today);
      let to = r.to || today;
      if (from > to) [from, to] = [to, from];
      return { start: from, end: to };
    }
    case 'all': {
      if (!state.services.length) return { start: '', end: '' };
      const dates = state.services.map((s) => s.date).sort();
      return { start: dates[0], end: dates[dates.length - 1] };
    }
    default:
      return getPeriodRange('month', today);
  }
}

/** Agrupa por dia (até ~2 meses) ou por mês (intervalos maiores). */
function buildBreakdown(list, start, end) {
  const byDay = start && end && DateUtil.diffDays(start, end) <= 62;
  const groups = new Map();
  list.forEach((s) => {
    const key = byDay ? s.date : s.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });
  const rows = Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({
      key,
      label: byDay
        ? DateUtil.format(key)
        : `${DateUtil.monthLabel(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 'long')}/${key.slice(0, 4)}`,
      ...summarize(items),
    }));
  return { byDay, rows };
}

function buildTopClients(list) {
  const groups = new Map();
  list.forEach((s) => {
    const key = clientKey(s);
    const g = groups.get(key) || { name: s.clientName, phone: s.phone, count: 0, revenue: 0, lastDate: '' };
    g.count += 1;
    g.revenue += s.valueCents;
    if (s.date >= g.lastDate) { g.lastDate = s.date; g.name = s.clientName; }
    groups.set(key, g);
  });
  return Array.from(groups.values()).sort((a, b) => b.revenue - a.revenue || b.count - a.count);
}

function syncReportControls() {
  const r = state.prefs.report;
  const { start, end } = getReportRange();
  $('#report-period').value = r.period;
  $('#report-month-field').hidden = r.period !== 'month';
  $('#report-range-fields').hidden = r.period !== 'custom';
  $('#report-month').value = r.month || state.todayKey.slice(0, 7);
  $('#report-from').value = r.period === 'custom' ? start : '';
  $('#report-to').value = r.period === 'custom' ? end : '';
}

function renderReports() {
  syncReportControls();
  const { start, end } = getReportRange();
  const list = start ? servicesInRange(start, end) : [];
  const summary = summarize(list);
  const clients = buildTopClients(list);
  const contacted = list.filter((s) => s.alert.contacted).length;

  $('#report-caption').textContent = start ? `Período analisado: ${describeRange(start, end)}` : 'Nenhum serviço registrado.';
  $('#report-export-detail').disabled = list.length === 0;
  $('#report-export-summary').disabled = list.length === 0;

  $('#report-kpis').innerHTML = [
    { label: 'Faturamento', value: Money.format(summary.revenue), meta: describeRange(start, end), iconName: 'wallet' },
    { label: 'Atendimentos', value: String(summary.count), meta: 'Veículos atendidos', iconName: 'car' },
    { label: 'Ticket médio', value: Money.format(summary.ticket), meta: 'Faturamento ÷ serviços', iconName: 'receipt' },
    { label: 'Clientes únicos', value: String(clients.length), meta: `${plural(contacted, 'retorno contatado', 'retornos contatados')}`, iconName: 'users' },
  ].map((k) => `
    <article class="kpi">
      <div class="kpi__head"><span class="kpi__label">${escapeHtml(k.label)}</span>${icon(k.iconName)}</div>
      <strong class="kpi__value">${escapeHtml(k.value)}</strong>
      <p class="kpi__meta">${escapeHtml(k.meta)}</p>
    </article>`).join('');

  const emptyPeriod = `<div class="empty empty--compact">
    <span class="empty__icon">${icon('chart')}</span>
    <p class="empty__title">Sem dados no período</p>
    <p class="empty__text">Escolha outro período ou registre serviços para gerar o relatório.</p>
  </div>`;

  const breakdown = buildBreakdown(list, start, end);
  $('#report-breakdown-title').textContent = breakdown.byDay ? 'Resumo por dia' : 'Resumo por mês';
  $('#report-breakdown').innerHTML = !list.length ? emptyPeriod : `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th scope="col">${breakdown.byDay ? 'Dia' : 'Mês'}</th><th scope="col" class="num">Serviços</th><th scope="col" class="num">Faturamento</th><th scope="col" class="num">Ticket</th></tr></thead>
        <tbody>${breakdown.rows.map((row) => `
          <tr><td class="mono">${escapeHtml(row.label)}</td><td class="num">${row.count}</td><td class="num">${escapeHtml(Money.format(row.revenue))}</td><td class="num">${escapeHtml(Money.format(row.ticket))}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td>Total</td><td class="num">${summary.count}</td><td class="num">${escapeHtml(Money.format(summary.revenue))}</td><td class="num">${escapeHtml(Money.format(summary.ticket))}</td></tr></tfoot>
      </table>
    </div>`;

  $('#report-clients').innerHTML = !list.length ? emptyPeriod : `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th scope="col">Cliente</th><th scope="col" class="num">Serviços</th><th scope="col" class="num">Total</th></tr></thead>
        <tbody>${clients.slice(0, 10).map((c) => `
          <tr>
            <td><strong>${escapeHtml(c.name)}</strong><br><small class="mono" style="color:var(--grey)">${escapeHtml(Phone.format(c.phone))} · último ${DateUtil.format(c.lastDate)}</small></td>
            <td class="num">${c.count}</td>
            <td class="num">${escapeHtml(Money.format(c.revenue))}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function updateReportPrefs(changes) {
  state.prefs.report = { ...state.prefs.report, ...changes };
  savePrefs();
  renderReports();
}

/* ==========================================================
   17. CONFIGURAÇÕES, BACKUP E CSV
   ========================================================== */
/** Célula CSV segura: aspas escapadas e proteção contra fórmulas em planilhas. */
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV com ";" e BOM UTF-8, formato que o Excel em português abre corretamente. */
function toCsv(rows) {
  return '﻿' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
}

function servicesToCsv(list) {
  const header = ['ID', 'Data do atendimento', 'Cliente', 'Telefone', 'Veículo', 'Serviço realizado', 'Valor (R$)', 'Reativação prevista', 'Situação do alerta', 'Contatado em'];
  const rows = list.map((s) => {
    const info = getAlertInfo(s);
    return [
      s.id, DateUtil.format(s.date), s.clientName, Phone.format(s.phone), s.vehicle,
      s.description.replace(/\n/g, ' '), Money.toCsv(s.valueCents), DateUtil.format(info.reactivationDate),
      ALERT_LABELS[info.status], s.alert.contacted ? DateUtil.formatDateTime(s.alert.contactedAt) : '',
    ];
  });
  return toCsv([header, ...rows]);
}

function exportHistoryCsv() {
  const list = filterHistory();
  if (!list.length) return;
  downloadFile(`rdc-historico-${state.todayKey}.csv`, servicesToCsv(list), 'text/csv;charset=utf-8');
  toast(`CSV exportado com ${plural(list.length, 'registro', 'registros')}.`, 'success');
}

function exportReportDetailCsv() {
  const { start, end } = getReportRange();
  const list = servicesInRange(start, end).sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return;
  downloadFile(`rdc-relatorio-${start}_${end}.csv`, servicesToCsv(list), 'text/csv;charset=utf-8');
  toast('Relatório detalhado exportado.', 'success');
}

function exportReportSummaryCsv() {
  const { start, end } = getReportRange();
  const list = servicesInRange(start, end);
  if (!list.length) return;
  const { byDay, rows } = buildBreakdown(list, start, end);
  const total = summarize(list);
  const csv = toCsv([
    ['Relatório RDC Real Detail Car', describeRange(start, end)],
    [],
    [byDay ? 'Dia' : 'Mês', 'Atendimentos', 'Faturamento (R$)', 'Ticket médio (R$)'],
    ...rows.map((r) => [r.label, r.count, Money.toCsv(r.revenue), Money.toCsv(r.ticket)]),
    ['Total', total.count, Money.toCsv(total.revenue), Money.toCsv(total.ticket)],
  ]);
  downloadFile(`rdc-resumo-${start}_${end}.csv`, csv, 'text/csv;charset=utf-8');
  toast('Resumo exportado.', 'success');
}

function exportBackup() {
  const payload = {
    app: CONFIG.BACKUP_APP,
    version: CONFIG.SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    services: state.services,
    settings: { messageTemplate: state.prefs.messageTemplate },
  };
  downloadFile(`rdc-backup-${state.todayKey}.json`, JSON.stringify(payload, null, 2), 'application/json');
  state.prefs.lastBackupAt = payload.exportedAt;
  savePrefs();
  renderSettings();
  toast(`Backup exportado com ${plural(state.services.length, 'serviço', 'serviços')}.`, 'success');
}

/** Lê um arquivo de backup, mostra o resumo e pergunta como importar. */
function importBackup(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    toast('Arquivo grande demais para um backup do painel.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => toast('Não foi possível ler o arquivo.', 'error');
  reader.onload = async () => {
    let data;
    try {
      data = JSON.parse(String(reader.result).replace(/^﻿/, ''));
    } catch (error) {
      toast('O arquivo não é um JSON válido.', 'error');
      return;
    }
    const list = Array.isArray(data) ? data : data && Array.isArray(data.services) ? data.services : null;
    if (!list) {
      toast('Arquivo sem lista de serviços. Use um backup exportado por este painel.', 'error');
      return;
    }
    const { services, dropped } = normalizeServiceList(list);
    if (!services.length) {
      toast('Nenhum serviço válido encontrado no arquivo.', 'error');
      return;
    }

    const existingIds = new Set(state.services.map((s) => s.id));
    const overlapping = services.filter((s) => existingIds.has(s.id)).length;
    const choice = await Modal.open({
      eyebrow: 'Importar backup',
      title: file.name,
      body: `
        <div class="import-summary">
          <div><strong>${services.length}</strong><span>serviços válidos no arquivo</span></div>
          <div><strong>${state.services.length}</strong><span>serviços atuais</span></div>
          <div><strong>${overlapping}</strong><span>em comum (mesmo ID)</span></div>
        </div>
        ${dropped ? `<p>${plural(dropped, 'registro inválido será ignorado', 'registros inválidos serão ignorados')}.</p>` : ''}
        <p><strong>Mesclar</strong> adiciona os serviços do arquivo e, para IDs em comum, mantém a versão alterada mais recentemente.</p>
        <p><strong>Substituir</strong> apaga os dados atuais e usa apenas o conteúdo do arquivo.</p>`,
      actions: [
        { label: 'Cancelar', value: 'cancel' },
        { label: 'Substituir tudo', value: 'replace', variant: 'btn--danger' },
        { label: 'Mesclar', value: 'merge', variant: 'btn--primary' },
      ],
    });

    if (choice === 'merge') {
      const merged = new Map(state.services.map((s) => [s.id, s]));
      services.forEach((s) => {
        const current = merged.get(s.id);
        if (!current || s.updatedAt > current.updatedAt) merged.set(s.id, s);
      });
      if (commitServices(Array.from(merged.values()))) {
        toast(`Backup mesclado. Total: ${plural(merged.size, 'serviço', 'serviços')}.`, 'success');
      }
    } else if (choice === 'replace') {
      const confirmed = await confirmAction({
        title: 'Substituir todos os dados?',
        message: `Os ${plural(state.services.length, 'serviço atual será apagado', 'serviços atuais serão apagados')} e substituídos pelos ${services.length} do arquivo.`,
        confirmLabel: 'Substituir',
        danger: true,
      });
      if (!confirmed) return;
      if (commitServices(services)) {
        const template = data && data.settings && typeof data.settings.messageTemplate === 'string' ? data.settings.messageTemplate.trim() : '';
        if (template) {
          state.prefs.messageTemplate = template.slice(0, 1000);
          savePrefs();
          renderSettings(true);
        }
        toast(`Dados substituídos: ${plural(services.length, 'serviço importado', 'serviços importados')}.`, 'success');
      }
    }
  };
  reader.readAsText(file, 'utf-8');
}

async function clearAllData() {
  if (!state.services.length) {
    toast('Não há dados para apagar.', 'info');
    return;
  }
  const confirmed = await confirmAction({
    title: 'Apagar todos os dados?',
    message: `Todos os <strong>${plural(state.services.length, 'serviço', 'serviços')}</strong> e seus alertas serão removidos deste navegador.`,
    confirmLabel: 'Apagar tudo',
    danger: true,
    requireText: 'APAGAR',
  });
  if (!confirmed) return;
  if (state.editingId) cancelEditing({ silent: true });
  if (commitServices([])) toast('Todos os dados foram apagados.', 'success');
}

/** Atualiza estatísticas e a pré-visualização da mensagem. */
function renderSettings(syncTemplate = false) {
  $('#whatsapp-mode').value = state.prefs.whatsappMode;
  $('#whatsapp-mode-field').hidden = isMobileDevice();
  const templateInput = $('#message-template');
  if (syncTemplate || (!templateInput.value && document.activeElement !== templateInput)) {
    templateInput.value = state.prefs.messageTemplate;
  }
  renderMessagePreview();

  const clients = new Set(state.services.map(clientKey)).size;
  const last = state.prefs.lastBackupAt;
  const daysSinceBackup = last ? DateUtil.diffDays(DateUtil.toKey(new Date(last)), state.todayKey) : null;
  const needsBackup = state.services.length > 0 && (daysSinceBackup === null || daysSinceBackup >= CONFIG.BACKUP_REMINDER_DAYS);

  $('#data-stats').innerHTML = `
    <div><dt>Serviços</dt><dd>${state.services.length}</dd></div>
    <div><dt>Clientes</dt><dd>${clients}</dd></div>
    <div><dt>Espaço utilizado</dt><dd>${(Storage.usage() / 1024).toFixed(1).replace('.', ',')} KB</dd></div>
    <div><dt>Último backup</dt><dd class="${needsBackup ? 'is-warning' : ''}">${last ? DateUtil.formatDateTime(last) : 'Nunca'}${needsBackup ? ' · recomendado' : ''}</dd></div>`;
}

/* ---------- Zoom (tamanho da tela) ----------
   No aplicativo o zoom é aplicado pelo Electron (window.rdcApp).
   No navegador comum vale o zoom do próprio navegador (Ctrl + / Ctrl −). */
const Zoom = {
  get available() {
    return Boolean(window.rdcApp && typeof window.rdcApp.setZoom === 'function');
  },

  apply() {
    if (this.available) window.rdcApp.setZoom(state.prefs.zoom);
    this.render();
  },

  set(level) {
    if (!CONFIG.ZOOM_LEVELS.includes(level) || level === state.prefs.zoom) return;
    state.prefs.zoom = level;
    savePrefs();
    this.apply();
  },

  /** direction: 1 aumenta, -1 diminui. */
  step(direction) {
    const levels = CONFIG.ZOOM_LEVELS;
    const index = levels.indexOf(state.prefs.zoom);
    const next = levels[Math.min(levels.length - 1, Math.max(0, index + direction))];
    this.set(next);
  },

  render() {
    const level = state.prefs.zoom;
    const available = this.available;
    const levels = CONFIG.ZOOM_LEVELS;
    $('#zoom-value').textContent = `${Math.round(level * 100)}%`;
    $('#zoom-out').disabled = !available || level === levels[0];
    $('#zoom-in').disabled = !available || level === levels[levels.length - 1];
    $('#zoom-reset').disabled = !available || level === 1;
    $$('#zoom-presets [data-zoom]').forEach((button) => {
      button.disabled = !available;
      button.setAttribute('aria-pressed', String(Number(button.dataset.zoom) === level));
    });
    $('#zoom-hint').innerHTML = available
      ? 'Atalhos: <kbd>Ctrl</kbd> <kbd>+</kbd> aumenta, <kbd>Ctrl</kbd> <kbd>−</kbd> diminui, <kbd>Ctrl</kbd> <kbd>0</kbd> volta para 100%. Também funciona com <kbd>Ctrl</kbd> + rodinha do mouse.'
      : 'No navegador, use o zoom do próprio navegador: <kbd>Ctrl</kbd> <kbd>+</kbd>, <kbd>Ctrl</kbd> <kbd>−</kbd> e <kbd>Ctrl</kbd> <kbd>0</kbd>.';
  },
};

function renderMessagePreview() {
  const template = $('#message-template').value || DEFAULT_MESSAGE;
  const latest = [...state.services].sort((a, b) => b.date.localeCompare(a.date))[0];
  // Sem cadastros, mostra as variáveis em destaque em vez de dados inventados
  $('#message-preview').textContent = latest
    ? buildMessage(latest, template)
    : template.replace(/\{(nome_completo|nome|veiculo|servico|data)\}/g, (_, key) => `[${key}]`);
}

function saveTemplate() {
  const value = $('#message-template').value.trim();
  if (!value) {
    toast('A mensagem não pode ficar vazia.', 'error');
    return;
  }
  state.prefs.messageTemplate = value.slice(0, 1000);
  savePrefs();
  renderReactivation(); // links do WhatsApp usam o novo texto
  toast('Mensagem de reativação salva.', 'success');
}

function resetTemplate() {
  $('#message-template').value = DEFAULT_MESSAGE;
  state.prefs.messageTemplate = DEFAULT_MESSAGE;
  savePrefs();
  renderMessagePreview();
  renderReactivation();
  toast('Mensagem padrão restaurada.', 'info');
}

/* ==========================================================
   18. EVENTOS GLOBAIS E INICIALIZAÇÃO
   ========================================================== */
/** Re-renderiza todos os componentes após qualquer alteração. */
function renderAll() {
  renderHeader();
  renderOverview();
  renderHistory();
  renderReactivation();
  renderReports();
  renderSettings();
  renderClientSuggestions();
  if (state.editingId && !findService(state.editingId)) cancelEditing({ silent: true });
}

/** Recalcula alertas quando o dia muda com o painel aberto. */
function checkDayChange() {
  const today = DateUtil.todayKey();
  if (today === state.todayKey) return;
  state.todayKey = today;
  $('#f-date').max = today;
  renderAll();
  updateReactivationPreview();
  const pending = getPendingServices().length;
  if (pending) toast(`Novo dia: ${plural(pending, 'retorno pendente', 'retornos pendentes')}.`, 'info', 6000);
}

function bindEvents() {
  // Navegação
  window.addEventListener('hashchange', () => showRoute(getRouteFromHash()));
  $('#menu-toggle').addEventListener('click', openSidebar);
  $('#sidebar-close').addEventListener('click', closeSidebar);
  $('#sidebar-overlay').addEventListener('click', closeSidebar);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#sidebar').classList.contains('is-open')) closeSidebar();
  });
  $('#quick-add').addEventListener('click', () => {
    if (state.editingId) cancelEditing({ silent: true });
    navigate('registrar');
  });

  // Ações delegadas (botões gerados dinamicamente)
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const { action, id } = target.dataset;
    switch (action) {
      case 'view': showServiceDetails(id); break;
      case 'edit': startEditing(id); break;
      case 'delete': requestDelete(id); break;
      case 'copy-message': copyMessage(id, target); break;
      // O próprio link abre o WhatsApp; aqui só mostramos a dica
      case 'open-whatsapp': if (findService(id)) showWhatsappHint(findService(id)); break;
      case 'mark-contacted': markContacted(id); break;
      case 'reopen-alert': reopenAlert(id); break;
      case 'reset-history': resetHistoryFilters(); break;
      case 'goto-reactivation':
        state.prefs.reactivationTab = target.dataset.tab;
        savePrefs();
        renderReactivation();
        navigate('reativar');
        break;
      default: break;
    }
  });

  // Visão geral
  $('#overview-period').addEventListener('click', (e) => {
    const button = e.target.closest('[data-period]');
    if (!button) return;
    state.prefs.overviewPeriod = button.dataset.period;
    savePrefs();
    renderOverview();
  });

  // Formulário
  const form = $('#service-form');
  const f = getFormElements();
  form.addEventListener('submit', handleFormSubmit);
  $('#form-clear').addEventListener('click', () => { resetForm(); f.clientName.focus(); });
  $('#form-cancel').addEventListener('click', () => { cancelEditing(); navigate('historico'); });
  f.phone.addEventListener('input', () => { f.phone.value = Phone.mask(f.phone.value); });
  f.value.addEventListener('input', () => { f.value.value = f.value.value.replace(/[^\d.,]/g, ''); });
  f.value.addEventListener('blur', () => {
    const cents = Money.parse(f.value.value);
    if (cents !== null && cents > 0) f.value.value = Money.toInput(cents);
  });
  f.date.addEventListener('input', updateReactivationPreview);
  f.date.addEventListener('change', updateReactivationPreview);
  f.clientName.addEventListener('change', prefillFromKnownClient);
  // Remove o destaque de erro assim que o campo é corrigido
  form.addEventListener('input', (e) => {
    const field = e.target.closest('.field');
    if (field && field.classList.contains('is-invalid')) {
      field.classList.remove('is-invalid');
      const error = $('.field__error', field);
      if (error) error.textContent = '';
    }
  });

  // Histórico
  $('#history-search').addEventListener('input', (e) => updateHistoryFilters({ query: e.target.value }));
  $('#history-scope').addEventListener('change', (e) => updateHistoryFilters({ scope: e.target.value }));
  $('#history-sort').addEventListener('change', (e) => updateHistoryFilters({ sort: e.target.value }));
  $('#history-period').addEventListener('click', (e) => {
    const button = e.target.closest('[data-period]');
    if (button) updateHistoryFilters({ period: button.dataset.period, from: '', to: '' });
  });
  const onRangeInput = () => updateHistoryFilters({
    period: $('#history-from').value || $('#history-to').value ? 'custom' : 'all',
    from: $('#history-from').value,
    to: $('#history-to').value,
  });
  $('#history-from').addEventListener('change', onRangeInput);
  $('#history-to').addEventListener('change', onRangeInput);
  $('#history-reset').addEventListener('click', resetHistoryFilters);
  $('#history-export').addEventListener('click', exportHistoryCsv);
  $('#history-more').addEventListener('click', () => {
    state.historyLimit += CONFIG.HISTORY_PAGE_SIZE;
    renderHistory();
  });

  // Reativação: abas com clique e setas do teclado
  const tabs = $('#reactivation-tabs');
  tabs.addEventListener('click', (e) => {
    const button = e.target.closest('[data-tab]');
    if (!button) return;
    state.prefs.reactivationTab = button.dataset.tab;
    savePrefs();
    renderReactivation();
  });
  tabs.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const order = ['pending', 'waiting', 'done'];
    const index = order.indexOf(state.prefs.reactivationTab);
    const next = order[(index + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
    state.prefs.reactivationTab = next;
    savePrefs();
    renderReactivation();
    $(`[data-tab="${next}"]`, tabs).focus();
  });

  // Relatórios
  $('#report-period').addEventListener('change', (e) => updateReportPrefs({ period: e.target.value }));
  $('#report-month').addEventListener('change', (e) => updateReportPrefs({ month: e.target.value }));
  $('#report-from').addEventListener('change', (e) => updateReportPrefs({ from: e.target.value }));
  $('#report-to').addEventListener('change', (e) => updateReportPrefs({ to: e.target.value }));
  $('#report-export-detail').addEventListener('click', exportReportDetailCsv);
  $('#report-export-summary').addEventListener('click', exportReportSummaryCsv);

  // Configurações e backup
  $('#backup-export').addEventListener('click', exportBackup);
  $('#backup-import').addEventListener('change', (e) => {
    importBackup(e.target.files[0]);
    e.target.value = ''; // permite importar o mesmo arquivo de novo
  });
  $('#message-template').addEventListener('input', renderMessagePreview);
  $('#whatsapp-mode').addEventListener('change', (e) => {
    state.prefs.whatsappMode = e.target.value === 'app' ? 'app' : 'web';
    savePrefs();
    renderReactivation();
    toast(state.prefs.whatsappMode === 'app'
      ? 'O botão agora abre o aplicativo do WhatsApp instalado no computador.'
      : 'O botão agora abre o WhatsApp Web, sempre na mesma aba.', 'success');
  });
  $('#zoom-out').addEventListener('click', () => Zoom.step(-1));
  $('#zoom-in').addEventListener('click', () => Zoom.step(1));
  $('#zoom-reset').addEventListener('click', () => Zoom.set(1));
  $('#zoom-presets').addEventListener('click', (e) => {
    const button = e.target.closest('[data-zoom]');
    if (button) Zoom.set(Number(button.dataset.zoom));
  });
  // No aplicativo não há menu do navegador, então os atalhos de zoom são tratados aqui
  if (Zoom.available) {
    document.addEventListener('keydown', (e) => {
      if (!e.ctrlKey || e.altKey) return;
      if (['+', '=', 'Add'].includes(e.key) || e.code === 'NumpadAdd') Zoom.step(1);
      else if (['-', '_', 'Subtract'].includes(e.key) || e.code === 'NumpadSubtract') Zoom.step(-1);
      else if (e.key === '0' || e.code === 'Numpad0') Zoom.set(1);
      else return;
      e.preventDefault();
    });
    document.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      Zoom.step(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }
  $('#template-save').addEventListener('click', saveTemplate);
  $('#template-reset').addEventListener('click', resetTemplate);
  $('#data-clear').addEventListener('click', clearAllData);

  // Alertas: recalcula ao voltar para a aba e periodicamente (virada do dia)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayChange(); });
  setInterval(checkDayChange, 60 * 1000);

  // Mantém várias abas abertas sincronizadas
  window.addEventListener('storage', (e) => {
    if (e.key === CONFIG.STORAGE_KEYS.services) {
      state.services = loadServices().services;
      renderAll();
      toast('Dados atualizados a partir de outra aba.', 'info');
    } else if (e.key === CONFIG.STORAGE_KEYS.prefs) {
      state.prefs = loadPrefs();
      renderAll();
      renderSettings(true);
      Zoom.apply();
    }
  });
}

function init() {
  Modal.init();
  state.prefs = loadPrefs();
  const { services, warning } = loadServices();
  state.services = services;

  $('#f-date').max = state.todayKey;
  resetForm();
  setFormMode();
  bindEvents();
  renderAll();
  renderSettings(true);
  Zoom.apply();
  showRoute(getRouteFromHash());

  if (warning) toast(warning, 'error', 9000);
  const pending = getPendingServices().length;
  if (pending) {
    toast(`Você tem ${plural(pending, 'cliente', 'clientes')} para reativar.`, 'info', 5000);
  }
}

document.addEventListener('DOMContentLoaded', init);
