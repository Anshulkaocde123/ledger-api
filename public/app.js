/**
 * Ledger API Workbench - Client Controller
 * Provides interactive HTTP request execution, financial internal inspections,
 * and automated end-to-end scenario simulations.
 */

(() => {
  // Application State
  const state = {
    baseUrl: window.location.origin || 'http://localhost:3000',
    token: sessionStorage.getItem('ledger_access_token') || '',
    refreshToken: sessionStorage.getItem('ledger_refresh_token') || '',
    currentUser: null,
    sourceAccountId: sessionStorage.getItem('ledger_src_acc') || '',
    destAccountId: sessionStorage.getItem('ledger_dest_acc') || '',
    clearingAccountId: sessionStorage.getItem('ledger_clr_acc') || '',
    lastIdempotencyKey: sessionStorage.getItem('ledger_last_idem') || '',
    lastTransferPayload: null,
  };

  // DOM Elements
  const el = {
    baseUrlInput: document.getElementById('baseUrlInput'),
    healthBadge: document.getElementById('healthBadge'),
    healthText: document.getElementById('healthText'),
    authStatusPill: document.getElementById('authStatusPill'),
    clearTokenBtn: document.getElementById('clearTokenBtn'),

    // State Display
    stateUser: document.getElementById('stateUser'),
    stateSourceAcc: document.getElementById('stateSourceAcc'),
    stateDestAcc: document.getElementById('stateDestAcc'),
    stateIdemKey: document.getElementById('stateIdemKey'),

    // Inspector Request
    reqMethod: document.getElementById('reqMethod'),
    reqPath: document.getElementById('reqPath'),
    sendRequestBtn: document.getElementById('sendRequestBtn'),
    headerAuth: document.getElementById('headerAuth'),
    headerIdempotency: document.getElementById('headerIdempotency'),
    headerContentType: document.getElementById('headerContentType'),
    generateUuidBtn: document.getElementById('generateUuidBtn'),
    reqBody: document.getElementById('reqBody'),
    formatJsonBtn: document.getElementById('formatJsonBtn'),

    // Inspector Response
    resStatusBadge: document.getElementById('resStatusBadge'),
    resTimeBadge: document.getElementById('resTimeBadge'),
    resBodyViewer: document.getElementById('resBodyViewer'),
    resHeadersTbody: document.getElementById('resHeadersTbody'),

    // Financial Highlights Callout
    financialCalloutRow: document.getElementById('financialInternalsCallout'),
    cacheBadge: document.getElementById('cacheBadge'),
    cacheStatusVal: document.getElementById('cacheStatusVal'),
    idempotencyBadge: document.getElementById('idempotencyBadge'),
    idempotencyStatusVal: document.getElementById('idempotencyStatusVal'),
    rateLimitBadge: document.getElementById('rateLimitBadge'),
    rateLimitVal: document.getElementById('rateLimitVal'),

    // Activity Log
    activityLog: document.getElementById('activityLog'),
    clearLogBtn: document.getElementById('clearLogBtn'),

    // Action Triggers
    runFullDemoBtn: document.getElementById('runFullDemoBtn'),
    replayLastTransferBtn: document.getElementById('replayLastTransferBtn'),
    stressTestRateLimitBtn: document.getElementById('stressTestRateLimitBtn'),
  };

  // Helpers
  const generateUuid = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const log = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = `[${time}] ${msg}`;
    el.activityLog.appendChild(entry);
    el.activityLog.scrollTop = el.activityLog.scrollHeight;
  };

  const updateStateUI = () => {
    if (state.token) {
      el.authStatusPill.textContent = 'Token Active';
      el.authStatusPill.className = 'auth-pill authenticated';
      el.headerAuth.value = `Bearer ${state.token}`;
    } else {
      el.authStatusPill.textContent = 'No Token';
      el.authStatusPill.className = 'auth-pill unauthenticated';
      el.headerAuth.value = '';
    }

    el.stateUser.textContent = state.currentUser?.email || (state.token ? 'Authenticated User' : 'None');
    el.stateSourceAcc.textContent = state.sourceAccountId ? state.sourceAccountId.slice(0, 14) + '...' : 'None';
    el.stateDestAcc.textContent = state.destAccountId ? state.destAccountId.slice(0, 14) + '...' : 'None';
    el.stateIdemKey.textContent = state.lastIdempotencyKey ? state.lastIdempotencyKey.slice(0, 14) + '...' : 'None';
  };

  const checkHealth = async () => {
    try {
      const url = `${state.baseUrl}/api/v1/health`;
      const res = await fetch(url);
      if (res.ok) {
        el.healthBadge.className = 'health-pill online';
        el.healthText.textContent = 'API Online';
      } else {
        el.healthBadge.className = 'health-pill offline';
        el.healthText.textContent = `HTTP ${res.status}`;
      }
    } catch (err) {
      el.healthBadge.className = 'health-pill offline';
      el.healthText.textContent = 'Offline';
    }
  };

  // Switch Tabs in Request / Response Panes
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const targetTab = e.currentTarget.getAttribute('data-tab');
      const pane = e.currentTarget.closest('.pane');
      pane.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      pane.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

      e.currentTarget.classList.add('active');
      const contentEl = document.getElementById(`tab-${targetTab}`);
      if (contentEl) contentEl.classList.add('active');
    });
  });

  // Core Request Sender
  const sendRequest = async (overrideOptions = null) => {
    const method = overrideOptions?.method || el.reqMethod.value;
    const path = overrideOptions?.path || el.reqPath.value;
    const url = `${state.baseUrl}${path.startsWith('/') ? path : '/' + path}`;

    const headers = {};
    const authVal = overrideOptions?.headers?.Authorization || el.headerAuth.value.trim();
    if (authVal) headers['Authorization'] = authVal;

    const idemVal = overrideOptions?.headers?.['Idempotency-Key'] || el.headerIdempotency.value.trim();
    if (idemVal) headers['Idempotency-Key'] = idemVal;

    const contentType = el.headerContentType.value.trim();
    if (contentType && method !== 'GET') headers['Content-Type'] = contentType;

    let body = null;
    if (method !== 'GET') {
      body = overrideOptions?.body !== undefined ? overrideOptions.body : el.reqBody.value.trim();
    }

    log(`--> ${method} ${path}`, 'accent');
    el.resStatusBadge.className = 'status-badge status-idle';
    el.resStatusBadge.textContent = 'Pending...';

    // Reset Financial Callout Badges
    el.financialCalloutRow.classList.add('hidden');
    el.cacheBadge.classList.add('hidden');
    el.idempotencyBadge.classList.add('hidden');
    el.rateLimitBadge.classList.add('hidden');

    const startTime = performance.now();
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null,
      });

      const elapsed = Math.round(performance.now() - startTime);
      el.resTimeBadge.textContent = `${elapsed} ms`;

      // Status Badge
      const status = response.status;
      const statusText = response.statusText || 'Response';
      el.resStatusBadge.textContent = `${status} ${statusText}`;

      if (status >= 200 && status < 300) {
        el.resStatusBadge.className = 'status-badge status-2xx';
      } else if (status === 429) {
        el.resStatusBadge.className = 'status-badge status-429';
      } else if (status >= 400 && status < 500) {
        el.resStatusBadge.className = 'status-badge status-4xx';
      } else {
        el.resStatusBadge.className = 'status-badge status-5xx';
      }

      // Populate Response Headers Table
      el.resHeadersTbody.innerHTML = '';
      const headerPairs = [];
      response.headers.forEach((val, key) => {
        headerPairs.push([key, val]);
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${key}</td><td>${val}</td>`;
        el.resHeadersTbody.appendChild(tr);
      });

      // Financial Internals Detection
      const cacheHeader = response.headers.get('x-cache-lookup');
      const idemHeader = response.headers.get('idempotent-replay');
      const retryAfterHeader = response.headers.get('retry-after');

      let hasFinancialCallout = false;

      if (cacheHeader) {
        hasFinancialCallout = true;
        el.cacheBadge.classList.remove('hidden');
        el.cacheStatusVal.textContent = cacheHeader.toUpperCase();
        if (cacheHeader.toUpperCase() === 'HIT') {
          el.cacheBadge.style.borderColor = 'rgba(16, 185, 129, 0.5)';
          el.cacheStatusVal.style.color = '#10b981';
        } else {
          el.cacheBadge.style.borderColor = 'rgba(59, 130, 246, 0.5)';
          el.cacheStatusVal.style.color = '#60a5fa';
        }
      }

      if (idemHeader === 'true') {
        hasFinancialCallout = true;
        el.idempotencyBadge.classList.remove('hidden');
        el.idempotencyStatusVal.textContent = 'IDEMPOTENT REPLAY';
        log('⚡ [IDEMPOTENCY] Returned pre-computed result without duplicate transaction processing', 'warn');
      }

      if (status === 429) {
        hasFinancialCallout = true;
        el.rateLimitBadge.classList.remove('hidden');
        el.rateLimitVal.textContent = `RETRY-AFTER: ${retryAfterHeader || '12'}s`;
        log(`🛡️ [RATE LIMIT] Exceeded Token Bucket capacity. Blocked for ${retryAfterHeader}s`, 'error');
      }

      if (hasFinancialCallout) {
        el.financialCalloutRow.classList.remove('hidden');
      }

      // Parse and display Body
      const text = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
        el.resBodyViewer.innerHTML = `<code>${escapeHtml(JSON.stringify(parsed, null, 2))}</code>`;
      } catch {
        el.resBodyViewer.innerHTML = `<code>${escapeHtml(text)}</code>`;
      }

      log(`<-- ${status} ${statusText} (${elapsed}ms)`, status < 400 ? 'success' : 'warn');

      // Auto-capture tokens & created entity IDs
      if (parsed && parsed.data) {
        if (parsed.data.accessToken) {
          state.token = parsed.data.accessToken;
          sessionStorage.setItem('ledger_access_token', state.token);
          if (parsed.data.refreshToken) {
            state.refreshToken = parsed.data.refreshToken;
            sessionStorage.setItem('ledger_refresh_token', state.refreshToken);
          }
          if (parsed.data.user) {
            state.currentUser = parsed.data.user;
          }
          updateStateUI();
          log('🔑 Access token automatically captured and loaded into Authorization header', 'success');
        }

        // Auto-capture account ID if created
        if (parsed.data.id && path === '/api/v1/accounts') {
          if (!state.sourceAccountId) {
            state.sourceAccountId = parsed.data.id;
            sessionStorage.setItem('ledger_src_acc', state.sourceAccountId);
            log(`💳 Captured Source Account ID: ${state.sourceAccountId}`, 'info');
          } else if (!state.destAccountId) {
            state.destAccountId = parsed.data.id;
            sessionStorage.setItem('ledger_dest_acc', state.destAccountId);
            log(`💳 Captured Destination Account ID: ${state.destAccountId}`, 'info');
          } else if (!state.clearingAccountId) {
            state.clearingAccountId = parsed.data.id;
            sessionStorage.setItem('ledger_clr_acc', state.clearingAccountId);
          }
          updateStateUI();
        }
      }

      return { status, data: parsed, headers: response.headers };
    } catch (err) {
      const elapsed = Math.round(performance.now() - startTime);
      el.resTimeBadge.textContent = `${elapsed} ms`;
      el.resStatusBadge.className = 'status-badge status-5xx';
      el.resStatusBadge.textContent = 'Error';
      el.resBodyViewer.innerHTML = `<code>${escapeHtml(err.message)}</code>`;
      log(`[ERROR] Request failed: ${err.message}`, 'error');
      throw err;
    }
  };

  const escapeHtml = (str) => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  // Presets Handlers
  const loadPreset = (presetKey) => {
    const randomSuffix = Math.floor(Math.random() * 9000 + 1000);
    switch (presetKey) {
      case 'signup':
        el.reqMethod.value = 'POST';
        el.reqPath.value = '/api/v1/auth/signup';
        el.reqBody.value = JSON.stringify({
          email: `client${randomSuffix}@example.com`,
          password: 'Password123!',
          fullName: `Client User ${randomSuffix}`,
        }, null, 2);
        break;

      case 'login':
        el.reqMethod.value = 'POST';
        el.reqPath.value = '/api/v1/auth/login';
        el.reqBody.value = JSON.stringify({
          email: state.currentUser?.email || `client${randomSuffix}@example.com`,
          password: 'Password123!',
        }, null, 2);
        break;

      case 'refresh':
        el.reqMethod.value = 'POST';
        el.reqPath.value = '/api/v1/auth/refresh';
        el.reqBody.value = JSON.stringify({
          refreshToken: state.refreshToken || '<your-refresh-token>',
        }, null, 2);
        break;

      case 'create-account':
        el.reqMethod.value = 'POST';
        el.reqPath.value = '/api/v1/accounts';
        el.reqBody.value = JSON.stringify({
          accountNumber: `ACC-${randomSuffix}`,
          type: 'asset',
          currency: 'USD',
        }, null, 2);
        break;

      case 'list-accounts':
        el.reqMethod.value = 'GET';
        el.reqPath.value = '/api/v1/accounts';
        el.reqBody.value = '';
        break;

      case 'check-balance':
        const accId = state.sourceAccountId || '00000000-0000-0000-0000-000000000000';
        el.reqMethod.value = 'GET';
        el.reqPath.value = `/api/v1/accounts/${accId}/balance`;
        el.reqBody.value = '';
        break;

      case 'fund-account':
        const src = state.sourceAccountId || generateUuid();
        const clr = state.clearingAccountId || generateUuid();
        el.reqMethod.value = 'POST';
        el.reqPath.value = '/api/v1/transactions';
        el.reqBody.value = JSON.stringify({
          reference: `DEP-${randomSuffix}`,
          description: 'Initial account funding (Balanced Double-Entry)',
          entries: [
            { accountId: src, entryType: 'credit', amount: 1000 },
            { accountId: clr, entryType: 'debit', amount: 1000 },
          ],
        }, null, 2);
        break;

      case 'transfer':
        const newUuid = generateUuid();
        el.headerIdempotency.value = newUuid;
        state.lastIdempotencyKey = newUuid;
        sessionStorage.setItem('ledger_last_idem', newUuid);
        updateStateUI();

        el.reqMethod.value = 'POST';
        el.reqPath.value = '/api/v1/transfers';
        const transferPayload = {
          sourceAccountId: state.sourceAccountId || generateUuid(),
          destinationAccountId: state.destAccountId || generateUuid(),
          amount: 250,
          currency: 'USD',
          description: 'Peer-to-peer transfer test',
        };
        state.lastTransferPayload = transferPayload;
        el.reqBody.value = JSON.stringify(transferPayload, null, 2);
        break;
    }

    log(`Loaded preset: ${presetKey}`);
  };

  // Replay Last Transfer (Tests Idempotency with exact same key)
  const replayLastTransfer = async () => {
    if (!state.lastIdempotencyKey) {
      alert('Please run a transfer first to generate an Idempotency-Key.');
      return;
    }

    el.reqMethod.value = 'POST';
    el.reqPath.value = '/api/v1/transfers';
    el.headerIdempotency.value = state.lastIdempotencyKey;
    if (state.lastTransferPayload) {
      el.reqBody.value = JSON.stringify(state.lastTransferPayload, null, 2);
    }

    log(`Re-submitting transfer with IDENTICAL idempotency key: ${state.lastIdempotencyKey}`, 'warn');
    await sendRequest();
  };

  // Automated 1-Click End-to-End Simulation
  const runFullDemo = async () => {
    try {
      el.runFullDemoBtn.disabled = true;
      el.runFullDemoBtn.textContent = 'Running Simulation...';
      log('================ STARTING END-TO-END SIMULATION ================', 'accent');

      const rand = Math.floor(Math.random() * 90000 + 10000);
      const email = `demo_${rand}@example.com`;
      const password = 'Password123!';

      // Step 1: Signup
      log('Step 1/7: Registering new user...', 'info');
      await sendRequest({
        method: 'POST',
        path: '/api/v1/auth/signup',
        body: { email, password, fullName: `Demo User ${rand}` },
      });

      // Step 2: Login
      log('Step 2/7: Logging in to obtain JWT access token...', 'info');
      await sendRequest({
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { email, password },
      });

      // Step 3: Create Checking Account
      log('Step 3/7: Creating Checking Account (Source)...', 'info');
      const chkRes = await sendRequest({
        method: 'POST',
        path: '/api/v1/accounts',
        body: { accountNumber: `CHK-${rand}`, type: 'asset', currency: 'USD' },
      });
      const sourceId = chkRes.data.data.id;
      state.sourceAccountId = sourceId;

      // Step 4: Create Savings Account
      log('Step 4/7: Creating Savings Account (Destination)...', 'info');
      const savRes = await sendRequest({
        method: 'POST',
        path: '/api/v1/accounts',
        body: { accountNumber: `SAV-${rand}`, type: 'asset', currency: 'USD' },
      });
      const destId = savRes.data.data.id;
      state.destAccountId = destId;

      // Create Clearing Account
      const clrRes = await sendRequest({
        method: 'POST',
        path: '/api/v1/accounts',
        body: { accountNumber: `CLR-${rand}`, type: 'equity', currency: 'USD' },
      });
      const clrId = clrRes.data.data.id;
      state.clearingAccountId = clrId;

      // Step 5: Fund Checking Account via Balanced Double-Entry
      log('Step 5/7: Depositing $1,000 via Balanced Double-Entry Transaction...', 'info');
      await sendRequest({
        method: 'POST',
        path: '/api/v1/transactions',
        body: {
          reference: `INIT-DEP-${rand}`,
          description: 'Initial deposit',
          entries: [
            { accountId: sourceId, entryType: 'credit', amount: 1000 },
            { accountId: clrId, entryType: 'debit', amount: 1000 },
          ],
        },
      });

      // Step 6: Transfer $300 from Checking to Savings
      const idemKey = generateUuid();
      state.lastIdempotencyKey = idemKey;
      el.headerIdempotency.value = idemKey;
      const transferPayload = {
        sourceAccountId: sourceId,
        destinationAccountId: destId,
        amount: 300,
        currency: 'USD',
        description: 'Demo fund transfer',
      };
      state.lastTransferPayload = transferPayload;

      log(`Step 6/7: Transferring $300 with Idempotency-Key [${idemKey.slice(0, 8)}...]...`, 'info');
      await sendRequest({
        method: 'POST',
        path: '/api/v1/transfers',
        headers: { 'Idempotency-Key': idemKey },
        body: transferPayload,
      });

      // Step 7: Test Idempotency Replay
      log('Step 7/7: Testing Idempotency Replay (re-firing exact same request)...', 'warn');
      await sendRequest({
        method: 'POST',
        path: '/api/v1/transfers',
        headers: { 'Idempotency-Key': idemKey },
        body: transferPayload,
      });

      // Final: Verify Derived Balances
      log('Final: Checking Source Account balance...', 'info');
      await sendRequest({
        method: 'GET',
        path: `/api/v1/accounts/${sourceId}/balance`,
      });

      log('================ SIMULATION COMPLETE (ALL CHECKS PASSED) ================', 'success');
      alert('Simulation completed successfully! Inspect the response panel and headers to see Idempotency and Cache details.');
    } catch (err) {
      log(`Simulation aborted due to error: ${err.message}`, 'error');
    } finally {
      el.runFullDemoBtn.disabled = false;
      el.runFullDemoBtn.innerHTML = '<span class="btn-icon-text">⚡</span> Run End-to-End Demo';
      updateStateUI();
    }
  };

  // Rate Limit Burst Stress Tester
  const stressTestRateLimit = async () => {
    log('Fring 6 rapid parallel requests to /api/v1/auth/login to trigger rate limit...', 'warn');
    const promises = [];
    for (let i = 1; i <= 6; i++) {
      promises.push(
        fetch(`${state.baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'bad@example.com', password: 'wrong' }),
        }).then(async (r) => {
          const retryAfter = r.headers.get('retry-after');
          return { req: i, status: r.status, retryAfter };
        })
      );
    }

    const results = await Promise.all(promises);
    results.forEach((res) => {
      if (res.status === 429) {
        log(`Request #${res.req} -> HTTP 429 BLOCKED (Retry-After: ${res.retryAfter}s)`, 'error');
      } else {
        log(`Request #${res.req} -> HTTP ${res.status}`, 'info');
      }
    });

    // Run one through the inspector UI so the user sees the headers
    await sendRequest({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: 'bad@example.com', password: 'wrong' },
    });
  };

  // Event Listeners
  el.sendRequestBtn.addEventListener('click', () => sendRequest());

  // Shortcut: Cmd/Ctrl + Enter to send
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      sendRequest();
    }
  });

  el.baseUrlInput.value = state.baseUrl;
  el.baseUrlInput.addEventListener('change', (e) => {
    state.baseUrl = e.target.value.replace(/\/$/, '');
    log(`Target API URL updated to: ${state.baseUrl}`);
    checkHealth();
  });

  el.clearTokenBtn.addEventListener('click', () => {
    state.token = '';
    state.refreshToken = '';
    state.currentUser = null;
    sessionStorage.removeItem('ledger_access_token');
    sessionStorage.removeItem('ledger_refresh_token');
    updateStateUI();
    log('Session token cleared.', 'warn');
  });

  el.generateUuidBtn.addEventListener('click', () => {
    const uuid = generateUuid();
    el.headerIdempotency.value = uuid;
    state.lastIdempotencyKey = uuid;
    sessionStorage.setItem('ledger_last_idem', uuid);
    updateStateUI();
    log(`Generated new UUID Idempotency-Key: ${uuid}`);
  });

  el.formatJsonBtn.addEventListener('click', () => {
    try {
      const val = el.reqBody.value.trim();
      if (!val) return;
      el.reqBody.value = JSON.stringify(JSON.parse(val), null, 2);
    } catch {
      alert('Invalid JSON in body editor.');
    }
  });

  el.clearLogBtn.addEventListener('click', () => {
    el.activityLog.innerHTML = '';
  });

  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const preset = e.currentTarget.getAttribute('data-preset');
      loadPreset(preset);
    });
  });

  el.replayLastTransferBtn.addEventListener('click', replayLastTransfer);
  el.runFullDemoBtn.addEventListener('click', runFullDemo);
  el.stressTestRateLimitBtn.addEventListener('click', stressTestRateLimit);

  // Initialize
  updateStateUI();
  checkHealth();
  setInterval(checkHealth, 15000);
})();
