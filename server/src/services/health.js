/**
 * Health checks and alerting. Everything in this app already records *why* it
 * failed — feeds keep `last_error`, weather keeps `last_error`, displays have a
 * `last_seen`. What was missing is anything that looks at all of it and tells
 * you. This collects the signals and can email a digest.
 */
import nodemailer from 'nodemailer';
import { db, getSetting, setSetting } from '../db.js';
import { ONLINE_WINDOW_MS } from '../routes/displays.js';
import { getCachedWeather } from './weather.js';
import { backupIsStale, listBackups } from './backup.js';

const OFFLINE_ALERT_MS = 60 * 60 * 1000; // an hour dark is worth an email

/** Gathers the current state of everything that can quietly break. */
export function buildHealthReport() {
  const issues = [];

  const feeds = db.prepare('SELECT name, last_error, last_fetch_at FROM feeds WHERE enabled = 1').all();
  for (const feed of feeds) {
    if (feed.last_error) {
      issues.push({
        level: 'error',
        area: 'calendar',
        message: `Calendar "${feed.name}" is failing to update: ${feed.last_error}`,
      });
    }
  }

  const weather = getCachedWeather();
  if (weather.error) {
    issues.push({ level: 'warn', area: 'weather', message: `Weather update failed: ${weather.error}` });
  } else if (weather.stale) {
    issues.push({ level: 'warn', area: 'weather', message: 'Weather data is stale.' });
  }

  const gmailConfigured = !!(getSetting('gmail_address') || '').trim();
  const gmailError = getSetting('gmail_last_error');
  if (gmailConfigured && gmailError) {
    issues.push({
      level: 'error',
      area: 'appointments',
      message: `Appointment mailbox is failing: ${gmailError}`,
    });
  }

  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  const displays = db.prepare('SELECT id, name, last_seen FROM displays').all();
  const offline = displays.filter((d) => new Date(d.last_seen).getTime() < cutoff);
  for (const display of offline) {
    issues.push({
      level: 'warn',
      area: 'display',
      message: `Display "${display.name || display.id.slice(0, 6)}" hasn't checked in since ${new Date(display.last_seen).toLocaleString()}.`,
    });
  }

  if (getSetting('backup_enabled') === 'true' && backupIsStale()) {
    issues.push({
      level: 'error',
      area: 'backup',
      message: 'No successful backup in the last two days.',
    });
  }

  const pending = db.prepare("SELECT COUNT(*) AS n FROM photos WHERE status = 'pending'").get().n;
  const review = db
    .prepare("SELECT COUNT(*) AS n FROM inbox_items WHERE status = 'needs_review'").get().n;
  if (pending > 0) {
    issues.push({ level: 'info', area: 'photos', message: `${pending} photo(s) waiting for approval.` });
  }
  if (review > 0) {
    issues.push({
      level: 'info',
      area: 'appointments',
      message: `${review} appointment(s) waiting for review.`,
    });
  }

  const backups = listBackups().backups;
  return {
    checkedAt: new Date().toISOString(),
    ok: !issues.some((i) => i.level === 'error'),
    issues,
    stats: {
      photos: db.prepare("SELECT COUNT(*) AS n FROM photos WHERE status = 'approved'").get().n,
      events: db.prepare('SELECT COUNT(*) AS n FROM events').get().n,
      users: db.prepare('SELECT COUNT(*) AS n FROM users WHERE disabled = 0').get().n,
      displays: displays.length,
      displaysOnline: displays.length - offline.length,
      lastBackupAt: backups[0]?.createdAt ?? null,
      backupCount: backups.length,
    },
  };
}

/**
 * Sends mail through the same Gmail account already configured for appointment
 * intake — no second credential to manage.
 */
async function sendMail(subject, body) {
  const user = (getSetting('gmail_address') || '').trim();
  const pass = (getSetting('gmail_app_password') || '').replace(/\s+/g, '');
  const to = (getSetting('alert_email') || '').trim() || user;
  if (!user || !pass || !to) return { skipped: true, reason: 'Email is not configured' };

  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  await transport.sendMail({
    from: `Family Frame <${user}>`,
    to,
    subject,
    text: body,
  });
  return { ok: true, to };
}

function formatReport(report) {
  const lines = [];
  lines.push(report.ok ? 'Everything looks healthy.' : 'Some things need attention:');
  lines.push('');
  for (const issue of report.issues) {
    lines.push(`${issue.level === 'error' ? '[!]' : issue.level === 'warn' ? '[~]' : '[i]'} ${issue.message}`);
  }
  if (!report.issues.length) lines.push('No issues found.');
  lines.push('');
  lines.push('---');
  lines.push(
    `${report.stats.photos} photos · ${report.stats.events} events · ` +
      `${report.stats.displaysOnline}/${report.stats.displays} displays online`
  );
  lines.push(
    report.stats.lastBackupAt
      ? `Last backup: ${new Date(report.stats.lastBackupAt).toLocaleString()} (${report.stats.backupCount} kept)`
      : 'Last backup: never'
  );
  return lines.join('\n');
}

export async function sendHealthDigest() {
  const report = buildHealthReport();
  const subject = report.ok
    ? 'Family Frame — all good'
    : `Family Frame — ${report.issues.filter((i) => i.level === 'error').length} thing(s) need attention`;
  const result = await sendMail(subject, formatReport(report));
  if (result.ok) setSetting('alert_last_sent', new Date().toISOString());
  return { ...result, report };
}

let timer = null;

/**
 * One loop handles both jobs: an immediate alert the first time a display goes
 * dark for an hour, and a weekly digest. Alert state is stored in settings so a
 * restart doesn't re-send.
 */
export function startHealthMonitoring() {
  const run = async () => {
    try {
      if (getSetting('alerts_enabled') === 'true') {
        const report = buildHealthReport();

        // Immediate: a display that stopped checking in.
        const cutoff = Date.now() - OFFLINE_ALERT_MS;
        const dark = db
          .prepare('SELECT id, name, last_seen FROM displays')
          .all()
          .filter((d) => new Date(d.last_seen).getTime() < cutoff);
        const alerted = new Set((getSetting('alerted_displays') || '').split(',').filter(Boolean));
        const newlyDark = dark.filter((d) => !alerted.has(d.id));
        const recovered = [...alerted].filter((id) => !dark.some((d) => d.id === id));

        if (newlyDark.length) {
          await sendMail(
            'Family Frame — a display went offline',
            `${newlyDark.map((d) => `"${d.name || d.id.slice(0, 6)}" last checked in ${new Date(d.last_seen).toLocaleString()}`).join('\n')}\n\nIt may just be powered off.`
          ).catch((err) => console.error('[health] alert failed:', err.message));
        }
        if (newlyDark.length || recovered.length) {
          setSetting('alerted_displays', dark.map((d) => d.id).join(','));
        }

        // Weekly digest.
        const lastSent = getSetting('alert_last_sent');
        const weekMs = 7 * 24 * 60 * 60 * 1000;
        if (!lastSent || Date.now() - new Date(lastSent).getTime() > weekMs) {
          await sendHealthDigest().catch((err) =>
            console.error('[health] digest failed:', err.message)
          );
        }

        if (!report.ok) {
          console.warn(`[health] ${report.issues.filter((i) => i.level === 'error').length} error(s)`);
        }
      }
    } catch (err) {
      console.error('[health]', err);
    }
    timer = setTimeout(run, 15 * 60 * 1000);
    timer.unref?.();
  };
  timer = setTimeout(run, 90_000);
  timer.unref?.();
}

export function stopHealthMonitoring() {
  if (timer) clearTimeout(timer);
  timer = null;
}
