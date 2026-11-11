import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReading, getTodayString } from '../src/validation.js';

const today = getTodayString();

const futureDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('Validation: requires a glucose value', () => {
  assert.equal(validateReading({ date: today, slot: 'morning', value: '' }), 'Please enter a glucose value.');
  assert.equal(validateReading({ date: today, slot: 'morning', value: null }), 'Please enter a glucose value.');
  assert.equal(validateReading({ date: today, slot: 'morning', value: undefined }), 'Please enter a glucose value.');
  assert.equal(validateReading({ date: today, slot: 'morning', value: '   ' }), 'Please enter a glucose value.');
});

test('Validation: rejects values outside 40–600 mg/dl', () => {
  assert.equal(validateReading({ date: today, slot: 'morning', value: 39 }), 'Value must be between 40 and 600 mg/dl.');
  assert.equal(validateReading({ date: today, slot: 'morning', value: 0 }), 'Value must be between 40 and 600 mg/dl.');
  assert.equal(validateReading({ date: today, slot: 'morning', value: -10 }), 'Value must be between 40 and 600 mg/dl.');
  assert.equal(validateReading({ date: today, slot: 'morning', value: 601 }), 'Value must be between 40 and 600 mg/dl.');
  assert.equal(validateReading({ date: today, slot: 'morning', value: 1000 }), 'Value must be between 40 and 600 mg/dl.');
});

test('Validation: rejects non-integer values', () => {
  assert.equal(validateReading({ date: today, slot: 'morning', value: 120.5 }), 'Value must be between 40 and 600 mg/dl.');
  assert.equal(validateReading({ date: today, slot: 'morning', value: '110.2' }), 'Value must be between 40 and 600 mg/dl.');
  assert.equal(validateReading({ date: today, slot: 'morning', value: '120.0' }), 'Value must be between 40 and 600 mg/dl.');
  assert.equal(validateReading({ date: today, slot: 'morning', value: '1e2' }), 'Value must be between 40 and 600 mg/dl.');
  assert.equal(validateReading({ date: today, slot: 'morning', value: 'abc' }), 'Value must be between 40 and 600 mg/dl.');
  assert.equal(validateReading({ date: today, slot: 'morning', value: true }), 'Value must be between 40 and 600 mg/dl.');
});

test('Validation: rejects future dates', () => {
  assert.equal(validateReading({ date: futureDate(), slot: 'morning', value: 100 }), 'Date cannot be in the future.');
});

test('Validation: rejects invalid date formats', () => {
  assert.equal(validateReading({ date: 'invalid-date', slot: 'morning', value: 100 }), 'Please enter a valid date.');
  assert.equal(validateReading({ date: '', slot: 'morning', value: 100 }), 'Please enter a valid date.');
  assert.equal(validateReading({ date: '2026-02-31', slot: 'morning', value: 100 }), 'Please enter a valid date.');
});

test('Validation: rejects invalid time slots', () => {
  assert.equal(validateReading({ date: today, slot: 'midnight_snack', value: 100 }), 'Please select a valid time slot.');
});

test('Validation: accepts valid reading for all 4 slots', () => {
  assert.equal(validateReading({ date: today, slot: 'morning', value: 95 }), null);
  assert.equal(validateReading({ date: today, slot: 'after_breakfast', value: 140 }), null);
  assert.equal(validateReading({ date: today, slot: 'after_lunch', value: 135 }), null);
  assert.equal(validateReading({ date: today, slot: 'after_dinner', value: 125 }), null);
  assert.equal(validateReading({ date: today, slot: 'Morning (fasting)', value: 40 }), null);
  assert.equal(validateReading({ date: today, slot: 'After dinner', value: 600 }), null);
});

test('Validation: handles non-object and inclusive boundary inputs safely', () => {
  assert.equal(validateReading(null), 'Please enter valid reading details.');
  assert.equal(validateReading(undefined), 'Please enter valid reading details.');
  assert.equal(validateReading([]), 'Please enter valid reading details.');
  assert.equal(validateReading('invalid'), 'Please enter valid reading details.');
  assert.equal(validateReading({ date: today, slot: 'morning', value: '40' }), null);
  assert.equal(validateReading({ date: today, slot: 'morning', value: '600' }), null);
});
