import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-minimart-pos-security';
const BUSINESS_ID = 'store-mini-main';
const OWNER_UID = 'owner-test-uid';
const CASHIER_UID = 'cashier-test-uid';
const OTHER_CASHIER_UID = 'other-cashier-test-uid';
const LEGACY_BOOTSTRAP_UID = 'LjZX15uSeehtIbyL4SqO1HcyLyC2';

let testEnv;

before(async () => {
  const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `businesses/${BUSINESS_ID}`), {
      ownerUid: OWNER_UID,
      active: true,
      name: 'Test Minimart',
    });

    await setDoc(doc(db, `businesses/${BUSINESS_ID}/branches/branch-a`), {
      scope: 'branch',
      kind: 'branch',
      payload: { id: 'branch-a', name: 'Branch A', status: 'active', settings: { kpayAccountName: 'Current Owner Account', kpayAccountNumber: '09970000000' } },
    });
    await setDoc(doc(db, `businesses/${BUSINESS_ID}/branches/branch-b`), {
      scope: 'branch',
      kind: 'branch',
      payload: { id: 'branch-b', name: 'Branch B', status: 'active', settings: {} },
    });
    await setDoc(doc(db, `businesses/${BUSINESS_ID}/branches/branch-archived`), {
      scope: 'branch',
      kind: 'branch',
      payload: { id: 'branch-archived', name: 'Archived', status: 'archived', settings: {} },
    });

    await setDoc(doc(db, `businesses/${BUSINESS_ID}/members/${CASHIER_UID}`), {
      uid: CASHIER_UID,
      email: 'cashier@example.com',
      displayName: 'Test Cashier',
      role: 'cashier',
      status: 'active',
      branchIds: ['branch-a'],
    });
    await setDoc(doc(db, `businesses/${BUSINESS_ID}/members/${OTHER_CASHIER_UID}`), {
      uid: OTHER_CASHIER_UID,
      email: 'other@example.com',
      displayName: 'Other Cashier',
      role: 'cashier',
      status: 'active',
      branchIds: ['branch-b'],
    });
    await setDoc(doc(db, `businesses/${BUSINESS_ID}/branches/branch-a/products/product-a`), {
      scope: 'branchRecord', kind: 'products', branchId: 'branch-a', deleted: false,
      updatedAt: new Date().toISOString(), updatedBy: OWNER_UID,
      payload: { id: 'product-a', branchId: 'branch-a', name: 'Product A', stock: 12 },
    });
    await setDoc(doc(db, `businesses/${BUSINESS_ID}/branches/branch-b/products/product-b`), {
      scope: 'branchRecord', kind: 'products', branchId: 'branch-b', deleted: false,
      updatedAt: new Date().toISOString(), updatedBy: OWNER_UID,
      payload: { id: 'product-b', branchId: 'branch-b', name: 'Product B', stock: 8 },
    });
    await setDoc(doc(db, `businesses/${BUSINESS_ID}/branches/branch-a/stockBatches/batch-a`), {
      scope: 'branchRecord', kind: 'stockBatches', branchId: 'branch-a', deleted: false,
      updatedAt: new Date().toISOString(), updatedBy: OWNER_UID,
      payload: { id: 'batch-a', branchId: 'branch-a', productId: 'product-a', quantity: 10, expiryDate: '2027-12-31' },
    });
    await setDoc(doc(db, `businesses/${BUSINESS_ID}/branches/branch-a/stockUnitRegistries/unit-registry-branch-a-product-a-0`), {
      scope: 'branchRecord', kind: 'stockUnitRegistries', branchId: 'branch-a', deleted: false,
      updatedAt: new Date().toISOString(), updatedBy: OWNER_UID,
      payload: {
        id: 'unit-registry-branch-a-product-a-0', branchId: 'branch-a', productId: 'product-a', chunkIndex: 0,
        units: [{ id: 'unit-a-1', barcode: 'STICKER-A-1', barcodeSource: 'purchased_sticker', status: 'in_stock', registeredAt: new Date().toISOString() }],
        updatedAt: new Date().toISOString(),
      },
    });
    await setDoc(doc(db, `businesses/${BUSINESS_ID}/branches/branch-b/stockUnitRegistries/unit-registry-branch-b-product-b-0`), {
      scope: 'branchRecord', kind: 'stockUnitRegistries', branchId: 'branch-b', deleted: false,
      updatedAt: new Date().toISOString(), updatedBy: OWNER_UID,
      payload: {
        id: 'unit-registry-branch-b-product-b-0', branchId: 'branch-b', productId: 'product-b', chunkIndex: 0,
        units: [], updatedAt: new Date().toISOString(),
      },
    });
    await setDoc(doc(db, `businesses/${BUSINESS_ID}/shared/priceGroups/records/group-a`), {
      scope: 'shared', kind: 'priceGroups', deleted: false,
      updatedAt: new Date().toISOString(), updatedBy: OWNER_UID,
      payload: {
        id: 'group-a', name: 'Shared Cola Price', retailPrice: 1500, wholesalePrice: 1350,
        currency: 'MMK', version: 1, status: 'active',
        membersByBranch: { 'branch-a': 'product-a', 'branch-b': 'product-b' },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    });
    await setDoc(doc(db, `businesses/${BUSINESS_ID}/shared/customers/records/customer-a`), {
      scope: 'shared', kind: 'customers', deleted: false,
      updatedAt: new Date().toISOString(), updatedBy: OWNER_UID,
      payload: { id: 'customer-a', name: 'Customer A', phone: '09123456789' },
    });
    await setDoc(doc(db, `businesses/${BUSINESS_ID}/shared/suppliers/records/supplier-a`), {
      scope: 'shared', kind: 'suppliers', deleted: false,
      updatedAt: new Date().toISOString(), updatedBy: OWNER_UID,
      payload: { id: 'supplier-a', name: 'Supplier A', phone: '09987654321', note: 'Owner-only terms' },
    });
    for (const [id, createdByUid] of [['expense-own', CASHIER_UID], ['expense-other', OTHER_CASHIER_UID]]) {
      await setDoc(doc(db, `businesses/${BUSINESS_ID}/branches/branch-a/expenses/${id}`), {
        scope: 'branchRecord', kind: 'expenses', branchId: 'branch-a', deleted: false,
        updatedAt: new Date().toISOString(), updatedBy: createdByUid,
        payload: { id, branchId: 'branch-a', createdByUid, title: 'Expense', amount: 100 },
      });
    }
    for (const [id, cashierUid] of [['settlement-own', CASHIER_UID], ['settlement-other', OTHER_CASHIER_UID]]) {
      await setDoc(doc(db, `businesses/${BUSINESS_ID}/branches/branch-a/cashierSettlements/${id}`), {
        scope: 'branchRecord', kind: 'cashierSettlements', branchId: 'branch-a', deleted: false,
        updatedAt: new Date().toISOString(), updatedBy: OWNER_UID,
        payload: { id, branchId: 'branch-a', cashierUid, amount: 1000, createdAt: new Date().toISOString() },
      });
    }
  });
});

