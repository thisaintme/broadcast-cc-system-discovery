import { ManagementError, only, text, id, parseDestinations } from './stream-management-model.ts';
import type { CreationPlan, PlannedDate, Recurrence } from './stream-management-model.ts';
const DAY = 86400000;
const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function dateNumber(value: unknown): number {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new ManagementError('date', 'Use a calendar date in YYYY-MM-DD format.');
    const n = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value || value < '2000-01-01' || value > '2100-12-31')
        throw new ManagementError('date', 'Choose a valid calendar date between 2000 and 2100.');
    return n;
}
export function clock(value: unknown): string {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
        throw new ManagementError('time', 'Use a local time in HH:mm format.');
    return value;
}
export function localParts(instant: number | string): {
    date: string;
    time: string;
} {
    const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(v => [v.type, v.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
/** Reject skipped and repeated wall times rather than silently moving a service. */
export function berlinInstant(date: string, time: string): string {
    const day = dateNumber(date);
    clock(time);
    const [h, m] = time.split(':').map(Number), wall = day + h * 3600000 + m * 60000;
    const offsets = new Set<number>();
    for (const delta of [-36, 0, 36]) {
        const candidate = wall + delta * 3600000, p = localParts(candidate);
        offsets.add(Date.parse(`${p.date}T${p.time}:00Z`) - candidate);
    }
    const matches = [...offsets].map(offset => wall - offset).filter(n => { const p = localParts(n); return p.date === date && p.time === time; });
    if (matches.length !== 1)
        throw new ManagementError('dst', `${date} ${time} is ${matches.length ? 'ambiguous' : 'skipped'} during the Europe/Berlin clock change. Choose another time.`);
    return new Date(matches[0]).toISOString();
}
export function parseRecurrence(raw: unknown): Recurrence {
    const r = only(raw, ['startDate', 'time', 'timeZone', 'weekdays', 'intervalWeeks', 'count', 'until', 'excludeDates']);
    dateNumber(r.startDate);
    clock(r.time);
    if (r.timeZone !== 'Europe/Berlin')
        throw new ManagementError('zone', 'Use Europe/Berlin for this installation.');
    if (!Array.isArray(r.weekdays) || !r.weekdays.length || r.weekdays.length > 7 || r.weekdays.some(x => !Number.isInteger(x) || x < 1 || x > 7) || new Set(r.weekdays).size !== r.weekdays.length)
        throw new ManagementError('recurrence', 'Select distinct weekdays, Monday through Sunday.');
    if (!Number.isInteger(r.intervalWeeks) || Number(r.intervalWeeks) < 1 || Number(r.intervalWeeks) > 52)
        throw new ManagementError('recurrence', 'Repeat every 1 to 52 weeks.');
    if ((r.count !== undefined) === (r.until !== undefined))
        throw new ManagementError('recurrence', 'Choose either an occurrence count or an end date.');
    if (r.count !== undefined && (!Number.isInteger(r.count) || Number(r.count) < 1 || Number(r.count) > 104))
        throw new ManagementError('recurrence', 'Create between 1 and 104 occurrences per batch.');
    if (r.until !== undefined && (dateNumber(r.until) < dateNumber(r.startDate) || dateNumber(r.until) - dateNumber(r.startDate) > 731 * DAY))
        throw new ManagementError('recurrence', 'The end date must be within two years of the start date.');
    if (!Array.isArray(r.excludeDates) || r.excludeDates.length > 200)
        throw new ManagementError('recurrence', 'Invalid excluded dates.');
    const excludes = [...new Set(r.excludeDates.map(x => { dateNumber(x); return x as string; }))].sort();
    return { startDate: r.startDate as string, time: r.time as string, timeZone: 'Europe/Berlin', weekdays: [...r.weekdays].sort((a, b) => a - b), intervalWeeks: r.intervalWeeks as number, ...(r.count !== undefined ? { count: r.count as number } : { until: r.until as string }), excludeDates: excludes };
}
export function expand(rule: Recurrence): PlannedDate[] {
    rule = parseRecurrence(rule);
    const start = dateNumber(rule.startDate), weekday = (new Date(start).getUTCDay() + 6) % 7, monday = start - weekday * DAY;
    const end = rule.until ? dateNumber(rule.until) : start + 731 * DAY, out: PlannedDate[] = [], excluded = new Set(rule.excludeDates);
    for (let day = start; day <= end; day += DAY) {
        const date = new Date(day).toISOString().slice(0, 10), dow = ((new Date(day).getUTCDay() + 6) % 7) + 1;
        if (Math.floor((day - monday) / (7 * DAY)) % rule.intervalWeeks || !rule.weekdays.includes(dow) || excluded.has(date))
            continue;
        out.push({ date, time: rule.time, startsAt: berlinInstant(date, rule.time) });
        if (out.length > 104)
            throw new ManagementError('recurrence', 'This period contains more than 104 occurrences. Shorten the period.');
        if (rule.count && out.length === rule.count)
            break;
    }
    if (!out.length || (rule.count && out.length !== rule.count))
        throw new ManagementError('recurrence', 'The requested occurrences do not fit within two years.');
    return out;
}
export function parsePlan(raw: unknown, now = Date.now()): {
    plan: CreationPlan;
    dates: PlannedDate[];
} {
    const r = only(raw, ['requestId', 'name', 'destinations', 'single', 'recurrence']);
    if ((r.single !== undefined) === (r.recurrence !== undefined))
        throw new ManagementError('input', 'Choose one event or a recurring series.');
    const plan: CreationPlan = { requestId: id(r.requestId), name: text(r.name, 100), destinations: parseDestinations(r.destinations) };
    let dates: PlannedDate[];
    if (r.single !== undefined) {
        const s = only(r.single, ['date', 'time']);
        dateNumber(s.date);
        clock(s.time);
        plan.single = { date: s.date as string, time: s.time as string };
        dates = [{ ...plan.single, startsAt: berlinInstant(plan.single.date, plan.single.time) }];
    }
    else {
        plan.recurrence = parseRecurrence(r.recurrence);
        dates = expand(plan.recurrence);
    }
    if (dates.some(d => Date.parse(d.startsAt) <= now))
        throw new ManagementError('past', 'All new broadcasts must be scheduled in the future.');
    return { plan, dates };
}
export function shiftDate(date: string, days: number): string {
    if (!Number.isInteger(days) || Math.abs(days) > 731)
        throw new ManagementError('date', 'Invalid date shift.');
    const shifted = new Date(dateNumber(date) + days * DAY).toISOString().slice(0, 10);
    dateNumber(shifted);
    return shifted;
}
