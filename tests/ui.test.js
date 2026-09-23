const request = require('supertest');
const app = require('../src/app');

describe('Web Workbench & Static UI Tests', () => {
  it('should serve index.html at root GET /', async () => {
    const res = await request(app)
      .get('/')
      .expect(200)
      .expect('Content-Type', /html/);

    expect(res.text).toContain('ledger-api');
    expect(res.text).toContain('Workbench & Inspector');
    expect(res.text).toContain('1-Click Full Simulation');
    expect(res.text).toContain('id="reqMethod"');
    expect(res.text).toContain('id="reqPath"');
  });

  it('should serve index.html at GET /console alias', async () => {
    const res = await request(app)
      .get('/console')
      .expect(200)
      .expect('Content-Type', /html/);

    expect(res.text).toContain('ledger-api');
  });

  it('should serve style.css with text/css Content-Type', async () => {
    const res = await request(app)
      .get('/style.css')
      .expect(200)
      .expect('Content-Type', /css/);

    expect(res.text).toContain('--bg-base');
    expect(res.text).toContain('.app-layout');
  });

  it('should serve app.js with javascript Content-Type', async () => {
    const res = await request(app)
      .get('/app.js')
      .expect(200)
      .expect('Content-Type', /javascript/);

    expect(res.text).toContain('sendRequest');
    expect(res.text).toContain('runFullDemo');
  });

  it('should return 404 JSON for non-existent API routes', async () => {
    const res = await request(app)
      .get('/api/v1/non-existent-route')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Cannot find GET');
  });
});