after(async () => {
  await testEnv?.cleanup();
});

function dbFor(uid, email) {
  return testEnv.authenticatedContext(uid, { email }).firestore();
}

test('unauthenticated users cannot read Business or Branch Products', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, `businesses/${BUSINESS_ID}`)));
  await assertFails(getDoc(doc(db, `businesses/${BUSINESS_ID}/branches/branch-a/products/product-a`)));
});

test('only the ownerUid on the Business document receives ongoing Owner access', async () => {
  const ownerDb = dbFor(OWNER_UID, 'owner@example.com');
  await assertSucceeds(getDoc(doc(ownerDb, `businesses/${BUSINESS_ID}`)));
  await assertSucceeds(getDocs(collection(ownerDb, `businesses/${BUSINESS_ID}/branches`)));

  // The legacy bootstrap UID may initialize the Business document, but must not
  // retain Owner privileges once a different ownerUid has been provisioned.
  const staleOwnerDb = dbFor(LEGACY_BOOTSTRAP_UID, 'legacy-owner@example.com');
  await assertFails(getDoc(doc(staleOwnerDb, `businesses/${BUSINESS_ID}/branches/branch-a/products/product-a`)));
  await assertFails(getDocs(collection(staleOwnerDb, `businesses/${BUSINESS_ID}/members`)));
});

test('active Cashier can read only their assigned active Branch data', async () => {
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  await assertSucceeds(getDoc(doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/products/product-a`)));
  await assertSucceeds(getDocs(collection(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/products`)));
  await assertFails(getDoc(doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-b/products/product-b`)));
  await assertFails(getDoc(doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-archived`)));
  await assertFails(getDocs(collection(cashierDb, `businesses/${BUSINESS_ID}/branches`)));
});

test('Cashier can read Branch Unit Barcode registries but cannot write them', async () => {
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const registryRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/stockUnitRegistries/unit-registry-branch-a-product-a-0`);
  await assertSucceeds(getDoc(registryRef));
  await assertSucceeds(getDocs(collection(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/stockUnitRegistries`)));
  await assertFails(getDoc(doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-b/stockUnitRegistries/unit-registry-branch-b-product-b-0`)));
  await assertFails(getDocs(collection(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-b/stockUnitRegistries`)));

  // Unit status transitions are committed by the server-authoritative callable;
  // Cashiers must never mutate the registry directly.
  const registryPayload = {
    scope: 'branchRecord', kind: 'stockUnitRegistries', branchId: 'branch-a', deleted: false,
    updatedAt: new Date().toISOString(), updatedBy: CASHIER_UID,
    payload: {
      id: 'unit-registry-branch-a-product-a-0', branchId: 'branch-a', productId: 'product-a', chunkIndex: 0,
      units: [{ id: 'unit-a-1', barcode: 'STICKER-A-1', barcodeSource: 'purchased_sticker', status: 'sold', saleId: 'fake-sale', registeredAt: new Date().toISOString() }],
      updatedAt: new Date().toISOString(),
    },
  };
  await assertFails(setDoc(doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/stockUnitRegistries/unit-registry-cashier-created`), {
    ...registryPayload, payload: { ...registryPayload.payload, id: 'unit-registry-cashier-created' },
  }));
  await assertFails(setDoc(registryRef, registryPayload));
  await assertFails(updateDoc(registryRef, { 'payload.units': registryPayload.payload.units }));
  await assertFails(deleteDoc(registryRef));

  const ownerDb = dbFor(OWNER_UID, 'owner@example.com');
  await assertSucceeds(getDoc(doc(ownerDb, `businesses/${BUSINESS_ID}/branches/branch-b/stockUnitRegistries/unit-registry-branch-b-product-b-0`)));
});

test('Cashier reads only their own Return records; Return writes stay server-only', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    for (const [id, actorUid] of [['return-own', CASHIER_UID], ['return-other', OTHER_CASHIER_UID]]) {
      await setDoc(doc(adminDb, `businesses/${BUSINESS_ID}/branches/branch-a/saleReturns/${id}`), {
        id, eventType: 'SALE_RETURN', branchId: 'branch-a', saleId: 'sale-a',
        actorUid, actorName: 'Cashier', occurredAt: new Date().toISOString(),
        value: 500, refund: { method: 'Cash', amount: 500, status: 'cash-refunded' },
      });
    }
  });

  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const ownRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/saleReturns/return-own`);
  const otherRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/saleReturns/return-other`);
  await assertSucceeds(getDoc(ownRef));
  await assertFails(getDoc(otherRef));
  await assertSucceeds(getDocs(query(
    collection(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/saleReturns`),
    where('actorUid', '==', CASHIER_UID), limit(100),
  )));
  await assertFails(getDocs(query(
    collection(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/saleReturns`), limit(100),
  )));

  const returnPayload = {
    id: 'return-client', eventType: 'SALE_RETURN', branchId: 'branch-a', saleId: 'sale-a',
    actorUid: CASHIER_UID, actorName: 'Cashier', occurredAt: new Date().toISOString(), value: 500,
  };
  await assertFails(setDoc(doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/saleReturns/return-client`), returnPayload));
  await assertFails(setDoc(ownRef, { ...returnPayload, id: 'return-own' }));
  await assertFails(updateDoc(ownRef, { value: 1 }));
  await assertFails(deleteDoc(ownRef));

  // Owner keeps read access, but Return records are Admin SDK-only writes.
  const ownerDb = dbFor(OWNER_UID, 'owner@example.com');
  await assertSucceeds(getDoc(doc(ownerDb, `businesses/${BUSINESS_ID}/branches/branch-a/saleReturns/return-own`)));
  await assertFails(setDoc(doc(ownerDb, `businesses/${BUSINESS_ID}/branches/branch-a/saleReturns/return-owner`), returnPayload));
  await assertFails(updateDoc(doc(ownerDb, `businesses/${BUSINESS_ID}/branches/branch-a/saleReturns/return-own`), { value: 1 }));
  await assertFails(deleteDoc(doc(ownerDb, `businesses/${BUSINESS_ID}/branches/branch-a/saleReturns/return-own`)));
});

