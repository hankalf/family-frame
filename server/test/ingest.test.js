/**
 * The ingest webhook is set up by a family member on a phone, so it has to
 * accept whatever shape their Shortcut ends up sending.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir, startTestServer, createAdmin } from './helpers.js';

useTempDataDir();

let harness;
let admin;
let hookUrl;

before(async () => {
  harness = await startTestServer();
  admin = await createAdmin(harness);
  const secret = (await admin.get('/ingest/inbox')).data.ingestSecret;
  hookUrl = `${harness.base}/ingest/hook/${secret}`;
});

after(async () => {
  await harness.close();
});

const post = (body, contentType) =>
  fetch(hookUrl, { method: 'POST', headers: { 'content-type': contentType }, body });

describe('ingest webhook body shapes', () => {
  it('accepts JSON with a text field (the iPhone Shortcut default)', async () => {
    const res = await post(
      JSON.stringify({ text: 'Reminder: cleaning with Dr. Reed on March 3 at 10:15 AM.' }),
      'application/json'
    );
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.message, 'should return something readable for Shortcuts to show');
  });

  it('accepts a form-encoded body (Android forwarder apps)', async () => {
    const res = await post(
      new URLSearchParams({ text: 'Appointment April 8 at 2pm', from: '+15550001111' }).toString(),
      'application/x-www-form-urlencoded'
    );
    assert.equal(res.status, 201);
  });

  it('accepts a bare plain-text body', async () => {
    const res = await post('Your visit is booked for May 12 at 9:30 AM.', 'text/plain');
    assert.equal(res.status, 201);
  });

  it('accepts the alternate field names', async () => {
    for (const field of ['body', 'message', 'content']) {
      const res = await post(
        JSON.stringify({ [field]: `Checkup on June 2 at 11am (${field})` }),
        'application/json'
      );
      assert.equal(res.status, 201, `field "${field}" should be accepted`);
    }
  });

  it('explains itself when the text is missing', async () => {
    const res = await post(JSON.stringify({ nope: 'x' }), 'application/json');
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /text/i);
  });

  it('rejects a wrong secret', async () => {
    const res = await fetch(`${harness.base}/ingest/hook/not-the-secret`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    assert.equal(res.status, 401);
  });

  it('lands the message in the review queue', async () => {
    const inbox = (await admin.get('/ingest/inbox')).data;
    assert.ok(inbox.items.length > 0);
    assert.ok(inbox.items.every((i) => i.source === 'sms'));
  });
});
