export const APP_TIME_ZONE = "America/Sao_Paulo";
export const APP_TIME_ZONE_OFFSET = "-03:00";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;
const LOCAL_DATE_TIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

type DateParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
};

function normalizeHour(hour: string | undefined) {
  return hour === "24" ? "00" : hour ?? "00";
}

function parseAppDate(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const text = value.trim();
  if (!text) return null;

  if (DATE_ONLY_RE.test(text)) {
    return new Date(`${text}T12:00:00${APP_TIME_ZONE_OFFSET}`);
  }

  if (LOCAL_DATE_TIME_RE.test(text)) {
    const withSeconds = text.length === 16 ? `${text}:00` : text;
    return new Date(`${withSeconds}${APP_TIME_ZONE_OFFSET}`);
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDateParts(value: string | Date | null | undefined): DateParts | null {
  const date = parseAppDate(value);
  if (!date) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: map.year ?? "0000",
    month: map.month ?? "00",
    day: map.day ?? "00",
    hour: normalizeHour(map.hour),
    minute: map.minute ?? "00",
  };
}

export function toAppDate(value: string | Date | null | undefined) {
  return parseAppDate(value);
}

export function toAppDateKey(value: string | Date | null | undefined) {
  const parts = getDateParts(value);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getTodayAppDateKey() {
  return toAppDateKey(new Date());
}

export function getCurrentAppMonthKey() {
  return getTodayAppDateKey().slice(0, 7);
}

export function normalizeAppMonthKey(value: string | null | undefined) {
  if (!value || !MONTH_KEY_RE.test(value)) {
    return getCurrentAppMonthKey();
  }

  return value;
}

export function dateKeyToAppDate(dateKey: string) {
  return parseAppDate(dateKey);
}

export function addDaysToAppDateKey(dateKey: string, days: number) {
  const date = dateKeyToAppDate(dateKey);
  if (!date) return dateKey;

  date.setUTCDate(date.getUTCDate() + days);
  return toAppDateKey(date);
}

export function addMonthsToAppMonthKey(monthKey: string, months: number) {
  const normalized = normalizeAppMonthKey(monthKey);
  const date = parseAppDate(`${normalized}-01`);
  if (!date) return getCurrentAppMonthKey();

  date.setUTCMonth(date.getUTCMonth() + months);
  return toAppDateKey(date).slice(0, 7);
}

export function getMonthDateKeys(monthKey: string) {
  const normalized = normalizeAppMonthKey(monthKey);
  const firstDate = parseAppDate(`${normalized}-01`);
  if (!firstDate) return [];

  const firstKey = toAppDateKey(firstDate);
  const firstWeekday = new Date(`${firstKey}T12:00:00${APP_TIME_ZONE_OFFSET}`).getUTCDay();
  const nextMonthKey = addMonthsToAppMonthKey(normalized, 1);
  const lastKey = addDaysToAppDateKey(`${nextMonthKey}-01`, -1);
  const daysInMonth = Number(lastKey.slice(-2));
  const visibleCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const gridStart = addDaysToAppDateKey(firstKey, -firstWeekday);

  return Array.from({ length: visibleCells }, (_, index) => {
    return addDaysToAppDateKey(gridStart, index);
  });
}

export function getMonthQueryRange(monthKey: string) {
  const keys = getMonthDateKeys(monthKey);
  const startKey = keys[0] ?? `${normalizeAppMonthKey(monthKey)}-01`;
  const lastKey = keys[keys.length - 1] ?? startKey;
  const endKey = addDaysToAppDateKey(lastKey, 1);

  return {
    startIso: `${startKey}T00:00:00${APP_TIME_ZONE_OFFSET}`,
    endIso: `${endKey}T00:00:00${APP_TIME_ZONE_OFFSET}`,
  };
}

export function getWeekDateKeys(dateKey: string) {
  const date = dateKeyToAppDate(dateKey);
  if (!date) return [];

  const key = toAppDateKey(date);
  const weekday = new Date(`${key}T12:00:00${APP_TIME_ZONE_OFFSET}`).getUTCDay();
  const start = addDaysToAppDateKey(key, -weekday);

  return Array.from({ length: 7 }, (_, index) => {
    return addDaysToAppDateKey(start, index);
  });
}

export function getWeekQueryRange(dateKey: string) {
  const keys = getWeekDateKeys(dateKey);
  const startKey = keys[0] ?? dateKey;
  const lastKey = keys[keys.length - 1] ?? startKey;
  const endKey = addDaysToAppDateKey(lastKey, 1);

  return {
    startIso: `${startKey}T00:00:00${APP_TIME_ZONE_OFFSET}`,
    endIso: `${endKey}T00:00:00${APP_TIME_ZONE_OFFSET}`,
  };
}

export function getDayQueryRange(dateKey: string) {
  const endKey = addDaysToAppDateKey(dateKey, 1);

  return {
    startIso: `${dateKey}T00:00:00${APP_TIME_ZONE_OFFSET}`,
    endIso: `${endKey}T00:00:00${APP_TIME_ZONE_OFFSET}`,
  };
}

export function formatDateTime(value: string | null) {
  const parts = getDateParts(value);
  if (!parts) return "-";

  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

export function formatShortDate(value: string | null) {
  const parts = getDateParts(value);
  if (!parts) return "-";

  return `${parts.day}/${parts.month}`;
}

export function formatDate(value: string | null) {
  const parts = getDateParts(value);
  if (!parts) return "-";

  return `${parts.day}/${parts.month}/${parts.year}`;
}

export function formatTime(value: string | null) {
  const parts = getDateParts(value);
  if (!parts) return "-";

  return `${parts.hour}:${parts.minute}`;
}

export function formatLongDate(value: string | Date | null | undefined) {
  const date = parseAppDate(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: APP_TIME_ZONE,
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(date);
}

export function formatWeekdayShort(value: string | Date | null | undefined) {
  const date = parseAppDate(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: APP_TIME_ZONE,
    weekday: "short",
  })
    .format(date)
    .replace(".", "");
}

export function formatDayNumber(value: string | Date | null | undefined) {
  const parts = getDateParts(value);
  return parts?.day ?? "--";
}

export function formatMonthShort(value: string | Date | null | undefined) {
  const date = parseAppDate(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: APP_TIME_ZONE,
    month: "short",
  })
    .format(date)
    .replace(".", "");
}

export function formatMonthTitle(monthKey: string) {
  const date = parseAppDate(`${normalizeAppMonthKey(monthKey)}-01`);
  if (!date) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: APP_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatDateTimeLocalInput(value: string | Date | null | undefined) {
  const parts = getDateParts(value);
  if (!parts) return "";

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function defaultDateTimeLocalForDateKey(dateKey: string | null | undefined) {
  const value = dateKey ?? "";
  const normalized = DATE_ONLY_RE.test(value) ? value : getTodayAppDateKey();

  return `${normalized}T09:00`;
}

export function localDateTimeToIso(value: string) {
  const text = value.trim();
  const date = parseAppDate(text);
  if (!date) return "";

  return date.toISOString();
}