test('Cashier cannot bypass tracked-unit validation with a legacy Sale, stock reduction or registry write', async () => {
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const now = new Date().toISOString();
  const saleId = 'sale-tracked-bypass';
  const saleRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/sales/${saleId}`);
  const productRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/products/product-a`);
  const batchRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/stockBatches/batch-a`);
  const registryRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/stockUnitRegistries/unit-registry-branch-a-product-a-0`);

  await assertFails(setDoc(saleRef, {
    scope: 'branchRecord', kind: 'sales', branchId: 'branch-a', deleted: false, updatedAt: now, updatedBy: CASHIER_UID,
    payload: {
      id: saleId, branchId: 'branch-a', createdByUid: CASHIER_UID, status: 'completed', receiptNo: 'R-TRACKED-BYPASS',
      items: [{ productId: 'product-a', quantity: 1, unitPrice: 1500, mode: 'retail', stockUnitSelections: [] }],
      subtotal: 1500, discount: 0, total: 1500, paidAmount: 1500, dueAmount: 0,
      paymentMethod: 'Cash', productDeltas: { 'product-a': 1 },
      stockLines: [{ productId: 'product-a', quantity: 1 }],
      batchDeltas: { 'batch-a': 1 }, batchLines: [{ batchId: 'batch-a', productId: 'product-a', quantity: 1 }],
      cashierSyncVersion: 2,
    },
  }));

  await assertFails(updateDoc(productRef, {
    'payload.stock': 11, updatedAt: now, updatedBy: CASHIER_UID, sourceSaleId: saleId,
  }));
  await assertFails(updateDoc(batchRef, {
    'payload.quantity': 9, updatedAt: now, updatedBy: CASHIER_UID, sourceSaleId: saleId,
  }));
  await assertFails(updateDoc(registryRef, {
    'payload.units': [{ id: 'unit-a-1', barcode: 'STICKER-A-1', status: 'sold', saleId }],
    updatedAt: now, updatedBy: CASHIER_UID, sourceSaleId: saleId,
  }));
});

test('Cashier cannot access another Business through a same-named Branch path', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'businesses/other-business'), {
      ownerUid: 'other-owner', active: true, name: 'Other Business',
    });
    await setDoc(doc(db, 'businesses/other-business/branches/branch-a'), {
      scope: 'branch', kind: 'branch',
      payload: { id: 'branch-a', name: 'Other Branch A', status: 'active', settings: {} },
    });
    await setDoc(doc(db, 'businesses/other-business/branches/branch-a/products/product-a'), {
      scope: 'branchRecord', kind: 'products', branchId: 'branch-a', deleted: false,
      updatedAt: new Date().toISOString(), updatedBy: 'other-owner',
      payload: { id: 'product-a', branchId: 'branch-a', name: 'Other Product', stock: 5 },
    });
    await setDoc(doc(db, 'businesses/other-business/branches/branch-a/stockUnitRegistries/unit-registry-other-0'), {
      scope: 'branchRecord', kind: 'stockUnitRegistries', branchId: 'branch-a', deleted: false,
      updatedAt: new Date().toISOString(), updatedBy: 'other-owner',
      payload: { id: 'unit-registry-other-0', branchId: 'branch-a', productId: 'product-a', chunkIndex: 0, units: [] },
    });
  });

  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  await assertFails(getDoc(doc(cashierDb, 'businesses/other-business')));
  await assertFails(getDoc(doc(cashierDb, 'businesses/other-business/branches/branch-a/products/product-a')));
  await assertFails(getDocs(collection(cashierDb, 'businesses/other-business/branches/branch-a/products')));
  await assertFails(getDoc(doc(cashierDb, 'businesses/other-business/branches/branch-a/stockUnitRegistries/unit-registry-other-0')));
  await assertFails(setDoc(doc(cashierDb, 'businesses/other-business/branches/branch-a/sales/sale-cross-business'), {
    scope: 'branchRecord', kind: 'sales', branchId: 'branch-a', deleted: false,
    updatedAt: new Date().toISOString(), updatedBy: CASHIER_UID,
    payload: { id: 'sale-cross-business', branchId: 'branch-a', createdByUid: CASHIER_UID, status: 'completed' },
  }));
});

test('Cashier email mismatch is denied even when UID and Member document exist', async () => {  const mismatchedDb = dbFor(CASHIER_UID, 'attacker@example.com');
  await assertFails(getDoc(doc(mismatchedDb, `businesses/${BUSINESS_ID}`)));
  await assertFails(getDoc(doc(mismatchedDb, `businesses/${BUSINESS_ID}/branches/branch-a/products/product-a`)));
});

