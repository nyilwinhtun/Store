// Seeds the local Firebase Emulator Suite only. Every request is hard-wired to
// 127.0.0.1 with the synthetic demo project, so this script cannot reach a
// cloud project even if ambient Google credentials exist on the machine.
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECT_ID = 'demo-minimart-staging';
const BUSINESS_ID = 'store-mini-main';
const FIRESTORE_BASE = `http://127.0.0.1:8099/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_BASE = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}`;
const HUB_URL = 'http://127.0.0.1:4400/emulators';

const OWNER_EMAIL = process.env.EMULATOR_OWNER_EMAIL || 'bonyiontheway@gmail.com';
const CASHIER_EMAIL = 'cashier.main@demo.minimart.test';
const CASHIER_OTHER_EMAIL = 'cashier.lanmadaw@demo.minimart.test';
const DISABLED_EMAIL = 'disabled@demo.minimart.test';

// Emulator-only credentials live outside the repository so no password is
// stored in source, logs, documentation or the git working tree.
const CREDENTIALS_FILE = process.env.EMULATOR_CREDENTIALS_FILE
  || join(homedir(), 'Documents/GitHub/Store-backups/emulator-credentials.local.txt');

const BRANCH_MAIN = 'branch-main';
const BRANCH_OTHER = 'branch-lanmadaw';

function readStoredCredentials() {
  try {
    const parsed = {};
    for (const line of readFileSync(CREDENTIALS_FILE, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) parsed[match[1]] = match[2].trim();
    }
    return parsed;
  } catch {
    return {};
  }
}

const stored = readStoredCredentials();
const generatePassword = () => `Mm-${randomBytes(15).toString('base64url')}#9`;
const credentials = {
  OWNER_EMAIL,
  OWNER_PASSWORD: stored.OWNER_PASSWORD || generatePassword(),
  CASHIER_MAIN_EMAIL: CASHIER_EMAIL,
  CASHIER_MAIN_PASSWORD: stored.CASHIER_MAIN_PASSWORD || generatePassword(),
  CASHIER_LANMADAW_EMAIL: CASHIER_OTHER_EMAIL,
  CASHIER_LANMADAW_PASSWORD: stored.CASHIER_LANMADAW_PASSWORD || generatePassword(),
  DISABLED_EMAIL,
  DISABLED_PASSWORD: stored.DISABLED_PASSWORD || generatePassword(),
};

function persistCredentials() {
  const lines = [
    '# Local Firebase Emulator credentials — synthetic demo-minimart-staging accounts only.',
    '# Never commit, share, or use these against a production Firebase project.',
    '',
    ...Object.entries(credentials).map(([key, value]) => `${key}=${value}`),
    '',
  ];
  writeFileSync(CREDENTIALS_FILE, lines.join('\n'), { mode: 0o600 });
  chmodSync(CREDENTIALS_FILE, 0o600);
}


// Fail closed on any ambient signal that a production runtime is selected.
// Synthetic emulator data must never be written into minimart-production.
const projectSignals = [
  process.env.VITE_FIREBASE_MODE,
  process.env.MODE,
  process.env.FIREBASE_PROJECT_ID,
  process.env.GCLOUD_PROJECT,
  process.env.GOOGLE_CLOUD_PROJECT,
].map((value) => (value || '').trim().toLowerCase());
try {
  const config = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
  projectSignals.push(String(config.projectId || '').trim().toLowerCase());
} catch {
  projectSignals.push(String(process.env.FIREBASE_CONFIG || '').trim().toLowerCase());
}
const productionSelected = projectSignals.some((value) => value === 'production' || value.includes('minimart-production'));
const productionDevOptIn = (process.env.VITE_ALLOW_PRODUCTION_IN_DEV || '').trim().toLowerCase() === 'true';
const productionArgument = process.argv.slice(2).some((arg) => arg.toLowerCase().includes('minimart-production'));
if (productionSelected || productionDevOptIn || productionArgument) {
  throw new Error(
    'Refusing to seed: a production runtime is selected (VITE_FIREBASE_MODE, MODE, FIREBASE_CONFIG, project environment or argument). '
    + 'This script writes synthetic data to the local Emulator Suite only. Unset VITE_ALLOW_PRODUCTION_IN_DEV and restart with `npm run emulators`.',
  );
}
for (const base of [FIRESTORE_BASE, AUTH_BASE, HUB_URL]) {
  if (!base.startsWith('http://127.0.0.1:')) throw new Error(`Refusing to seed a non-local endpoint: ${base}`);
}

