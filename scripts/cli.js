#!/usr/bin/env node

/**
 * Ledger API - Interactive Terminal Workbench & CLI
 * Provides an intuitive, menu-driven CLI to test, simulate, and inspect
 * all financial ledger operations and guarantees.
 */

const readline = require('readline');

// ANSI Terminal Colors & Styling
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  bgDark: '\x1b[40m',
};

// Session State
const state = {
  baseUrl: process.env.API_URL || 'http://localhost:3000',
  token: '',
  user: null,
  sourceAccountId: '',
  destAccountId: '',
  clearingAccountId: '',
  lastIdempotencyKey: '',
  lastTransferPayload: null,
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const prompt = (query) => new Promise((resolve) => rl.question(query, resolve));

const generateUuid = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const printBanner = () => {
  console.clear();
  console.log(`${c.cyan}${c.bold}================================================================${c.reset}`);
  console.log(`${c.green}${c.bold}            ledger-api | Interactive Terminal Studio            ${c.reset}`);
  console.log(`${c.dim}  Double-Entry Ledger • Row Locks • Token Bucket • Cache-Aside  ${c.reset}`);
  console.log(`${c.cyan}================================================================${c.reset}`);
  console.log(`${c.dim}Target API:${c.reset} ${c.yellow}${state.baseUrl}${c.reset} | ${c.dim}Token:${c.reset} ${state.token ? `${c.green}Active${c.reset}` : `${c.red}None${c.reset}`}`);
  if (state.sourceAccountId) console.log(`${c.dim}Source Acc:${c.reset} ${c.blue}${state.sourceAccountId}${c.reset}`);
  if (state.destAccountId) console.log(`${c.dim}Dest Acc:  ${c.reset} ${c.blue}${state.destAccountId}${c.reset}`);
  console.log(`${c.cyan}----------------------------------------------------------------${c.reset}`);
};

const sendApi = async (method, path, body = null, customHeaders = {}) => {
  const url = `${state.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };
  if (state.token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  const start = Date.now();
  console.log(`\n${c.dim}[HTTP ${method}] --> ${url}${c.reset}`);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });
    const elapsed = Date.now() - start;

    const statusColor = response.status < 300 ? c.green : (response.status === 429 ? c.magenta : c.red);
    console.log(`${statusColor}${c.bold}[${response.status} ${response.statusText}]${c.reset} ${c.dim}(${elapsed}ms)${c.reset}`);

    // Highlight key headers
    const cacheHeader = response.headers.get('x-cache-lookup');
    const idemHeader = response.headers.get('idempotent-replay');
    const retryAfter = response.headers.get('retry-after');

    if (cacheHeader) {
      const color = cacheHeader.toUpperCase() === 'HIT' ? c.green : c.cyan;
      console.log(`  ${c.dim}X-Cache-Lookup:${c.reset} ${color}${c.bold}${cacheHeader.toUpperCase()}${c.reset}`);
    }
    if (idemHeader === 'true') {
      console.log(`  ${c.yellow}${c.bold}⚡ [IDEMPOTENCY REPLAY] Result served from cache without duplicate processing${c.reset}`);
    }
    if (response.status === 429) {
      console.log(`  ${c.magenta}${c.bold}🛡️ [RATE LIMIT TRIGGERED] Retry-After: ${retryAfter} seconds${c.reset}`);
    }

    const data = await response.json().catch(() => null);
    console.log(`\n${c.dim}--- Response Body ---${c.reset}`);
    console.log(JSON.stringify(data, null, 2));

    return { status: response.status, data, headers: response.headers };
  } catch (err) {
    console.log(`${c.red}[ERROR] Network request failed: ${err.message}${c.reset}`);
    return null;
  }
};

// Workflows
const healthCheck = async () => {
  await sendApi('GET', '/api/v1/health');
};

const signupAndLogin = async () => {
  const rand = Math.floor(Math.random() * 9000 + 1000);
  const emailInput = await prompt(`Email [client_${rand}@example.com]: `);
  const email = emailInput.trim() || `client_${rand}@example.com`;
  const password = 'Password123!';

  console.log(`\n1. Registering user: ${email}...`);
  await sendApi('POST', '/api/v1/auth/signup', {
    email,
    password,
    fullName: `Client User ${rand}`,
  });

  console.log(`\n2. Authenticating...`);
  const loginRes = await sendApi('POST', '/api/v1/auth/login', { email, password });
  if (loginRes?.data?.data?.accessToken) {
    state.token = loginRes.data.data.accessToken;
    state.user = loginRes.data.data.user;
    console.log(`\n${c.green}✔ Access token acquired and set for subsequent requests!${c.reset}`);
  }
};

const createAccounts = async () => {
  if (!state.token) {
    console.log(`${c.red}Please log in first (Option 3).${c.reset}`);
    return;
  }

  const rand = Math.floor(Math.random() * 9000 + 1000);
  console.log(`\nCreating Checking (Asset) Account...`);
  const chk = await sendApi('POST', '/api/v1/accounts', {
    accountNumber: `CHK-${rand}`,
    type: 'asset',
    currency: 'USD',
  });
  if (chk?.data?.data?.id) state.sourceAccountId = chk.data.data.id;

  console.log(`\nCreating Savings (Asset) Account...`);
  const sav = await sendApi('POST', '/api/v1/accounts', {
    accountNumber: `SAV-${rand}`,
    type: 'asset',
    currency: 'USD',
  });
  if (sav?.data?.data?.id) state.destAccountId = sav.data.data.id;

  console.log(`\nCreating Clearing (Equity) Account...`);
  const clr = await sendApi('POST', '/api/v1/accounts', {
    accountNumber: `CLR-${rand}`,
    type: 'equity',
    currency: 'USD',
  });
  if (clr?.data?.data?.id) state.clearingAccountId = clr.data.data.id;

  console.log(`\n${c.green}✔ Accounts created and stored in session state!${c.reset}`);
};

const fundAccount = async () => {
  if (!state.token || !state.sourceAccountId) {
    console.log(`${c.red}Please log in and create accounts first.${c.reset}`);
    return;
  }

  const amountStr = await prompt('Enter deposit amount [1000]: ');
  const amount = parseFloat(amountStr.trim()) || 1000;

  console.log(`\nPosting balanced double-entry deposit ($${amount})...`);
  await sendApi('POST', '/api/v1/transactions', {
    reference: `DEP-${Date.now()}`,
    description: 'Initial deposit',
    entries: [
      { accountId: state.sourceAccountId, entryType: 'credit', amount },
      { accountId: state.clearingAccountId, entryType: 'debit', amount },
    ],
  });
};

const checkBalance = async () => {
  if (!state.token || !state.sourceAccountId) {
    console.log(`${c.red}Please log in and create accounts first.${c.reset}`);
    return;
  }

  console.log(`\nChecking balance for Account: ${state.sourceAccountId}`);
  console.log(`${c.dim}(First call tests DB calculation; immediate repeat call tests Redis cache-aside HIT)${c.reset}`);
  await sendApi('GET', `/api/v1/accounts/${state.sourceAccountId}/balance`);

  const repeat = await prompt('\nInspect cache hit immediately? (y/n) [y]: ');
  if (repeat.trim().toLowerCase() !== 'n') {
    console.log('\n--- Second Balance Read (Testing Cache Hit) ---');
    await sendApi('GET', `/api/v1/accounts/${state.sourceAccountId}/balance`);
  }
};

const transferFunds = async () => {
  if (!state.token || !state.sourceAccountId || !state.destAccountId) {
    console.log(`${c.red}Source and Destination accounts required. Run option 4 first.${c.reset}`);
    return;
  }

  const amountStr = await prompt('Transfer amount [250]: ');
  const amount = parseFloat(amountStr.trim()) || 250;

  const keyChoice = await prompt('Generate new Idempotency-Key? (y/n) [y]: ');
  let idemKey = state.lastIdempotencyKey;
  if (!idemKey || keyChoice.trim().toLowerCase() !== 'n') {
    idemKey = generateUuid();
    state.lastIdempotencyKey = idemKey;
  }

  const payload = {
    sourceAccountId: state.sourceAccountId,
    destinationAccountId: state.destAccountId,
    amount,
    currency: 'USD',
    description: 'CLI funds transfer',
  };
  state.lastTransferPayload = payload;

  console.log(`\nSubmitting transfer with Idempotency-Key: ${idemKey}`);
  await sendApi('POST', '/api/v1/transfers', payload, {
    'Idempotency-Key': idemKey,
  });

  const testReplay = await prompt('\nTest Idempotency Replay with same key now? (y/n) [y]: ');
  if (testReplay.trim().toLowerCase() !== 'n') {
    console.log(`\nRe-sending identical transfer request with Idempotency-Key: ${idemKey}`);
    await sendApi('POST', '/api/v1/transfers', payload, {
      'Idempotency-Key': idemKey,
    });
  }
};

const testRateLimiter = async () => {
  console.log(`\n${c.yellow}Sending 6 rapid requests to /api/v1/auth/login to trigger Token Bucket rate limit...${c.reset}`);
  const promises = [];
  for (let i = 1; i <= 6; i++) {
    promises.push(
      fetch(`${state.baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'rate_test@example.com', password: 'wrong' }),
      }).then(async (res) => {
        const retry = res.headers.get('retry-after');
        return { index: i, status: res.status, retry };
      })
    );
  }

  const results = await Promise.all(promises);
  results.forEach((r) => {
    if (r.status === 429) {
      console.log(`  Request #${r.index}: ${c.magenta}${c.bold}HTTP 429 BLOCKED${c.reset} ${c.dim}(Retry-After: ${r.retry}s)${c.reset}`);
    } else {
      console.log(`  Request #${r.index}: ${c.green}HTTP ${r.status}${c.reset}`);
    }
  });
};

