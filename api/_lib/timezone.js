export const APP_TIMEZONE = 'America/Fortaleza';

const CLOCK_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?$/;
const LOCAL_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?$/;
const ZONED_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})$/i;
const INTEGER_RE = /^-?\d+$/;
const MIN_EPOCH_SECONDS = 946684800;
const MAX_EPOCH_SECONDS = 4102444800;
const MIN_EPOCH_MS = MIN_EPOCH_SECONDS * 1000;
const MAX_EPOCH_MS = MAX_EPOCH_SECONDS * 1000;

const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const preview = (value) => {
  const text = value instanceof Date ? value.toISOString() : String(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};

export class TimeNormalizationError extends Error {
  constructor(message, { value, field = null } = {}) {
    super(message);
    this.name = 'TimeNormalizationError';
    this.code = 'FLASH_TIME_NORMALIZATION_FAILED';
    this.field = field;
    this.inputType = value instanceof Date ? 'Date' : typeof value;
    this.inputPreview = value === undefined ? null : preview(value);
  }
}

const buildClock = (hour, minute, second = '00') => `${String(hour).padStart(2, '0')}:${minute}:${second || '00'}`;

const isValidDate = (year, month, day) => {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
};

const partsToObject = (parts) => Object.fromEntries(parts.map((part) => [part.type, part.value]));

const formatInstant = (date, context) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TimeNormalizationError('Data/hora inválida recebida da Flash.', context);
  }
  const clockParts = partsToObject(clockFormatter.formatToParts(date));
  const dateParts = partsToObject(dateFormatter.formatToParts(date));
  return {
    time: `${clockParts.hour}:${clockParts.minute}:${clockParts.second}`,
    localDate: `${dateParts.year}-${dateParts.month}-${dateParts.day}`,
    kind: 'instant',
  };
};

const epochToDate = (numericValue, context) => {
  if (!Number.isFinite(numericValue)) {
    throw new TimeNormalizationError('Timestamp numérico inválido recebido da Flash.', context);
  }
  const absolute = Math.abs(numericValue);
  if (absolute >= MIN_EPOCH_MS && absolute <= MAX_EPOCH_MS) return new Date(numericValue);
  if (absolute >= MIN_EPOCH_SECONDS && absolute <= MAX_EPOCH_SECONDS) return new Date(numericValue * 1000);
  throw new TimeNormalizationError('Timestamp numérico fora do intervalo suportado (2000-2100).', context);
};

const zonedMatchToDate = (match, context) => {
  const [, year, month, day, hour, minute, second = '00', fraction = '', rawZone] = match;
  if (!isValidDate(year, month, day)) {
    throw new TimeNormalizationError('Data inválida recebida da Flash.', context);
  }
  const milliseconds = fraction ? `.${fraction.slice(0, 3).padEnd(3, '0')}` : '';
  const zone = rawZone.toUpperCase() === 'Z'
    ? 'Z'
    : `${rawZone.slice(0, 3)}:${rawZone.replace(':', '').slice(3, 5)}`;
  const canonical = `${year}-${month}-${day}T${hour}:${minute}:${second}${milliseconds}${zone}`;
  const parsed = new Date(canonical);
  if (Number.isNaN(parsed.getTime())) {
    throw new TimeNormalizationError('Data/hora com fuso inválida recebida da Flash.', context);
  }
  return parsed;
};

/**
 * @typedef {'clock'|'local_datetime'|'instant'|'epoch'} FlashTemporalKind
 * @typedef {{time: string, localDate: string|null, kind: FlashTemporalKind}} NormalizedFlashTemporal
 */

/**
 * Normaliza horários da Flash para o relógio oficial do sistema (America/Fortaleza).
 * - HH:mm[:ss] é tratado como horário de parede já expresso no fuso da aplicação.
 * - Data/hora sem offset é tratada como horário local de America/Fortaleza.
 * - Data/hora com Z/offset e epoch representam instantes e são convertidos para America/Fortaleza.
 * Valores fora desse contrato geram erro explícito; não há Date.parse genérico nem fallback de fuso do servidor.
 *
 * @param {string|number|Date} value
 * @param {{field?: string|null}} [context]
 * @returns {NormalizedFlashTemporal}
 */
export function normalizeFlashTemporal(value, context = {}) {
  const errorContext = { value, field: context.field || null };

  if (value instanceof Date) return formatInstant(value, errorContext);

  if (typeof value === 'number') {
    const date = epochToDate(value, errorContext);
    return { ...formatInstant(date, errorContext), kind: 'epoch' };
  }

  if (typeof value !== 'string') {
    throw new TimeNormalizationError('Tipo de horário não suportado recebido da Flash.', errorContext);
  }

  const raw = value.trim();
  if (!raw) throw new TimeNormalizationError('Horário vazio recebido da Flash.', errorContext);

  const clockMatch = raw.match(CLOCK_RE);
  if (clockMatch) {
    return {
      time: buildClock(clockMatch[1], clockMatch[2], clockMatch[3]),
      localDate: null,
      kind: 'clock',
    };
  }

  const localDateTimeMatch = raw.match(LOCAL_DATE_TIME_RE);
  if (localDateTimeMatch) {
    const [, year, month, day, hour, minute, second = '00'] = localDateTimeMatch;
    if (!isValidDate(year, month, day)) {
      throw new TimeNormalizationError('Data local inválida recebida da Flash.', errorContext);
    }
    return {
      time: buildClock(hour, minute, second),
      localDate: `${year}-${month}-${day}`,
      kind: 'local_datetime',
    };
  }

  const zonedDateTimeMatch = raw.match(ZONED_DATE_TIME_RE);
  if (zonedDateTimeMatch) {
    return formatInstant(zonedMatchToDate(zonedDateTimeMatch, errorContext), errorContext);
  }

  if (INTEGER_RE.test(raw)) {
    const numeric = Number(raw);
    const date = epochToDate(numeric, errorContext);
    return { ...formatInstant(date, errorContext), kind: 'epoch' };
  }

  throw new TimeNormalizationError(
    'Formato de horário não suportado. Esperado HH:mm[:ss], ISO/RFC3339 com ou sem offset, ou epoch.',
    errorContext,
  );
}

/** @param {Date} [date] */
export function dateInAppTimezone(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TimeNormalizationError('Data inválida ao calcular o dia em America/Fortaleza.', { value: date });
  }
  const parts = partsToObject(dateFormatter.formatToParts(date));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