const NOW = new Date().toISOString();

async function ensureEmulators() {
  let response;
  try {
    response = await fetch(HUB_URL);
  } catch {
    throw new Error('Emulator Hub is unreachable. Start it with `npm run emulators` first.');
  }
  if (!response.ok) throw new Error(`Emulator Hub returned HTTP ${response.status}.`);
  const running = await response.json();
  for (const name of ['auth', 'firestore']) {
    if (!running[name]) throw new Error(`The ${name} emulator is not running. Start all emulators with \`npm run emulators\`.`);
  }
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite number cannot be seeded');
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, firestoreValue(child)])) } };
  }
  throw new Error(`Unsupported seed value type: ${typeof value}`);
}

async function writeDocument(path, data) {
  const params = new URLSearchParams();
  for (const key of Object.keys(data)) params.append('updateMask.fieldPaths', key);
  const response = await fetch(`${FIRESTORE_BASE}/${path}?${params.toString()}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, firestoreValue(value)])) }),
  });
  if (!response.ok) throw new Error(`Firestore write failed for ${path}: HTTP ${response.status} ${await response.text()}`);
}

function syncRecord(scope, kind, id, payload, branchId) {
  return { scope, kind, id, ...(branchId ? { branchId } : {}), payload, deleted: false, updatedAt: NOW };
}

async function writeBranchRecord(branchId, kind, id, payload) {
  await writeDocument(`businesses/${BUSINESS_ID}/branches/${branchId}/${kind}/${id}`, syncRecord('branchRecord', kind, id, { ...payload, branchId }, branchId));
}

async function authRequest(path, body) {
  const response = await fetch(`${AUTH_BASE}/${path}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Auth emulator ${path} failed: HTTP ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function seedAccount({ email, password, displayName }) {
  const lookup = await authRequest('accounts:lookup', { email: [email] });
  const existing = Array.isArray(lookup.users) ? lookup.users[0] : undefined;
  if (existing?.localId) {
    await authRequest('accounts:update', { localId: existing.localId, password, displayName, emailVerified: true });
    return existing.localId;
  }
  const created = await authRequest('accounts', { email, password, displayName, emailVerified: true });
  if (!created.localId) throw new Error(`Auth emulator did not return a UID for ${email}.`);
  return created.localId;
}

const branchSettings = (storeName, kpayName, kpayNumber) => ({
  storeName,
  currency: 'MMK',
  receiptHeader: storeName,
  receiptFooter: 'ဝယ်ယူအားပေးမှုကို ကျေးဇူးတင်ပါသည်။',
  kpayEnabled: true,
  kpayAccountName: kpayName,
  kpayAccountNumber: kpayNumber,
  kpayAccountLabel: 'KBZPay',
  cashLedgerOpeningBalance: 0,
  kpayLedgerOpeningBalance: 0,
  financeLedgerStartDate: '2026-09-01',
  cashierExpenseApprovalLimit: 50000,
});

const branchMain = {
  id: BRANCH_MAIN,
  name: 'မင်္ဂလာ မီနီမာ့တ် (ဗိုလ်ချုပ်လမ်း)',
  code: 'MM-01',
  address: 'ရန်ကုန်မြို့၊ ဗိုလ်ချုပ်လမ်း',
  phone: '09-790000001',
  ownerName: 'ဦးမင်းထွန်း',
  status: 'active',
  isDefault: true,
  createdAt: '2026-09-01T02:00:00.000Z',
  updatedAt: NOW,
  settings: branchSettings('မင်္ဂလာ မီနီမာ့တ်', 'ဦးမင်းထွန်း', '09-790000001'),
};

const branchOther = {
  id: BRANCH_OTHER,
  name: 'မင်္ဂလာ မီနီမာ့တ် (လမ်းမတော်)',
  code: 'MM-02',
  address: 'ရန်ကုန်မြို့၊ လမ်းမတော်လမ်း',
  phone: '09-790000002',
  ownerName: 'ဦးမင်းထွန်း',
  status: 'active',
  isDefault: false,
  createdAt: '2026-09-15T02:00:00.000Z',
  updatedAt: NOW,
  settings: branchSettings('မင်္ဂလာ မီနီမာ့တ် (လမ်းမတော်)', 'ဒေါ်ခင်လှ', '09-790000002'),
};

const categories = [
  { id: 'cat-food', name: 'အစားအသောက်', color: '#0f766e' },
  { id: 'cat-drink', name: 'အဖျော်ယမကာ', color: '#2563eb' },
  { id: 'cat-home', name: 'အိမ်သုံးပစ္စည်း', color: '#b45309' },
];

const productsMain = [
  { id: 'prod-rice', name: 'ဆန်လုံးညို ၁ ကီလို', sku: 'RIC-001', barcode: '8850000000011', category: 'အစားအသောက်', costPrice: 1800, retailPrice: 2300, wholesalePrice: 2150, stock: 42, lowStockAt: 10, unit: 'ထုပ်' },
  { id: 'prod-oil', name: 'စားသုံးဆီ ၁ လီတာ', sku: 'OIL-001', barcode: '8850000000028', category: 'အစားအသောက်', costPrice: 4200, retailPrice: 5200, wholesalePrice: 4900, stock: 18, lowStockAt: 6, unit: 'ပုလင်း' },
  { id: 'prod-water', name: 'သောက်ရေသန့် ၁ လီတာ', sku: 'WTR-001', barcode: '8850000000035', category: 'အဖျော်ယမကာ', costPrice: 450, retailPrice: 700, wholesalePrice: 650, stock: 60, lowStockAt: 12, unit: 'ဘူး' },
  { id: 'prod-soap', name: 'ရေချိုးဆပ်ပြာ', sku: 'SOP-001', barcode: '8850000000042', category: 'အိမ်သုံးပစ္စည်း', costPrice: 1100, retailPrice: 1500, wholesalePrice: 1400, stock: 25, lowStockAt: 8, unit: 'ခု' },
  { id: 'prod-milk', name: 'နို့ဆီဗူး', sku: 'MLK-001', barcode: '8850000000059', category: 'အစားအသောက်', costPrice: 2200, retailPrice: 2600, wholesalePrice: 2500, stock: 8, lowStockAt: 10, unit: 'ဗူး' },
];

const productsOther = [
  { id: 'prod-lmd-tea', name: 'လက်ဖက်ရည်ထုပ်', sku: 'TEA-001', barcode: '8850000000066', category: 'အဖျော်ယမကာ', costPrice: 1200, retailPrice: 1600, wholesalePrice: 1500, stock: 30, lowStockAt: 8, unit: 'ထုပ်' },
  { id: 'prod-lmd-sugar', name: 'သကြား ၁ ကီလို', sku: 'SUG-001', barcode: '8850000000073', category: 'အစားအသောက်', costPrice: 2400, retailPrice: 2900, wholesalePrice: 2800, stock: 22, lowStockAt: 5, unit: 'ထုပ်' },
];

const customers = [
  { id: 'cust-aung', name: 'ဦးအောင်မြင့်', phone: '09-770000001', address: 'ဗိုလ်ချုပ်လမ်း၊ ရန်ကုန်', note: 'လစဉ် အကြွေးဝယ်သူ', createdAt: '2026-09-05T03:00:00.000Z' },
  { id: 'cust-thiri', name: 'ဒေါ်သီရိလှ', phone: '09-770000002', address: 'လမ်းမတော်လမ်း၊ ရန်ကုန်', note: '', createdAt: '2026-09-06T03:00:00.000Z' },
  { id: 'cust-kyaw', name: 'ကိုကျော်ဇော', phone: '09-770000003', address: 'ပြည်လမ်း၊ ရန်ကုန်', note: 'ဆိုင်ခွဲ နှစ်ခုလုံးတွင် ဝယ်ယူသည်', createdAt: '2026-09-07T03:00:00.000Z' },
];

function saleItem(product, quantity, unitPrice) {
  return {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    quantity,
    unitPrice,
    costPrice: product.costPrice,
    mode: 'retail',
    stockAtAdd: product.stock + quantity,
    unit: product.unit,
    quantityMode: 'whole',
  };
}

function sale({ id, receiptNo, date, customer, customerId, paymentMethod, status = 'completed', ...rest }) {
  return {
    id, receiptNo, date, customer, ...(customerId ? { customerId } : {}), paymentMethod,
    items: rest.items, subtotal: rest.total, discount: 0, total: rest.total, profit: rest.profit,
    paidAmount: rest.paidAmount, dueAmount: rest.dueAmount, status,
    createdByUid: rest.createdByUid, createdByName: rest.createdByName, createdByEmail: rest.createdByEmail,
    ...(rest.cashReceivedAmount !== undefined ? { cashReceivedAmount: rest.cashReceivedAmount, changeAmount: rest.changeAmount } : {}),
    ...(rest.kpayTransactionReference ? { kpayTransactionReference: rest.kpayTransactionReference, kpayAccountNameSnapshot: 'ဦးမင်းထွန်း', kpayAccountNumberSnapshot: '09-790000001', kpayAccountLabelSnapshot: 'KBZPay', kpayQrVersionSnapshot: 1 } : {}),
    ...(rest.voidedAt ? { voidedAt: rest.voidedAt, voidedByName: rest.voidedByName, voidReason: rest.voidReason } : {}),
  };
}

async function seed() {
  await ensureEmulators();

  const ownerUid = await seedAccount({ email: OWNER_EMAIL, password: credentials.OWNER_PASSWORD, displayName: 'ဦးမင်းထွန်း (Owner)' });
  const cashierUid = await seedAccount({ email: CASHIER_EMAIL, password: credentials.CASHIER_MAIN_PASSWORD, displayName: 'မခင်မာ (Cashier)' });
  const cashierOtherUid = await seedAccount({ email: CASHIER_OTHER_EMAIL, password: credentials.CASHIER_LANMADAW_PASSWORD, displayName: 'မသီတာ (Cashier)' });
  const disabledUid = await seedAccount({ email: DISABLED_EMAIL, password: credentials.DISABLED_PASSWORD, displayName: 'ပိတ်ထားသော ဝန်ထမ်း' });

  await writeDocument(`businesses/${BUSINESS_ID}`, {
    businessId: BUSINESS_ID,
    name: 'မင်္ဂလာ မီနီမာ့တ်',
    ownerUid,
    ownerName: 'ဦးမင်းထွန်း',
    active: true,
    createdAt: '2026-09-01T02:00:00.000Z',
    updatedAt: NOW,
  });

  const members = [
    { uid: cashierUid, email: CASHIER_EMAIL, displayName: 'မခင်မာ', branchIds: [BRANCH_MAIN], status: 'active' },
    { uid: cashierOtherUid, email: CASHIER_OTHER_EMAIL, displayName: 'မသီတာ', branchIds: [BRANCH_OTHER], status: 'active' },
    { uid: disabledUid, email: DISABLED_EMAIL, displayName: 'ပိတ်ထားသော ဝန်ထမ်း', branchIds: [BRANCH_MAIN], status: 'disabled' },
  ];
  for (const member of members) {
    await writeDocument(`businesses/${BUSINESS_ID}/members/${member.uid}`, {
      ...member,
      role: 'cashier',
      canReceiveStock: false,
      createdAt: '2026-09-10T02:00:00.000Z',
      updatedAt: NOW,
    });
  }

  await writeDocument(`businesses/${BUSINESS_ID}/meta/settings`, syncRecord('meta', 'settings', 'settings', {
    settings: {
      storeName: 'မင်္ဂလာ မီနီမာ့တ်',
      currency: 'MMK',
      receiptHeader: 'မင်္ဂလာ မီနီမာ့တ်',
      receiptFooter: 'ဝယ်ယူအားပေးမှုကို ကျေးဇူးတင်ပါသည်။',
      cashierExpenseApprovalLimit: 50000,
    },
    ownerProfile: { displayName: 'ဦးမင်းထွန်း', phone: '09-790000001', photoUrl: '' },
  }));

  for (const branch of [branchMain, branchOther]) {
    await writeDocument(`businesses/${BUSINESS_ID}/branches/${branch.id}`, syncRecord('branch', 'branches', branch.id, branch, branch.id));
    for (const category of categories) {
      await writeBranchRecord(branch.id, 'categories', `${category.id}-${branch.code}`, {
        id: `${category.id}-${branch.code}`,
        branchId: branch.id,
        name: category.name,
        color: category.color,
        isActive: true,
        createdAt: '2026-09-01T02:00:00.000Z',
      });
    }
  }

  for (const [index, product] of productsMain.entries()) {
    await writeBranchRecord(BRANCH_MAIN, 'products', product.id, { ...product, branchId: BRANCH_MAIN, createdAt: `2026-09-0${index + 1}T02:00:00.000Z` });
  }
  for (const [index, product] of productsOther.entries()) {
    await writeBranchRecord(BRANCH_OTHER, 'products', product.id, { ...product, branchId: BRANCH_OTHER, createdAt: `2026-09-1${index + 1}T02:00:00.000Z` });
  }

  for (const customer of customers) {
    await writeDocument(`businesses/${BUSINESS_ID}/shared/customers/records/${customer.id}`, syncRecord('shared', 'customers', customer.id, customer));
  }

  const rice = productsMain[0];
  const oil = productsMain[1];
  const water = productsMain[2];
  const soap = productsMain[3];
  const tea = productsOther[0];

  const sales = [
    sale({
      id: 'sale-credit-1', receiptNo: 'MM-20261005-00001', date: '2026-10-05T03:15:00.000Z',
      customer: 'ဦးအောင်မြင့်', customerId: 'cust-aung', paymentMethod: 'Credit',
      items: [saleItem(rice, 10, 2300), saleItem(oil, 5, 5200)], total: 49000, profit: 4300,
      paidAmount: 10000, dueAmount: 39000,
      createdByUid: cashierUid, createdByName: 'မခင်မာ', createdByEmail: CASHIER_EMAIL,
    }),
    sale({
      id: 'sale-credit-2', receiptNo: 'MM-20261028-00002', date: '2026-10-28T05:40:00.000Z',
      customer: 'ဦးအောင်မြင့်', customerId: 'cust-aung', paymentMethod: 'Credit',
      items: [saleItem(oil, 10, 5200), saleItem(soap, 5, 1500)], total: 59500, profit: 5500,
      paidAmount: 0, dueAmount: 59500,
      createdByUid: cashierUid, createdByName: 'မခင်မာ', createdByEmail: CASHIER_EMAIL,
    }),
    sale({
      id: 'sale-cash-1', receiptNo: 'MM-20261102-00003', date: '2026-11-02T06:20:00.000Z',
      customer: 'ဧည့်သည်', paymentMethod: 'Cash',
      items: [saleItem(water, 6, 700), saleItem(soap, 2, 1500)], total: 7200, profit: 800,
      paidAmount: 7200, dueAmount: 0,
      cashReceivedAmount: 10000, changeAmount: 2800,
      createdByUid: cashierUid, createdByName: 'မခင်မာ', createdByEmail: CASHIER_EMAIL,
    }),
    sale({
      id: 'sale-kpay-1', receiptNo: 'MM-20261110-00004', date: '2026-11-10T07:05:00.000Z',
      customer: 'ဦးအောင်မြင့်', customerId: 'cust-aung', paymentMethod: 'KPay',
      items: [saleItem(rice, 20, 2300)], total: 46000, profit: 6000,
      paidAmount: 46000, dueAmount: 0,
      kpayTransactionReference: 'KBZ-20261110-88421',
      createdByUid: cashierUid, createdByName: 'မခင်မာ', createdByEmail: CASHIER_EMAIL,
    }),
    sale({
      id: 'sale-void-1', receiptNo: 'MM-20261104-00005', date: '2026-11-04T04:10:00.000Z',
      customer: 'ဦးအောင်မြင့်', customerId: 'cust-aung', paymentMethod: 'Credit', status: 'voided',
      items: [saleItem(tea, 5, 1600)], total: 8000, profit: 1200,
      paidAmount: 0, dueAmount: 8000, voidedAt: '2026-11-04T09:00:00.000Z', voidedByName: 'ဦးမင်းထွန်း',
      voidReason: 'ဆိုင်ခွဲ မှားယွင်းမှုကြောင့် ပယ်ဖျက်သည်',
      createdByUid: cashierUid, createdByName: 'မခင်မာ', createdByEmail: CASHIER_EMAIL,
    }),
    sale({
      id: 'sale-legacy-1', receiptNo: 'MM-20260920-00006', date: '2026-09-20T03:00:00.000Z',
      customer: 'ဒေါ်သီရိလှ', customerId: 'cust-thiri', paymentMethod: 'Credit',
      items: [saleItem(rice, 5, 2300), saleItem(oil, 3, 5200)], total: 27100, profit: 1900,
      paidAmount: 0, dueAmount: 27100,
      createdByUid: cashierUid, createdByName: 'မခင်မာ', createdByEmail: CASHIER_EMAIL,
    }),
    sale({
      id: 'sale-credit-3', receiptNo: 'MM-20261101-00007', date: '2026-11-01T02:30:00.000Z',
      customer: 'ဒေါ်သီရိလှ', customerId: 'cust-thiri', paymentMethod: 'Credit',
      items: [saleItem(water, 10, 700), saleItem(rice, 5, 2300)], total: 18500, profit: 2000,
      paidAmount: 5000, dueAmount: 13500,
      createdByUid: cashierUid, createdByName: 'မခင်မာ', createdByEmail: CASHIER_EMAIL,
    }),
  ];
  for (const record of sales) await writeBranchRecord(BRANCH_MAIN, 'sales', record.id, record);

  const payments = [
    { id: 'pay-1', customerId: 'cust-aung', saleId: 'sale-credit-1', amount: 10000, date: '2026-10-12T02:00:00.000Z', note: 'အောက်တိုဘာ ကြိုတင်ငွေ', paymentMethod: 'Cash', branchId: BRANCH_MAIN },
    { id: 'pay-2', customerId: 'cust-thiri', saleId: 'sale-credit-3', amount: 5000, date: '2026-11-02T02:00:00.000Z', note: 'ငွေပေးချေမှု', paymentMethod: 'Cash', branchId: BRANCH_MAIN },
  ];
  for (const record of payments) await writeBranchRecord(BRANCH_MAIN, 'customerPayments', record.id, record);

  const otherBranchSale = sale({
    id: 'sale-lmd-credit-1', receiptNo: 'MM-20261103-00001', date: '2026-11-03T03:00:00.000Z',
    customer: 'ဦးအောင်မြင့်', customerId: 'cust-aung', paymentMethod: 'Credit',
    items: [saleItem(tea, 4, 1600)], total: 6400, profit: 800,
    paidAmount: 0, dueAmount: 6400,
    createdByUid: cashierOtherUid, createdByName: 'မသီတာ', createdByEmail: CASHIER_OTHER_EMAIL,
  });
  await writeBranchRecord(BRANCH_OTHER, 'sales', otherBranchSale.id, otherBranchSale);

  persistCredentials();

  console.log('Seeded demo-minimart-staging (local emulator only)');
  console.log(`Owner:          ${OWNER_EMAIL}`);
  console.log(`Cashier main:   ${CASHIER_EMAIL}`);
  console.log(`Cashier Lanmadaw: ${CASHIER_OTHER_EMAIL}`);
  console.log(`Disabled:       ${DISABLED_EMAIL}`);
  console.log(`Credentials:    ${CREDENTIALS_FILE} (mode 600, outside the repository)`);
  console.log(`Branches:       ${BRANCH_MAIN}, ${BRANCH_OTHER}`);
  console.log(`Records:        ${sales.length} sales, ${payments.length} payments, ${customers.length} customers, ${productsMain.length + productsOther.length} products`);
}

seed().catch((error) => {
  console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
