const DEFAULT_EVENT_DATE = "2026-08-26";
const DEFAULT_CALL_UTC = "2026-08-26T21:00:00Z";

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatInZone(
  iso: string,
  timeZone: string,
  zoneLabel: string,
): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute} ${zoneLabel}`;
}

export type CatalystCalendar = {
  eventDate: string;
  preEventWindow: string;
  earningsCall: string;
  modelResetWindow: string;
  deliveryWindow: string;
};

export function makeCatalystCalendar(
  eventDate =
    process.env.NVDA_NEXT_EARNINGS_DATE || DEFAULT_EVENT_DATE,
  callUtc =
    process.env.NVDA_NEXT_EARNINGS_CALL_UTC || DEFAULT_CALL_UTC,
): CatalystCalendar {
  return {
    eventDate,
    preEventWindow: `${shiftDate(eventDate, -14)} 至 ${shiftDate(
      eventDate,
      -3,
    )}`,
    earningsCall: `${formatInZone(
      callUtc,
      "America/Los_Angeles",
      "PT",
    )} / ${formatInZone(callUtc, "Asia/Shanghai", "北京")}`,
    modelResetWindow: `${shiftDate(eventDate, 1)} 至 ${shiftDate(
      eventDate,
      2,
    )}`,
    deliveryWindow: `${shiftDate(eventDate, 28)} 至 ${shiftDate(
      eventDate,
      56,
    )}`,
  };
}
