export const MANILA_TIME_ZONE = 'Asia/Manila';

const MANILA_OFFSET_MINUTES = 8 * 60;
const MANILA_OFFSET_MS = MANILA_OFFSET_MINUTES * 60 * 1000;

function padDateTimePart(value) {
  return String(value).padStart(2, '0');
}

function getManilaPartsFromDate(date) {
  const shiftedDate = new Date(date.getTime() + MANILA_OFFSET_MS);

  return {
    year: shiftedDate.getUTCFullYear(),
    month: shiftedDate.getUTCMonth() + 1,
    day: shiftedDate.getUTCDate(),
    hour: shiftedDate.getUTCHours(),
    minute: shiftedDate.getUTCMinutes(),
    second: shiftedDate.getUTCSeconds(),
    millisecond: shiftedDate.getUTCMilliseconds(),
  };
}

function buildDateFromManilaParts({
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
}) {
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - MANILA_OFFSET_MS,
  );
}

export function getCurrentManilaDateTimeValue(date = new Date()) {
  const parts = getManilaPartsFromDate(date);

  return [
    parts.year,
    padDateTimePart(parts.month),
    padDateTimePart(parts.day),
  ].join('-') + `T${padDateTimePart(parts.hour)}:${padDateTimePart(parts.minute)}`;
}

export function splitReceiptDateTimeInputValue(value) {
  const inputValue = toReceiptDateTimeInputValue(value);
  const [datePart = '', timePart = '00:00'] = inputValue.split('T');

  return {
    date: datePart,
    time: timePart.slice(0, 5) || '00:00',
  };
}

export function combineReceiptDateAndTime(dateValue, timeValue) {
  const safeDate = String(dateValue || '').trim();
  if (!safeDate) return '';

  const safeTime = String(timeValue || '').trim() || '00:00';
  return `${safeDate}T${safeTime.slice(0, 5)}`;
}

export function parseReceiptDateValue(value) {
  if (!value) return null;

  const rawValue = String(value).trim();
  const manilaDateTimeMatch = rawValue.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i,
  );

  if (manilaDateTimeMatch) {
    const [
      ,
      year,
      month,
      day,
      hour = '00',
      minute = '00',
      second = '00',
      millisecond = '0',
    ] = manilaDateTimeMatch;

    return buildDateFromManilaParts({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
      millisecond: Number(millisecond.padEnd(3, '0').slice(0, 3)),
    });
  }

  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatReceiptDateValue(value) {
  if (!value) return 'N/A';

  const parsed = parseReceiptDateValue(value);
  if (!parsed) return String(value);

  const hasTime = /T|\d:\d/.test(String(value));

  return hasTime
    ? parsed.toLocaleString('en-PH', {
      timeZone: MANILA_TIME_ZONE,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    : parsed.toLocaleDateString('en-PH', {
      timeZone: MANILA_TIME_ZONE,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
}

export function toReceiptDateTimeInputValue(value) {
  const parsed = parseReceiptDateValue(value);
  return parsed ? getCurrentManilaDateTimeValue(parsed) : getCurrentManilaDateTimeValue();
}
