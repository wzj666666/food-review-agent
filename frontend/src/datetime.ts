const MS_8H = 8 * 60 * 60 * 1000;

/**
 * 点评时间：后端常见为无时区的 ISO（如 `2026-04-14T15:51:32`），浏览器会按本地解析；
 * 若再 +8 后用 `getUTC*` 在东八区会得到与原来相同的钟面，看起来像「没加 8 小时」。
 * 这里在解析后的时间戳上 +8 小时，再用 **Asia/Shanghai** 取年月日时分，得到稳定的北京时间展示。
 */
export function formatDateTimeBeijing(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const u = new Date(d.getTime() + MS_8H);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(u);
  const v = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")} ${v("hour")}:${v("minute")}`;
}