test('Cashier with multiple Branch assignments is denied', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), `businesses/${BUSINESS_ID}/members/${CASHIER_UID}`), {
      branchIds: ['branch-a', 'branch-b'],
    });
  });
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  await assertFails(getDoc(doc(cashierDb, `businesses/${BUSINESS_ID}`)));
  await assertFails(getDoc(doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/products/product-a`)));
});

test('disabled Cashier cannot read Business workspace data', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), `businesses/${BUSINESS_ID}/members/${CASHIER_UID}`), { status: 'disabled' });
  });
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  await assertFails(getDoc(doc(cashierDb, `businesses/${BUSINESS_ID}`)));
  await assertFails(getDoc(doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/products/product-a`)));
});

test('Cashier cannot read Owner-only Shared Price Group master records', async () => {
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const ownerDb = dbFor(OWNER_UID, 'owner@example.com');
  await assertFails(getDoc(doc(cashierDb, `businesses/${BUSINESS_ID}/shared/priceGroups/records/group-a`)));
  await assertSucceeds(getDoc(doc(ownerDb, `businesses/${BUSINESS_ID}/shared/priceGroups/records/group-a`)));
});

test('Cashier reads Shared Customers only; Supplier records stay Owner-only', async () => {
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const ownerDb = dbFor(OWNER_UID, 'owner@example.com');
  const customerRef = doc(cashierDb, `businesses/${BUSINESS_ID}/shared/customers/records/customer-a`);
  const supplierRef = doc(cashierDb, `businesses/${BUSINESS_ID}/shared/suppliers/records/supplier-a`);

  await assertSucceeds(getDoc(customerRef));
  await assertSucceeds(getDocs(collection(cashierDb, `businesses/${BUSINESS_ID}/shared/customers/records`)));
  await assertFails(getDoc(supplierRef));
  await assertFails(getDocs(collection(cashierDb, `businesses/${BUSINESS_ID}/shared/suppliers/records`)));

  await assertSucceeds(getDoc(doc(ownerDb, `businesses/${BUSINESS_ID}/shared/suppliers/records/supplier-a`)));
  await assertSucceeds(getDocs(collection(ownerDb, `businesses/${BUSINESS_ID}/shared/suppliers/records`)));
});

test('Cashier lists only their own expenses and settlements', async () => {
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const ownerDb = dbFor(OWNER_UID, 'owner@example.com');
  const expenseCol = collection(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/expenses`);
  const settlementCol = collection(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/cashierSettlements`);

  await assertSucceeds(getDocs(query(expenseCol, where('payload.createdByUid', '==', CASHIER_UID), limit(100))));
  await assertFails(getDocs(query(expenseCol, limit(100))));
  await assertFails(getDocs(query(expenseCol, where('payload.createdByUid', '==', OTHER_CASHIER_UID), limit(100))));
  await assertSucceeds(getDoc(doc(expenseCol, 'expense-own')));
  await assertFails(getDoc(doc(expenseCol, 'expense-other')));

  await assertSucceeds(getDocs(query(settlementCol, where('payload.cashierUid', '==', CASHIER_UID), limit(100))));
  await assertFails(getDocs(query(settlementCol, limit(100))));
  await assertFails(getDocs(query(settlementCol, where('payload.cashierUid', '==', OTHER_CASHIER_UID), limit(100))));
  await assertSucceeds(getDoc(doc(settlementCol, 'settlement-own')));
  await assertFails(getDoc(doc(settlementCol, 'settlement-other')));

  await assertSucceeds(getDocs(collection(ownerDb, `businesses/${BUSINESS_ID}/branches/branch-a/expenses`)));
  await assertSucceeds(getDocs(collection(ownerDb, `businesses/${BUSINESS_ID}/branches/branch-a/cashierSettlements`)));
});

test('Owner cannot create a Cashier membership for an archived or missing Branch', async () => {
  const ownerDb = dbFor(OWNER_UID, 'owner@example.com');
  const invalidMember = {
    uid: 'new-cashier', email: 'new@example.com', displayName: 'New Cashier',
    role: 'cashier', status: 'active', branchIds: ['branch-archived'],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: OWNER_UID,
    canReceiveStock: false,
  };
  await assertFails(setDoc(doc(ownerDb, `businesses/${BUSINESS_ID}/members/new-cashier`), invalidMember));
  await assertFails(setDoc(doc(ownerDb, `businesses/${BUSINESS_ID}/members/missing-branch-cashier`), {
    ...invalidMember, uid: 'missing-branch-cashier', branchIds: ['does-not-exist'],
  }));
});

test('Owner cannot reassign a Cashier to an archived Branch', async () => {
  const ownerDb = dbFor(OWNER_UID, 'owner@example.com');
  const memberRef = doc(ownerDb, `businesses/${BUSINESS_ID}/members/${CASHIER_UID}`);
  await assertFails(updateDoc(memberRef, { branchIds: ['branch-archived'] }));
});

test('Owner can create a Cashier membership for one active Branch', async () => {
  const ownerDb = dbFor(OWNER_UID, 'owner@example.com');
  const validMember = {
    uid: 'new-cashier', email: 'new@example.com', displayName: 'New Cashier',
    role: 'cashier', status: 'active', branchIds: ['branch-a'],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: OWNER_UID,
    canReceiveStock: false,
  };
  await assertSucceeds(setDoc(doc(ownerDb, `businesses/${BUSINESS_ID}/members/new-cashier`), validMember));
});


