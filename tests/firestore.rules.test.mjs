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
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
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
      payload: { id: 'branch-a', name: 'Branch A', status: 'active', settings: {} },
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

test('Cashier email mismatch is denied even when UID and Member document exist', async () => {
  const mismatchedDb = dbFor(CASHIER_UID, 'attacker@example.com');
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


test('Cashier sale atomically reduces Product and allocated Batch stock with matching deltas', async () => {
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
      total: 3000, paymentMethod: 'Cash', productDeltas: { 'product-a': 2 },
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
  await assertSucceeds(batch.commit());
});

test('Cashier cannot create a v2 Sale without Batch allocation coverage', async () => {
  const cashierDb = dbFor(CASHIER_UID, 'cashier@example.com');
  const saleId = 'sale-without-batch-coverage';
  const now = new Date().toISOString();
  const saleRef = doc(cashierDb, `businesses/${BUSINESS_ID}/branches/branch-a/sales/${saleId}`);
  await assertFails(setDoc(saleRef, {
    scope: 'branchRecord', kind: 'sales', branchId: 'branch-a', deleted: false, updatedAt: now, updatedBy: CASHIER_UID,
    payload: {
      id: saleId, branchId: 'branch-a', createdByUid: CASHIER_UID, status: 'completed', receiptNo: 'R-NO-BATCH',
      items: [{ productId: 'product-a', quantity: 1, unitPrice: 1500, mode: 'retail' }],
      total: 1500, paymentMethod: 'Cash', productDeltas: { 'product-a': 1 },
      stockLines: [{ productId: 'product-a', quantity: 1 }],
      batchDeltas: {}, batchLines: [], cashierSyncVersion: 2,
    },
  }));
});

test('Cashier cannot reduce a Batch by more than the linked Sale batchDeltas', async () => {
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
      total: 3000, paymentMethod: 'Cash', productDeltas: { 'product-a': 2 },
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