const runFullSimulation = async () => {
  console.log(`\n${c.cyan}${c.bold}>>> Starting Automated End-to-End Simulation <<<${c.reset}\n`);
  await signupAndLogin();
  await createAccounts();
  await fundAccount();
  await checkBalance();
  await transferFunds();
  console.log(`\n${c.green}${c.bold}✔ Simulation completed successfully!${c.reset}`);
};

// Main Menu Loop
const mainMenu = async () => {
  while (true) {
    printBanner();
    console.log(`${c.bold}Select Action:${c.reset}`);
    console.log(`  ${c.green}1.${c.reset} Health Check (/api/v1/health)`);
    console.log(`  ${c.green}2.${c.reset} ⚡ Run Full Automated Simulation (E2E)`);
    console.log(`  ${c.green}3.${c.reset} Sign Up & Log In`);
    console.log(`  ${c.green}4.${c.reset} Create Accounts (Checking, Savings, Clearing)`);
    console.log(`  ${c.green}5.${c.reset} Deposit Funds (Double-Entry Balanced)`);
    console.log(`  ${c.green}6.${c.reset} Check Account Balance (Redis Cache Inspection)`);
    console.log(`  ${c.green}7.${c.reset} Transfer Funds (Idempotency Replay Test)`);
    console.log(`  ${c.green}8.${c.reset} 🛡️ Test Rate Limiter (Token Bucket Blast)`);
    console.log(`  ${c.yellow}9.${c.reset} Change Target API URL`);
    console.log(`  ${c.red}0.${c.reset} Exit`);
    console.log('');

    const choice = (await prompt(`${c.cyan}Enter choice [0-9]: ${c.reset}`)).trim();

    switch (choice) {
      case '1': await healthCheck(); break;
      case '2': await runFullSimulation(); break;
      case '3': await signupAndLogin(); break;
      case '4': await createAccounts(); break;
      case '5': await fundAccount(); break;
      case '6': await checkBalance(); break;
      case '7': await transferFunds(); break;
      case '8': await testRateLimiter(); break;
      case '9': {
        const newUrl = await prompt(`New API URL [${state.baseUrl}]: `);
        if (newUrl.trim()) state.baseUrl = newUrl.trim().replace(/\/$/, '');
        break;
      }
      case '0':
        console.log(`\n${c.green}Goodbye!${c.reset}\n`);
        rl.close();
        process.exit(0);
      default:
        console.log(`${c.red}Invalid option.${c.reset}`);
    }

    await prompt(`\n${c.dim}Press Enter to return to main menu...${c.reset}`);
  }
};

mainMenu().catch((err) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
