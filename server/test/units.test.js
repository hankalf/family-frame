/**
 * Unit tests for the two bits of logic most likely to break silently: recurring
 * calendar expansion and the weather timestamp contract.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir } from './helpers.js';

useTempDataDir();

const { shapeForecastForTest } = await import('../src/services/weather.js');
const ical = (await import('node-ical')).default;

describe('weather shaping', () => {
  const raw = {
    timezone: 'America/Chicago',
    current: {
      time: '2026-08-05T13:00',
      temperature_2m: 93.9,
      apparent_temperature: 100.2,
      relative_humidity_2m: 39,
      is_day: 1,
      precipitation: 0,
      weather_code: 3,
      wind_speed_10m: 4.2,
    },
    hourly: {
      time: ['2026-08-05T11:00', '2026-08-05T12:00', '2026-08-05T13:00', '2026-08-05T14:00'],
      temperature_2m: [88, 91, 94, 95],
      weather_code: [0, 1, 3, 3],
      precipitation_probability: [0, 5, 9, 12],
    },
    daily: {
      time: ['2026-08-05', '2026-08-06'],
      weather_code: [3, 80],
      temperature_2m_max: [95, 100],
      temperature_2m_min: [72, 71],
      sunrise: ['2026-08-05T04:21', '2026-08-06T04:22'],
      sunset: ['2026-08-05T18:16', '2026-08-06T18:15'],
      precipitation_probability_max: [9, 22],
    },
  };

  it('drops hours before the current one without parsing dates', () => {
    const shaped = shapeForecastForTest(raw, 'imperial');
    assert.equal(shaped.hourly.length, 2);
    assert.equal(shaped.hourly[0].time, '2026-08-05T13:00');
  });

  it('passes naive local timestamps through untouched', () => {
    const shaped = shapeForecastForTest(raw, 'imperial');
    const naive = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
    assert.match(shaped.current.time, naive);
    assert.match(shaped.daily[0].sunrise, naive);
    assert.match(shaped.daily[0].sunset, naive);
  });

  it('uses readable unit labels rather than the API spelling', () => {
    assert.equal(shapeForecastForTest(raw, 'imperial').unitLabels.wind, 'mph');
    assert.equal(shapeForecastForTest(raw, 'metric').unitLabels.wind, 'km/h');
  });

  it('keeps the daily rows aligned with their dates', () => {
    const shaped = shapeForecastForTest(raw, 'imperial');
    assert.equal(shaped.daily[0].date, '2026-08-05');
    assert.equal(shaped.daily[0].high, 95);
    assert.equal(shaped.daily[1].low, 71);
  });

  it('survives a response with fields missing', () => {
    const shaped = shapeForecastForTest({ current: {}, hourly: {}, daily: {} }, 'imperial');
    assert.equal(shaped.hourly.length, 0);
    assert.equal(shaped.daily.length, 0);
    assert.equal(shaped.current.temp, null);
  });
});

describe('ics parsing', () => {
  const build = (lines) =>
    ical.parseICS(
      ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...lines, 'END:VCALENDAR'].join('\r\n')
    );

  it('reads a simple timed event', () => {
    const parsed = build([
      'BEGIN:VEVENT',
      'UID:simple@test',
      'DTSTART:20260910T150000Z',
      'DTEND:20260910T160000Z',
      'SUMMARY:Dentist',
      'END:VEVENT',
    ]);
    const event = Object.values(parsed).find((e) => e.type === 'VEVENT');
    assert.equal(event.summary, 'Dentist');
    assert.equal(event.start.toISOString(), '2026-09-10T15:00:00.000Z');
  });

  it('marks all-day events with datetype date', () => {
    const parsed = build([
      'BEGIN:VEVENT',
      'UID:allday@test',
      'DTSTART;VALUE=DATE:20260910',
      'DTEND;VALUE=DATE:20260911',
      'SUMMARY:Holiday',
      'END:VEVENT',
    ]);
    const event = Object.values(parsed).find((e) => e.type === 'VEVENT');
    assert.equal(event.datetype, 'date');
  });

  it('exposes an rrule for recurring events', () => {
    const parsed = build([
      'BEGIN:VEVENT',
      'UID:weekly@test',
      'DTSTART:20260907T090000Z',
      'DTEND:20260907T093000Z',
      'RRULE:FREQ=WEEKLY;COUNT=5',
      'SUMMARY:Standup',
      'END:VEVENT',
    ]);
    const event = Object.values(parsed).find((e) => e.type === 'VEVENT');
    assert.ok(event.rrule, 'expected an rrule');
    const dates = event.rrule.all();
    assert.equal(dates.length, 5);
  });
});