test('Cashier cannot create a Sale or reduce Product and Batch stock directly, even with matching deltas', async () => {
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const saleId = 'sale-batch-001';
  const now = new Date().toISOString();
  const batch = writeBatch(cashierDb);
  const productRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/products/product-a`);
  const stockBatchRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/stockBatches/batch-a`);
  const saleRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/sales/${saleId}`);
  const auditRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/auditEvents/${saleId}__created`);
  batch.update(productRef, {
    payload: { id: 'product-a', branchId: 'branch-a', name: 'Product A', stock: 10 },
    updatedAt: now, updatedBy: CASHIER_UID, sourceSaleId: saleId,
  });
  batch.update(stockBatchRef, {
    payload: { id: 'batch-a', branchId: 'branch-a', productId: 'product-a', quantity: 8, expiryDate: '2027-12-31' },
    updatedAt: now, updatedBy: CASHIER_UID, sourceSaleId: saleId,
  });
  batch.set(saleRef, {
    scope: 'branchRecord', kind: 'sales', branchId: 'branch-a', deleted: false, updatedAt: now, updatedBy: CASHIER_UID,
    payload: {
      id: saleId, branchId: 'branch-a', createdByUid: CASHIER_UID, status: 'completed', receiptNo: 'R-BATCH-001',
      items: [{ productId: 'product-a', quantity: 2, unitPrice: 1500, mode: 'retail' }],
      subtotal: 3000, discount: 0, total: 3000, paidAmount: 3000, dueAmount: 0,
      paymentMethod: 'Cash', productDeltas: { 'product-a': 2 },
      stockLines: [{ productId: 'product-a', quantity: 2 }],
      batchDeltas: { 'batch-a': 2 }, batchLines: [{ batchId: 'batch-a', productId: 'product-a', quantity: 2 }],
      cashierSyncVersion: 2,
    },
  });
  batch.set(auditRef, {
    id: `${saleId}__created`, eventType: 'SALE_CREATED', branchId: 'branch-a', saleId,
    receiptNo: 'R-BATCH-001', actorUid: CASHIER_UID, actorEmail: 'cashier@example.com',
    actorName: 'Test Cashier', occurredAt: now, total: 3000,
  });
  await assertFails(batch.commit());
});

test('Cashier direct Sale is denied regardless of Batch allocation coverage', async () => {
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const saleId = 'sale-without-batch-coverage';
  const now = new Date().toISOString();
  const saleRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/sales/${saleId}`);
  await assertFails(setDoc(saleRef, {
    scope: 'branchRecord', kind: 'sales', branchId: 'branch-a', deleted: false, updatedAt: now, updatedBy: CASHIER_UID,
    payload: {
      id: saleId, branchId: 'branch-a', createdByUid: CASHIER_UID, status: 'completed', receiptNo: 'R-NO-BATCH',
      items: [{ productId: 'product-a', quantity: 1, unitPrice: 1500, mode: 'retail' }],
      subtotal: 1500, discount: 0, total: 1500, paidAmount: 1500, dueAmount: 0,
      paymentMethod: 'Cash', productDeltas: { 'product-a': 1 },
      stockLines: [{ productId: 'product-a', quantity: 1 }],
      batchDeltas: {}, batchLines: [], cashierSyncVersion: 2,
    },
  }));
});

test('Cashier cannot reduce a Batch through a linked Sale batchDeltas bypass', async () => {
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const saleId = 'sale-batch-mismatch';
  const now = new Date().toISOString();
  const batch = writeBatch(cashierDb);
  const productRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/products/product-a`);
  const stockBatchRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/stockBatches/batch-a`);
  const saleRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/sales/${saleId}`);
  const auditRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/auditEvents/${saleId}__created`);
  batch.update(productRef, {
    payload: { id: 'product-a', branchId: 'branch-a', name: 'Product A', stock: 10 },
    updatedAt: now, updatedBy: CASHIER_UID, sourceSaleId: saleId,
  });
  batch.update(stockBatchRef, {
    payload: { id: 'batch-a', branchId: 'branch-a', productId: 'product-a', quantity: 7, expiryDate: '2027-12-31' },
    updatedAt: now, updatedBy: CASHIER_UID, sourceSaleId: saleId,
  });
  batch.set(saleRef, {
    scope: 'branchRecord', kind: 'sales', branchId: 'branch-a', deleted: false, updatedAt: now, updatedBy: CASHIER_UID,
    payload: {
      id: saleId, branchId: 'branch-a', createdByUid: CASHIER_UID, status: 'completed', receiptNo: 'R-BATCH-002',
      items: [{ productId: 'product-a', quantity: 2, unitPrice: 1500, mode: 'retail' }],
      subtotal: 3000, discount: 0, total: 3000, paidAmount: 3000, dueAmount: 0,
      paymentMethod: 'Cash', productDeltas: { 'product-a': 2 },
      stockLines: [{ productId: 'product-a', quantity: 2 }],
      batchDeltas: { 'batch-a': 1 }, batchLines: [{ batchId: 'batch-a', productId: 'product-a', quantity: 1 }],
      cashierSyncVersion: 2,
    },
  });
  batch.set(auditRef, {
    id: `${saleId}__created`, eventType: 'SALE_CREATED', branchId: 'branch-a', saleId,
    receiptNo: 'R-BATCH-002', actorUid: CASHIER_UID, actorEmail: 'cashier@example.com',
    actorName: 'Test Cashier', occurredAt: now, total: 3000,
  });
  await assertFails(batch.commit());
});


test('Cashier cannot directly increase Product/Batch stock or Auto Approve a Shipment outside the server callable', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await updateDoc(doc(db, `businesses/${BUSINESS_ID}/members/${CASHIER_UID}`), { canReceiveStock: true });
    await setDoc(doc(db, `businesses/${BUSINESS_ID}/branches/branch-a/stockShipments/shipment-auto-test`), {
      scope: 'branchRecord', kind: 'stockShipments', branchId: 'branch-a', deleted: false,
      updatedAt: new Date().toISOString(), updatedBy: OWNER_UID,
      payload: {
        id: 'shipment-auto-test', branchId: 'branch-a', fromBranchId: 'branch-b', toBranchId: 'branch-a',
        status: 'dispatched', items: [{ sourceProductId: 'source-product', quantity: 1, batchAllocations: [{ sourceBatchId: 'source-batch', quantity: 1 }] }],
      },
    });
  });

  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const now = new Date().toISOString();
  const productRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/products/product-a`);
  const batchRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/stockBatches/batch-a`);
  const shipmentRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/stockShipments/shipment-auto-test`);

  await assertFails(updateDoc(productRef, {
    payload: { id: 'product-a', branchId: 'branch-a', name: 'Product A', stock: 13 },
    updatedAt: now, updatedBy: CASHIER_UID,
    sourceShipmentId: 'shipment-auto-test', sourceShipmentLineIndex: 0,
  }));
  await assertFails(setDoc(doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/products/new-shipment-product`), {
    scope: 'branchRecord', kind: 'products', branchId: 'branch-a', deleted: false,
    payload: { id: 'new-shipment-product', branchId: 'branch-a', name: 'Unauthorized Product', stock: 1 },
    updatedAt: now, updatedBy: CASHIER_UID, sourceShipmentId: 'shipment-auto-test',
  }));
  await assertFails(updateDoc(batchRef, {
    payload: { id: 'batch-a', branchId: 'branch-a', productId: 'product-a', quantity: 11, expiryDate: '2027-12-31' },
    updatedAt: now, updatedBy: CASHIER_UID,
    sourceShipmentId: 'shipment-auto-test', sourceShipmentLineIndex: 0, sourceShipmentBatchIndex: 0,
  }));
  await assertFails(setDoc(doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/stockBatches/new-shipment-batch`), {
    scope: 'branchRecord', kind: 'stockBatches', branchId: 'branch-a', deleted: false,
    payload: { id: 'new-shipment-batch', branchId: 'branch-a', productId: 'product-a', quantity: 1 },
    updatedAt: now, updatedBy: CASHIER_UID, sourceShipmentId: 'shipment-auto-test',
  }));
  await assertFails(updateDoc(shipmentRef, {
    payload: {
      id: 'shipment-auto-test', branchId: 'branch-a', fromBranchId: 'branch-b', toBranchId: 'branch-a',
      status: 'approved', completionMode: 'auto', autoCompletedByUid: CASHIER_UID,
      items: [{ sourceProductId: 'source-product', quantity: 1 }],
      receivedItems: [{ sourceProductId: 'source-product', receivedQuantity: 1, damagedQuantity: 0 }],
    },
    updatedAt: now, updatedBy: CASHIER_UID,
  }));
});

