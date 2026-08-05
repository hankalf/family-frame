import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir, startTestServer, createAdmin, createMember } from './helpers.js';

useTempDataDir();

let harness;
let admin;
let uploader; // photos only
let planner; // events only
let viewer; // neither
let displayToken;

before(async () => {
  harness = await startTestServer();
  admin = await createAdmin(harness);

  uploader = await createMember(harness, admin, {
    email: 'uploader@test.local',
    canUploadPhotos: true,
    canAddEvents: false,
  });
  planner = await createMember(harness, admin, {
    email: 'planner@test.local',
    canUploadPhotos: false,
    canAddEvents: true,
  });
  viewer = await createMember(harness, admin, {
    email: 'viewer@test.local',
    canUploadPhotos: false,
    canAddEvents: false,
  });

  displayToken = (await admin.get('/settings')).data.displayToken;
});

after(async () => {
  await harness.close();
});

describe('setup', () => {
  it('refuses a second setup once an admin exists', async () => {
    const stranger = harness.client();
    const res = await stranger.post('/auth/setup', {
      name: 'Impostor',
      email: 'impostor@test.local',
      password: 'test-password-1234',
    });
    assert.equal(res.status, 409);
  });

  it('rejects a login with the wrong password', async () => {
    const stranger = harness.client();
    const res = await stranger.post('/auth/login', {
      email: 'admin@test.local',
      password: 'wrong',
    });
    assert.equal(res.status, 401);
  });
});

describe('event permissions', () => {
  const tomorrow = () => new Date(Date.now() + 86400000).toISOString();

  it('lets a member with can_add_events create one', async () => {
    const res = await planner.post('/events', { title: 'Planner event', startsAt: tomorrow() });
    assert.equal(res.status, 201);
  });

  it('blocks a member without the permission', async () => {
    const res = await uploader.post('/events', { title: 'Nope', startsAt: tomorrow() });
    assert.equal(res.status, 403);
  });

  it("stops a member editing someone else's event", async () => {
    const created = await planner.post('/events', { title: 'Mine', startsAt: tomorrow() });
    const other = await createMember(harness, admin, {
      email: `other-${Date.now()}@test.local`,
      canUploadPhotos: false,
      canAddEvents: true,
    });
    const res = await other.patch(`/events/${created.data.event.id}`, { title: 'Hijacked' });
    assert.equal(res.status, 403);
  });

  it("lets an admin edit anyone's event", async () => {
    const created = await planner.post('/events', { title: 'Planner owns', startsAt: tomorrow() });
    const res = await admin.patch(`/events/${created.data.event.id}`, { title: 'Admin edited' });
    assert.equal(res.status, 200);
    assert.equal(res.data.event.title, 'Admin edited');
  });

  it('rejects an end before the start', async () => {
    const start = new Date(Date.now() + 86400000);
    const res = await planner.post('/events', {
      title: 'Backwards',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() - 3600000).toISOString(),
    });
    assert.equal(res.status, 400);
  });

  it('anchors an all-day event to midnight UTC so the date cannot drift', async () => {
    const res = await planner.post('/events', {
      title: 'All day',
      allDay: true,
      startsAt: '2026-09-15',
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.event.startsAt, '2026-09-15T00:00:00.000Z');
    assert.equal(res.data.event.allDay, true);
  });
});

describe('admin-only endpoints', () => {
  const adminRoutes = [
    ['GET', '/users'],
    ['GET', '/invites'],
    ['GET', '/settings'],
    ['GET', '/feeds'],
    ['GET', '/ingest/inbox'],
    ['GET', '/displays'],
    ['GET', '/backups'],
    ['GET', '/system/health-report'],
    ['GET', '/weather/search?q=london'],
  ];

  for (const [method, route] of adminRoutes) {
    it(`refuses ${route} for a non-admin member`, async () => {
      const res = await viewer.raw(method, route);
      assert.equal(res.status, 403, `${route} should be admin-only`);
    });

    it(`refuses ${route} for an anonymous caller`, async () => {
      const anon = harness.client();
      const res = await anon.raw(method, route);
      assert.equal(res.status, 401, `${route} should require a session`);
    });
  }

  it('will not let the last admin be demoted', async () => {
    const me = (await admin.get('/auth/me')).data.user;
    const res = await admin.patch(`/users/${me.id}`, { isAdmin: false });
    assert.equal(res.status, 409);
  });

  it('will not let an admin disable themselves', async () => {
    const me = (await admin.get('/auth/me')).data.user;
    const res = await admin.patch(`/users/${me.id}`, { disabled: true });
    assert.equal(res.status, 409);
  });
});

