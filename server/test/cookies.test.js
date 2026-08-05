/**
 * Session cookies have to work over LAN http and tunnelled https at the same
 * time. Marking them secure unconditionally is the classic way to break every
 * LAN login the day a tunnel is switched on.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir, startTestServer, createAdmin } from './helpers.js';

useTempDataDir();

let harness;

before(async () => {
  harness = await startTestServer();
  await createAdmin(harness);
});

after(async () => {
  await harness.close();
});

/** Reads the raw Set-Cookie of a fresh login. */
async function loginCookie(headers = {}) {
  const res = await fetch(`${harness.base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ email: 'admin@test.local', password: 'test-password-1234' }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie') || '';
}

describe('session cookie flags', () => {
  it('is not marked secure over plain http on the LAN', async () => {
    const cookie = await loginCookie();
    assert.ok(!/;\s*Secure/i.test(cookie), `should not be Secure over http: ${cookie}`);
  });

  it('is marked secure when a proxy reports https', async () => {
    // What Tailscale serve / cloudflared put in front of us.
    const cookie = await loginCookie({ 'x-forwarded-proto': 'https' });
    assert.ok(/;\s*Secure/i.test(cookie), `should be Secure behind an https proxy: ${cookie}`);
  });

  it('is always httpOnly and lax', async () => {
    const cookie = await loginCookie();
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  });

  it('can be forced on for an https-only deployment', async () => {
    process.env.COOKIE_SECURE = 'true';
    try {
      const cookie = await loginCookie();
      assert.ok(/;\s*Secure/i.test(cookie), 'COOKIE_SECURE=true should force it');
    } finally {
      delete process.env.COOKIE_SECURE;
    }
  });

  it('can be forced off behind a proxy that terminates TLS oddly', async () => {
    process.env.COOKIE_SECURE = 'false';
    try {
      const cookie = await loginCookie({ 'x-forwarded-proto': 'https' });
      assert.ok(!/;\s*Secure/i.test(cookie), 'COOKIE_SECURE=false should force it off');
    } finally {
      delete process.env.COOKIE_SECURE;
    }
  });
});
