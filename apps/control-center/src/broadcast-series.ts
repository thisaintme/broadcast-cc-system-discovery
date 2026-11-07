/** Reusable wall-clock series. An occurrence identity is (series, original local date),
 * not a batch ID: moved/deleted exceptions survive overlapping generation ranges. */
import { ManagementError, id, only, parseDestinations, text } from './stream-management-model.ts';
import type { DestinationDraft, ManagementState, PlannedDate } from './stream-management-model.ts';
import { berlinInstant, dateNumber, parseRecurrence } from './stream-recurrence.ts';
export interface BroadcastSeries {
  id: string;
  name: string;
  kind: 'service' | 'devotion' | 'custom';
  anchorDate: string;
  time: string;
  timeZone: 'Europe/Berlin';
  weekdays: number[];
  intervalWeeks: number;
  excludeDates: string[];
  destinations: DestinationDraft[];
}
export interface SeriesRange { requestId: string; seriesId: string; from: string; until: string }
export interface SeriesDate extends PlannedDate { disposition: 'new' | 'existing' | 'past'; occurrenceId?: string }
export interface SeriesPreview { series: BroadcastSeries; range: SeriesRange; dates: SeriesDate[]; newCount: number; existingCount: number; pastCount: number }
const DAY = 86400000;
const monday = (n: number): number => n - ((new Date(n).getUTCDay() + 6) % 7) * DAY;
export function parseSeries(raw: unknown): BroadcastSeries {
  const r = only(raw, ['id','name','kind','anchorDate','time','timeZone','weekdays','intervalWeeks','excludeDates','destinations']);
  if (!['service','devotion','custom'].includes(String(r.kind))) throw new ManagementError('input','Choose a broadcast series type.');
  const recurrence = parseRecurrence({startDate:r.anchorDate,time:r.time,timeZone:r.timeZone,weekdays:r.weekdays,intervalWeeks:r.intervalWeeks,excludeDates:r.excludeDates,count:1});
  return {id:id(r.id),name:text(r.name,100),kind:r.kind as BroadcastSeries['kind'],anchorDate:recurrence.startDate,time:recurrence.time,timeZone:recurrence.timeZone,weekdays:recurrence.weekdays,intervalWeeks:recurrence.intervalWeeks,excludeDates:recurrence.excludeDates,destinations:parseDestinations(r.destinations)};
}
export function previewSeries(state: ManagementState, raw: unknown, now = Date.now()): SeriesPreview {
  const r = only(raw, ['requestId','seriesId','from','until']);
  const range: SeriesRange = {requestId:id(r.requestId),seriesId:id(r.seriesId),from:String(r.from),until:String(r.until)};
  const first = dateNumber(range.from), last = dateNumber(range.until);
  if (last < first || last - first > 731 * DAY) throw new ManagementError('range','Choose an inclusive date range of at most two years.');
  const saved = (state.series || []).find(s => s.id === range.seriesId);
  if (!saved) throw new ManagementError('series','Save and select a broadcast series first.');
  const series = parseSeries(saved), anchor = dateNumber(series.anchorDate), base = monday(anchor), dates: SeriesDate[] = [];
  const existing = new Map(state.occurrences.filter(o => o.seriesId === series.id).map(o => [o.originalDate, o]));
  for (let n = Math.max(first, anchor); n <= last; n += DAY) {
    const date = new Date(n).toISOString().slice(0,10), weekday = ((new Date(n).getUTCDay() + 6) % 7) + 1;
    if (!series.weekdays.includes(weekday) || Math.round((monday(n) - base)/(7*DAY)) % series.intervalWeeks !== 0 || series.excludeDates.includes(date)) continue;
    const previous = existing.get(date);
    // Existing occurrences (including deleted/moved ones) must never be recreated.
    if (previous) { dates.push({date,time:previous.time,startsAt:previous.startsAt,disposition:'existing',occurrenceId:previous.id}); continue; }
    const startsAt = berlinInstant(date,series.time); // Reject DST gaps/ambiguities, never shift silently.
    dates.push({date,time:series.time,startsAt,disposition:Date.parse(startsAt)<=now?'past':'new'});
  }
  const newCount=dates.filter(d=>d.disposition==='new').length;
  if (newCount>104) throw new ManagementError('limit','Generate at most 104 new occurrences per batch. Narrow the date range.');
  return {series,range,dates,newCount,existingCount:dates.filter(d=>d.disposition==='existing').length,pastCount:dates.filter(d=>d.disposition==='past').length};
}