describe('display token boundaries', () => {
  const withToken = (token) => ({ headers: { 'x-display-token': token } });

  it('reads the kiosk surface', async () => {
    const anon = harness.client();
    for (const route of ['/settings/display', '/photos/playlist', '/events/agenda?days=7', '/weather']) {
      const res = await anon.raw('GET', route, withToken(displayToken));
      assert.equal(res.status, 200, `${route} should be readable by the display`);
    }
  });

  it('is rejected when wrong', async () => {
    const anon = harness.client();
    const res = await anon.raw('GET', '/settings/display', withToken('not-the-token'));
    assert.equal(res.status, 401);
  });

  it('cannot reach admin surfaces', async () => {
    const anon = harness.client();
    for (const route of ['/settings', '/users', '/backups']) {
      const res = await anon.raw('GET', route, withToken(displayToken));
      assert.equal(res.status, 401, `${route} must not accept a display token`);
    }
  });

  it('never exposes secrets through the kiosk settings', async () => {
    const anon = harness.client();
    const res = await anon.raw('GET', '/settings/display', withToken(displayToken));
    const keys = Object.keys(res.data.settings);
    assert.ok(!keys.includes('display_token'));
    assert.ok(!keys.includes('gmail_app_password'));
    assert.ok(!keys.includes('ingest_secret'));
    assert.ok(!keys.includes('photo_folder_path'));
  });

  it('rotating the token invalidates the old one', async () => {
    const rotated = (await admin.post('/settings/display-token/rotate')).data.displayToken;
    const anon = harness.client();
    assert.equal((await anon.raw('GET', '/settings/display', withToken(displayToken))).status, 401);
    assert.equal((await anon.raw('GET', '/settings/display', withToken(rotated))).status, 200);
    displayToken = rotated;
  });
});

describe('adding events from the frame', () => {
  it('accepts the display token when enabled', async () => {
    await admin.put('/settings', { settings: { frame_add_events: 'true' } });
    const anon = harness.client();
    const res = await anon.raw('POST', '/events/from-display', {
      headers: { 'x-display-token': displayToken },
      body: { title: 'From the wall', date: '2026-09-20', time: '14:00' },
    });
    assert.equal(res.status, 201);
  });

  it('is refused when the setting is off', async () => {
    await admin.put('/settings', { settings: { frame_add_events: 'false' } });
    const anon = harness.client();
    const res = await anon.raw('POST', '/events/from-display', {
      headers: { 'x-display-token': displayToken },
      body: { title: 'Blocked', date: '2026-09-21' },
    });
    assert.equal(res.status, 403);
    await admin.put('/settings', { settings: { frame_add_events: 'true' } });
  });

  it('rejects a malformed date', async () => {
    const anon = harness.client();
    const res = await anon.raw('POST', '/events/from-display', {
      headers: { 'x-display-token': displayToken },
      body: { title: 'Bad date', date: 'next tuesday' },
    });
    assert.equal(res.status, 400);
  });
});

describe('settings writes', () => {
  it('ignores keys that are not real settings', async () => {
    const res = await admin.put('/settings', {
      settings: { display_token: 'hijacked', not_a_setting: 'x', slide_seconds: '30' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.data.applied), ['slide_seconds']);
    assert.notEqual((await admin.get('/settings')).data.displayToken, 'hijacked');
  });
});

describe('heartbeats', () => {
  it('records a display and rejects a bogus id', async () => {
    const anon = harness.client();
    const ok = await anon.raw('POST', '/displays/heartbeat', {
      headers: { 'x-display-token': displayToken },
      body: { deviceId: 'testdevice12345678', width: 1920, height: 1080, layout: 'sidebar' },
    });
    assert.equal(ok.status, 200);

    const bad = await anon.raw('POST', '/displays/heartbeat', {
      headers: { 'x-display-token': displayToken },
      body: { deviceId: '../../etc/passwd' },
    });
    assert.equal(bad.status, 400);

    const listed = (await admin.get('/displays')).data.displays;
    assert.ok(listed.some((d) => d.id === 'testdevice12345678' && d.online));
  });
});