// ---------------------------------------------------------------------------
// P1 financial hardening: expense approval threshold, cash record integrity,
// credit-payment propagation and sale total reconciliation.
// ---------------------------------------------------------------------------

const cashierEnvelope = (kind, payload, branchId = 'branch-a') => ({
  scope: 'branchRecord', kind, branchId, deleted: false,
  updatedAt: new Date().toISOString(), updatedBy: CASHIER_UID,
  payload: { ...payload, branchId },
});

const expensePayload = (id, amount, approvalStatus) => ({
  id, branchId: 'branch-a', title: 'Cleaning supplies', category: 'Operation',
  amount, date: new Date().toISOString(), note: '',
  createdByUid: CASHIER_UID, createdByEmail: 'cashier@example.com', createdByName: 'Test Cashier',
  fundedBy: 'branch-cash', paymentMethod: 'cash', approvalStatus,
  updatedAt: new Date().toISOString(), updatedByUid: CASHIER_UID,
});

test('Cashier expense above the Branch approval limit cannot be auto-approved', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), `businesses/${BUSINESS_ID}/branches/branch-a`), {
      'payload.settings.cashierExpenseApprovalLimit': 1000,
    });
  });
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const expenseRef = (id) => doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/expenses/${id}`);

  await assertFails(setDoc(expenseRef('exp-over-limit-auto'), cashierEnvelope('expenses', expensePayload('exp-over-limit-auto', 5000, 'not-required'))));
  await assertSucceeds(setDoc(expenseRef('exp-over-limit-pending'), cashierEnvelope('expenses', expensePayload('exp-over-limit-pending', 5000, 'pending'))));
  await assertSucceeds(setDoc(expenseRef('exp-under-limit'), cashierEnvelope('expenses', expensePayload('exp-under-limit', 500, 'not-required'))));
});

test('Cashier Cash Shift and Movement payloads must be complete and linked', async () => {
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const shiftRef = (id) => doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/cashShifts/${id}`);
  const movementRef = (id) => doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/cashMovements/${id}`);
  const openShift = (id) => ({
    id, branchId: 'branch-a', openedAt: new Date().toISOString(), openedBy: 'Test Cashier', openedByUid: CASHIER_UID,
    openingCash: 1000, note: '',
  });
  const opened = openShift('shift-1');

  await assertSucceeds(setDoc(shiftRef('shift-1'), cashierEnvelope('cashShifts', opened)));
  await assertFails(setDoc(shiftRef('shift-negative'), cashierEnvelope('cashShifts', { ...openShift('shift-negative'), openingCash: -1 })));
  await assertFails(setDoc(shiftRef('shift-spoofed'), cashierEnvelope('cashShifts', { ...openShift('shift-spoofed'), openedByUid: OTHER_CASHIER_UID })));

  const movement = (id, shiftId, amount = 100) => ({
    id, shiftId, date: new Date().toISOString(), direction: 'in', amount, note: 'Cash in',
    createdByUid: CASHIER_UID, createdByName: 'Test Cashier',
  });
  await assertFails(setDoc(movementRef('movement-missing-shift'), cashierEnvelope('cashMovements', movement('movement-missing-shift', 'missing-shift'))));
  await assertFails(setDoc(movementRef('movement-invalid-amount'), cashierEnvelope('cashMovements', movement('movement-invalid-amount', 'shift-1', 0))));
  await assertSucceeds(setDoc(movementRef('movement-valid'), cashierEnvelope('cashMovements', movement('movement-valid', 'shift-1'))));

  const closing = (overrides) => ({
    ...opened, closedAt: new Date().toISOString(), closedByUid: CASHIER_UID,
    closedByName: 'Test Cashier', closingCash: 900, expectedCash: 1000, variance: -100, ...overrides,
  });
  await assertFails(updateDoc(shiftRef('shift-1'), {
    payload: closing({ variance: 0 }), updatedAt: new Date().toISOString(), updatedBy: CASHIER_UID,
  }));
  await assertSucceeds(updateDoc(shiftRef('shift-1'), {
    payload: closing({}), updatedAt: new Date().toISOString(), updatedBy: CASHIER_UID,
  }));
  await assertFails(setDoc(movementRef('movement-after-close'), cashierEnvelope('cashMovements', movement('movement-after-close', 'shift-1'))));
});

test('Cashier Customer Payment must reference a Credit sale and cannot exceed its due', async () => {
  const now = new Date().toISOString();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `businesses/${BUSINESS_ID}/branches/branch-a/sales/credit-sale-1`), {
      scope: 'branchRecord', kind: 'sales', branchId: 'branch-a', deleted: false,
      updatedAt: now, updatedBy: OWNER_UID,
      payload: {
        id: 'credit-sale-1', branchId: 'branch-a', status: 'completed', paymentMethod: 'Credit',
        customerId: 'customer-1', total: 3000, paidAmount: 0, dueAmount: 3000,
        items: [{ productId: 'product-a', quantity: 1, unitPrice: 3000, mode: 'retail' }],
        createdByUid: CASHIER_UID,
      },
    });
  });
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const paymentRef = (id) => doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/customerPayments/${id}`);
  const payment = (id, overrides = {}) => ({
    id, customerId: 'customer-1', saleId: 'credit-sale-1', amount: 1000,
    date: new Date().toISOString(), note: '', paymentMethod: 'Cash', ...overrides,
  });

  await assertFails(setDoc(paymentRef('payment-missing-sale'), cashierEnvelope('customerPayments', payment('payment-missing-sale', { saleId: 'no-such-sale' }))));
  await assertFails(setDoc(paymentRef('payment-wrong-customer'), cashierEnvelope('customerPayments', payment('payment-wrong-customer', { customerId: 'other-customer' }))));
  await assertFails(setDoc(paymentRef('payment-over-due'), cashierEnvelope('customerPayments', payment('payment-over-due', { amount: 4000 }))));
  await assertSucceeds(setDoc(paymentRef('payment-valid'), cashierEnvelope('customerPayments', payment('payment-valid'))));
});

