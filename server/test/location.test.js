/**
 * Location abbreviation. Calendar feeds put wildly varied things in this field
 * and it all has to reduce to something readable across a room.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLocation } from '../../web/src/lib/location.js';

describe('formatLocation', () => {
  it('leaves a short name alone', () => {
    assert.equal(formatLocation('Lakeside Dental'), 'Lakeside Dental');
  });

  it('keeps the venue and town, dropping postcode and country', () => {
    assert.equal(
      formatLocation('Lakeside Dental, Springfield, MO, 65801, USA'),
      'Lakeside Dental, Springfield'
    );
  });

  it('names the video service instead of showing a link', () => {
    assert.equal(formatLocation('https://us02web.zoom.us/j/1234567890?pwd=abc'), 'Zoom');
    assert.equal(formatLocation('https://meet.google.com/abc-defg-hij'), 'Google Meet');
    assert.equal(
      formatLocation('https://teams.microsoft.com/l/meetup-join/19%3ameeting'),
      'Teams'
    );
  });

  it('falls back to the host for an unrecognised link', () => {
    assert.equal(formatLocation('https://www.example.org/room/5'), 'example.org');
  });

  it('truncates something very long', () => {
    const result = formatLocation('A'.repeat(80));
    assert.ok(result.length <= 42, `got ${result.length} chars`);
    assert.ok(result.endsWith('…'));
  });

  it('returns null for nothing useful', () => {
    assert.equal(formatLocation(''), null);
    assert.equal(formatLocation(null), null);
    assert.equal(formatLocation('  '), null);
    assert.equal(formatLocation('12345, USA'), null);
  });

  it('drops a UK postcode but keeps the street', () => {
    assert.equal(formatLocation('12 High Street, Oxford, OX1 1AA, UK'), '12 High Street, Oxford');
  });

  it('respects a custom maximum length', () => {
    const result = formatLocation('Springfield Family Medical Center, Springfield', 20);
    assert.ok(result.length <= 20, `got "${result}"`);
  });
});
