import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_TIMEZONE, TimeNormalizationError, dateInAppTimezone, normalizeFlashTemporal } from './timezone.js';

test('timezone oficial é America/Fortaleza', () => {
  assert.equal(APP_TIMEZONE, 'America/Fortaleza');
});

test('preserva horário simples como relógio local de Fortaleza', () => {
  assert.deepEqual(normalizeFlashTemporal('08:15'), {
    time: '08:15:00',
    localDate: null,
    kind: 'clock',
  });
});

test('trata datetime sem offset como horário local de Fortaleza', () => {
  assert.deepEqual(normalizeFlashTemporal('2026-09-17T08:15:27.123'), {
    time: '08:15:27',
    localDate: '2026-09-17',
    kind: 'local_datetime',
  });
});

test('converte UTC para America/Fortaleza', () => {
  assert.equal(normalizeFlashTemporal('2026-09-17T11:15:27Z').time, '08:15:27');
});

test('respeita offset explícito e normaliza para America/Fortaleza', () => {
  assert.equal(normalizeFlashTemporal('2026-09-17T12:15:27+01:00').time, '08:15:27');
  assert.equal(normalizeFlashTemporal('2026-09-17T08:15:27-03:00').time, '08:15:27');
});

test('normaliza epoch em segundos e milissegundos', () => {
  const instant = Date.parse('2026-09-17T11:15:27Z');
  assert.equal(normalizeFlashTemporal(instant).time, '08:15:27');
  assert.equal(normalizeFlashTemporal(Math.floor(instant / 1000)).time, '08:15:27');
});

test('não usa parser genérico para formato desconhecido', () => {
  assert.throws(
    () => normalizeFlashTemporal('17/09/2026 08:15'),
    (error) => error instanceof TimeNormalizationError && error.code === 'FLASH_TIME_NORMALIZATION_FAILED',
  );
});

test('calcula a data corrente no fuso de Fortaleza', () => {
  assert.equal(dateInAppTimezone(new Date('2026-09-17T01:00:00Z')), '2026-09-16');
});