test('Cashier Credit Sale payment updates must be monotonic and reconcile to the total', async () => {
  const now = new Date().toISOString();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `businesses/${BUSINESS_ID}/branches/branch-a/sales/credit-sale-2`), {
      scope: 'branchRecord', kind: 'sales', branchId: 'branch-a', deleted: false,
      updatedAt: now, updatedBy: OWNER_UID,
      payload: {
        id: 'credit-sale-2', branchId: 'branch-a', status: 'completed', paymentMethod: 'Credit',
        customerId: 'customer-1', total: 3000, paidAmount: 0, dueAmount: 3000,
        items: [{ productId: 'product-a', quantity: 1, unitPrice: 3000, mode: 'retail' }],
        createdByUid: CASHIER_UID,
      },
    });
  });
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const saleRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/sales/credit-sale-2`);

  await assertSucceeds(updateDoc(saleRef, {
    'payload.paidAmount': 1000, 'payload.dueAmount': 2000,
    updatedAt: now, updatedBy: CASHIER_UID,
  }));
  await assertFails(updateDoc(saleRef, {
    'payload.paidAmount': 500, 'payload.dueAmount': 2500,
    updatedAt: now, updatedBy: CASHIER_UID,
  }));
  await assertFails(updateDoc(saleRef, {
    'payload.paidAmount': 1000, 'payload.dueAmount': 1500,
    updatedAt: now, updatedBy: CASHIER_UID,
  }));
});

test('Cashier cannot create a Sale with mismatched totals directly', async () => {
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const now = new Date().toISOString();
  const saleRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/sales/sale-total-mismatch`);
  await assertFails(setDoc(saleRef, {
    scope: 'branchRecord', kind: 'sales', branchId: 'branch-a', deleted: false, updatedAt: now, updatedBy: CASHIER_UID,
    payload: {
      id: 'sale-total-mismatch', branchId: 'branch-a', createdByUid: CASHIER_UID, status: 'completed', receiptNo: 'R-TOTAL-BAD',
      items: [{ productId: 'product-a', quantity: 2, unitPrice: 1500, mode: 'retail' }],
      subtotal: 3000, discount: 0, total: 2000, paidAmount: 2000, dueAmount: 0,
      paymentMethod: 'Cash', productDeltas: { 'product-a': 2 },
      stockLines: [{ productId: 'product-a', quantity: 2 }],
      batchDeltas: { 'batch-a': 2 }, batchLines: [{ batchId: 'batch-a', productId: 'product-a', quantity: 2 }],
      cashierSyncVersion: 2,
    },
  }));
});

// ---------------------------------------------------------------------------
// V3.2.6 KPay history: each transaction freezes the branch account it used.
// Snapshots are validated for shape/size only and are never compared with the
// branch's current KPay settings, so changing the account keeps history valid.
// ---------------------------------------------------------------------------

const kpaySalePayload = (id, overrides = {}) => ({
  id, branchId: 'branch-a', createdByUid: CASHIER_UID, status: 'completed', receiptNo: `R-${id}`,
  items: [{ productId: 'product-a', quantity: 1, unitPrice: 1500, mode: 'retail' }],
  subtotal: 1500, discount: 0, total: 1500, paidAmount: 1500, dueAmount: 0,
  paymentMethod: 'KPay', kpayTransactionReference: `TX-${id}`,
  productDeltas: { 'product-a': 1 }, stockLines: [{ productId: 'product-a', quantity: 1 }],
  batchDeltas: { 'batch-a': 1 }, batchLines: [{ batchId: 'batch-a', productId: 'product-a', quantity: 1 }],
  cashierSyncVersion: 2,
  ...overrides,
});

