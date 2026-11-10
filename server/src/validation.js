export const SLOTS = ['morning', 'after_breakfast', 'after_lunch', 'after_dinner'];

export const SLOT_LABELS = {
  morning: 'Morning (fasting)',
  after_breakfast: 'After breakfast',
  after_lunch: 'After lunch',
  after_dinner: 'After dinner'
};

export const SLOT_MAP = {
  morning: 'morning',
  'Morning (fasting)': 'morning',
  after_breakfast: 'after_breakfast',
  'After breakfast': 'after_breakfast',
  after_lunch: 'after_lunch',
  'After lunch': 'after_lunch',
  after_dinner: 'after_dinner',
  'After dinner': 'after_dinner'
};

export function getTodayString() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

export function isValidCalendarDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const dateObj = new Date(Date.UTC(year, month - 1, day));
  return (
    dateObj.getUTCFullYear() === year &&
    dateObj.getUTCMonth() === month - 1 &&
    dateObj.getUTCDate() === day
  );
}

export function validateReading({ date, slot, value }) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return 'Please enter a glucose value.';
  }

  const num = Number(value);
  if (
    typeof value === 'boolean' ||
    Number.isNaN(num) ||
    !Number.isInteger(num) ||
    num < 40 ||
    num > 600
  ) {
    return 'Value must be between 40 and 600 mg/dl.';
  }

  if (!isValidCalendarDate(date)) {
    return 'Please enter a valid date.';
  }

  const todayString = getTodayString();
  if (date > todayString) {
    return 'Date cannot be in the future.';
  }

  const normalizedSlot = SLOT_MAP[slot];
  if (!normalizedSlot) {
    return 'Please select a valid time slot.';
  }

  return null;
}
