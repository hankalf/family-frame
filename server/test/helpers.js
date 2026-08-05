import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Each test file gets its own throwaway DATA_DIR. This must be set before
 * anything imports db.js, since that opens the database at module load.
 */
export function useTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-test-'));
  process.env.DATA_DIR = dir;
  process.env.JWT_SECRET = 'test-secret-not-used-anywhere-real';
  return dir;
}

/** Boots the real app on an ephemeral port and returns a small client. */
export async function startTestServer() {
  const { createApp } = await import('../src/app.js');
  const app = createApp({ serveWeb: false });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  /** Keeps its own cookie jar so several identities can be used at once. */
  const client = () => {
    let cookie = '';
    const request = async (method, route, { body, headers = {}, form } = {}) => {
      const allHeaders = { ...headers };
      if (cookie) allHeaders.cookie = cookie;
      if (body) allHeaders['content-type'] = 'application/json';

      const res = await fetch(`${base}${route}`, {
        method,
        headers: allHeaders,
        body: form || (body ? JSON.stringify(body) : undefined),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    };

    return {
      get: (route, opts) => request('GET', route, opts),
      post: (route, body, opts) => request('POST', route, { body, ...opts }),
      put: (route, body) => request('PUT', route, { body }),
      patch: (route, body) => request('PATCH', route, { body }),
      del: (route) => request('DELETE', route),
      raw: request,
    };
  };

  return {
    base,
    client,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Creates the first admin and returns a signed-in client. */
export async function createAdmin(harness, overrides = {}) {
  const admin = harness.client();
  const res = await admin.post('/auth/setup', {
    name: 'Admin',
    email: 'admin@test.local',
    password: 'test-password-1234',
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`setup failed: ${JSON.stringify(res.data)}`);
  return admin;
}

/** Invites a member with the given permissions and signs them in. */
export async function createMember(harness, admin, { email, canUploadPhotos, canAddEvents }) {
  const invite = await admin.post('/invites', { canUploadPhotos, canAddEvents });
  const member = harness.client();
  const res = await member.post('/auth/register', {
    code: invite.data.code,
    name: email.split('@')[0],
    email,
    password: 'member-password-1234',
  });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.data)}`);
  return member;
}