const kpaySaleEnvelope = (id, payload) => ({
  scope: 'branchRecord', kind: 'sales', branchId: 'branch-a', deleted: false,
  updatedAt: new Date().toISOString(), updatedBy: CASHIER_UID,
  payload,
});

test('Cashier cannot create a KPay Sale directly, even with historical account snapshots', async () => {
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const saleRef = (id) => doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/sales/${id}`);

  await assertFails(setDoc(saleRef('sale-kpay-history'), kpaySaleEnvelope('sale-kpay-history', kpaySalePayload('sale-kpay-history', {
    kpayAccountNameSnapshot: 'Previous Owner Account',
    kpayAccountNumberSnapshot: '09510000000',
    kpayAccountLabelSnapshot: 'Old KPay',
    kpayQrVersionSnapshot: 3,
  }))));

  await assertFails(setDoc(saleRef('sale-kpay-oversized'), kpaySaleEnvelope('sale-kpay-oversized', kpaySalePayload('sale-kpay-oversized', {
    kpayAccountNameSnapshot: 'x'.repeat(121),
  }))));
});

test('Customer Payment stores KPay account snapshots without matching current settings', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `businesses/${BUSINESS_ID}/branches/branch-a/sales/credit-sale-kpay`), {
      scope: 'branchRecord', kind: 'sales', branchId: 'branch-a', deleted: false,
      updatedAt: new Date().toISOString(), updatedBy: OWNER_UID,
      payload: {
        id: 'credit-sale-kpay', branchId: 'branch-a', status: 'completed', paymentMethod: 'Credit',
        customerId: 'customer-1', total: 3000, paidAmount: 0, dueAmount: 3000,
        items: [{ productId: 'product-a', quantity: 1, unitPrice: 3000, mode: 'retail' }],
        createdByUid: CASHIER_UID,
      },
    });
  });
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const paymentRef = (id) => doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/customerPayments/${id}`);
  const payment = (id, overrides = {}) => ({
    id, customerId: 'customer-1', saleId: 'credit-sale-kpay', amount: 1000,
    date: new Date().toISOString(), note: '', paymentMethod: 'Transfer', ...overrides,
  });

  await assertSucceeds(setDoc(paymentRef('payment-kpay-history'), cashierEnvelope('customerPayments', payment('payment-kpay-history', {
    kpayAccountNameSnapshot: 'Previous Owner Account',
    kpayAccountNumberSnapshot: '09510000000',
    kpayAccountLabelSnapshot: 'Old KPay',
    kpayQrVersionSnapshot: 2,
  }))));
  await assertFails(setDoc(paymentRef('payment-kpay-oversized'), cashierEnvelope('customerPayments', payment('payment-kpay-oversized', {
    kpayAccountNumberSnapshot: 'y'.repeat(121),
  }))));
});

// ---------------------------------------------------------------------------
// V3.2.6 Branch KPay QR: Owner-managed inline raster only, capped at 60,000
// characters. The QR travels inside the Branch document so Cashiers can read
// it from the Firestore cache while offline.
// ---------------------------------------------------------------------------

const branchEnvelope = (settings, overrides = {}) => ({
  scope: 'branch', kind: 'branches', deleted: false,
  updatedAt: new Date().toISOString(), updatedBy: OWNER_UID,
  payload: {
    id: 'branch-a', name: 'Branch A', status: 'active',
    settings: { kpayAccountName: 'Current Owner Account', kpayAccountNumber: '09970000000', ...settings },
  },
  ...overrides,
});

test('Owner stores a valid inline KPay QR on the Branch document', async () => {
  const ownerDb = dbFor(OWNER_UID, 'owner@example.com');
  const branchRef = doc(ownerDb, `businesses/${BUSINESS_ID}/branches/branch-a`);

  await assertSucceeds(setDoc(branchRef, branchEnvelope({
    kpayQrDataUrl: 'data:image/png;base64,AAAA',
    kpayQrVersion: 1,
    kpayQrUpdatedAt: new Date().toISOString(),
    kpayQrUpdatedBy: OWNER_UID,
  })));

  await assertSucceeds(setDoc(branchRef, branchEnvelope({ kpayQrDataUrl: '', kpayQrVersion: 2 })));
});

test('Owner cannot store SVG, remote or oversized KPay QR values', async () => {
  const ownerDb = dbFor(OWNER_UID, 'owner@example.com');
  const branchRef = doc(ownerDb, `businesses/${BUSINESS_ID}/branches/branch-a`);

  await assertFails(setDoc(branchRef, branchEnvelope({
    kpayQrDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  })));
  await assertFails(setDoc(branchRef, branchEnvelope({
    kpayQrDataUrl: 'https://example.com/kpay-qr.png',
  })));
  await assertFails(setDoc(branchRef, branchEnvelope({
    kpayQrDataUrl: `data:image/png;base64,${'A'.repeat(60000)}`,
  })));
  await assertFails(setDoc(branchRef, branchEnvelope({
    kpayQrDataUrl: 'data:image/png;base64,AAAA',
    kpayQrVersion: -1,
  })));
});

test('Cashier cannot change the Branch KPay QR; Branch tombstone updates stay valid', async () => {
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const ownerDb = dbFor(OWNER_UID, 'owner@example.com');

  await assertFails(setDoc(doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a`), branchEnvelope({
    kpayQrDataUrl: 'data:image/png;base64,AAAA',
  })));

  // Sync writes a deleted Branch as a tombstone with a null payload; the new
  // settings validation must not block that shape.
  await assertSucceeds(setDoc(doc(ownerDb, `businesses/${BUSINESS_ID}/branches/branch-a`), {
    scope: 'branch', kind: 'branches', deleted: true, payload: null,
    updatedAt: new Date().toISOString(), updatedBy: OWNER_UID,
  }));
});
