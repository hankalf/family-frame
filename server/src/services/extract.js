/**
 * Turns free text ("Your appointment with Dr. Smith is Thursday Aug 14 at
 * 2:30 PM") into a structured appointment.
 *
 * Primary path: Claude via the Anthropic SDK when ANTHROPIC_API_KEY (or an
 * `ant auth login` profile) is available — handles messy real-world wording,
 * reschedule notices, multiple dates.
 * Fallback: chrono-node date parsing — offline, no key needed, decent on
 * plainly-worded English confirmations.
 */
import Anthropic from '@anthropic-ai/sdk';
import * as chrono from 'chrono-node';
import { getSetting } from '../db.js';

const APPOINTMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_appointment', 'title', 'date', 'time', 'end_time', 'location', 'notes', 'confidence'],
  properties: {
    is_appointment: {
      type: 'boolean',
      description: 'True only if the text describes a specific upcoming appointment with a date',
    },
    title: {
      type: 'string',
      description:
        'Short calendar title, e.g. "Dentist — Dr. Smith" or "Physio appointment". Empty string if not an appointment.',
    },
    date: {
      type: 'string',
      description: 'Appointment date as YYYY-MM-DD in the local timezone. Empty string if unknown.',
    },
    time: {
      type: 'string',
      description: 'Start time as 24h HH:MM local. Empty string if no time given (all-day).',
    },
    end_time: {
      type: 'string',
      description: 'End time as 24h HH:MM if stated. Usually empty.',
    },
    location: {
      type: 'string',
      description: 'Clinic/office name and/or address if present, else empty string.',
    },
    notes: {
      type: 'string',
      description: 'Short useful extras: arrive-early instructions, bring documents, phone number. Else empty.',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: 'How confident the extraction is.',
    },
  },
};

let client = null;
function getClient() {
  if (client) return client;
  client = new Anthropic(); // resolves ANTHROPIC_API_KEY / auth profile from env
  return client;
}

export function llmAvailable() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

async function extractWithClaude(text, { sender, subject }) {
  const timezone = getSetting('timezone') || 'UTC';
  const today = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).format(new Date());

  const context = [
    subject ? `Subject: ${subject}` : null,
    sender ? `From: ${sender}` : null,
    '',
    text,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const response = await getClient().beta.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    // Route any safety-classifier decline to the recommended fallback model
    // instead of failing the extraction.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system:
      `You extract medical/dental/personal appointment details from emails and text messages ` +
      `for a family calendar. Today's date is ${today} (timezone ${timezone}). ` +
      `Resolve relative dates ("next Thursday") against today, always into the future. ` +
      `If the message is a cancellation, a reminder without a date, marketing, or otherwise ` +
      `not a concrete upcoming appointment, set is_appointment to false.`,
    messages: [{ role: 'user', content: context }],
    output_config: {
      format: { type: 'json_schema', schema: APPOINTMENT_SCHEMA },
    },
  });

  if (response.stop_reason === 'refusal') {
    // Extremely unlikely for appointment text, but never read content blindly.
    throw new Error('Model declined the request');
  }

  const block = response.content.find((b) => b.type === 'text');
  const parsed = JSON.parse(block.text);
  return { ...parsed, method: 'claude' };
}

function extractWithChrono(text, { subject }) {
  const results = chrono.parse(text, new Date(), { forwardDate: true });
  if (!results.length) {
    return { is_appointment: false, method: 'chrono' };
  }

  // Prefer a result that includes a time-of-day; confirmations usually have one.
  const best = results.find((r) => r.start.isCertain('hour')) || results[0];
  const start = best.start.date();
  const hasTime = best.start.isCertain('hour');

  const pad = (n) => String(n).padStart(2, '0');
  const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const time = hasTime ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : '';

  let endTime = '';
  if (best.end && best.end.isCertain('hour')) {
    const end = best.end.date();
    endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  }

  return {
    is_appointment: true,
    title: (subject || 'Appointment').slice(0, 80),
    date,
    time,
    end_time: endTime,
    location: '',
    notes: '',
    confidence: 'low',
    method: 'chrono',
  };
}

/**
 * Returns the structured appointment (see APPOINTMENT_SCHEMA, plus `method`).
 * Throws only if both paths fail outright.
 */
export async function extractAppointment(text, meta = {}) {
  if (llmAvailable()) {
    try {
      return await extractWithClaude(text, meta);
    } catch (err) {
      console.warn(`[extract] Claude extraction failed (${err.message}); using date parser`);
    }
  }
  return extractWithChrono(text, meta);
}

/** Builds the events-table row fields from an extraction. Returns null if unusable. */
export function extractionToEvent(extracted) {
  if (!extracted?.is_appointment || !/^\d{4}-\d{2}-\d{2}$/.test(extracted.date || '')) return null;

  const allDay = !/^\d{2}:\d{2}$/.test(extracted.time || '');
  let startsAt;
  let endsAt;
  if (allDay) {
    startsAt = extracted.date;
    endsAt = undefined;
  } else {
    // Local wall-clock datetime; the events route treats it in server-local time.
    startsAt = new Date(`${extracted.date}T${extracted.time}:00`).toISOString();
    endsAt = /^\d{2}:\d{2}$/.test(extracted.end_time || '')
      ? new Date(`${extracted.date}T${extracted.end_time}:00`).toISOString()
      : undefined;
  }

  return {
    title: extracted.title || 'Appointment',
    description: extracted.notes || null,
    location: extracted.location || null,
    startsAt,
    endsAt,
    allDay,
    color: getSetting('ingest_default_color') || '#f472b6',
  };
}
