import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { beforeUserCreated, beforeUserSignedIn, HttpsError } from 'firebase-functions/v2/identity';

const adminApp = getApps()[0] || initializeApp();
const db = getFirestore(adminApp);
const BUSINESS_ID = 'store-mini-main';
const FUNCTION_REGION = 'asia-southeast1';

/**
 * Blocks all public/client-side Firebase Authentication account creation.
 * Existing users can still sign in. New authorized accounts are provisioned
 * by a trusted Firebase Admin / Console operator, then assigned a business role.
 */
export const blockPublicAccountRegistration = beforeUserCreated(
  { region: FUNCTION_REGION, timeoutSeconds: 7 },
  () => {
    throw new HttpsError(
      'permission-denied',
      'Public account registration is disabled. Contact the Minimart business owner.'
    );
  }
);

/**
 * Fail-closed sign-in authorization. Only the configured Business Owner or an
 * active Cashier assigned to exactly one Branch may sign in to this workspace.
 * Firestore Security Rules still enforce every subsequent data operation.
 */
export const allowOnlyOwnerAndActiveCashiers = beforeUserSignedIn(
  { region: FUNCTION_REGION, timeoutSeconds: 7 },
  async (event) => {
    const user = event.data;

    // Blocking events are expected to include a user record, but keep the
    // handler fail-closed and TypeScript-safe if the payload is absent.
    if (!user || typeof user.uid !== 'string' || !user.uid.trim()) {
      throw new HttpsError('unauthenticated', 'Unable to identify the signing-in account.');
    }

    const uid = user.uid;
    const email = (typeof user.email === 'string' ? user.email : '').trim().toLowerCase();

    try {
      const businessRef = db.collection('businesses').doc(BUSINESS_ID);
      const businessSnapshot = await businessRef.get();
      if (!businessSnapshot.exists) {
        throw new HttpsError('failed-precondition', 'Minimart Business configuration was not found.');
      }

      const business = businessSnapshot.data() || {};
      if (business.active === false) {
        throw new HttpsError('permission-denied', 'This Minimart Business is disabled.');
      }

      // Owner: the Firebase Auth UID must match the trusted business ownerUid.
      if (typeof business.ownerUid === 'string' && business.ownerUid === uid) {
        return;
      }

      // Cashier: one active member document, matching UID/email, exactly one Branch.
      const memberSnapshot = await businessRef.collection('members').doc(uid).get();
      if (!memberSnapshot.exists) {
        throw new HttpsError('permission-denied', 'Only an authorized Owner or Cashier may sign in.');
      }
      const member = memberSnapshot.data() || {};
      const memberEmail = typeof member.email === 'string' ? member.email.trim().toLowerCase() : '';
      const branchId = Array.isArray(member.branchIds) && member.branchIds.length === 1
        && typeof member.branchIds[0] === 'string' ? member.branchIds[0].trim() : '';
      const validCashierIdentity = member.uid === uid
        && member.role === 'cashier'
        && member.status === 'active'
        && !!branchId
        && !!email
        && memberEmail === email;

      if (!validCashierIdentity) {
        throw new HttpsError('permission-denied', 'Only an active Cashier assigned to one Branch may sign in.');
      }

      // Confirm the assigned Branch still exists and has not been archived.
      // Branch documents are stored as { payload: Branch, ...syncMetadata }.
      const branchSnapshot = await businessRef.collection('branches').doc(branchId).get();
      if (!branchSnapshot.exists) {
        throw new HttpsError('permission-denied', 'The assigned Cashier Branch does not exist. Contact the Owner.');
      }
      const branchRecord = branchSnapshot.data() || {};
      const branchPayload = branchRecord.payload && typeof branchRecord.payload === 'object'
        ? branchRecord.payload as Record<string, unknown>
        : branchRecord;
      if (branchPayload.status !== 'active') {
        throw new HttpsError('permission-denied', 'The assigned Cashier Branch is archived or inactive. Contact the Owner.');
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      // Fail closed when the role source cannot be verified.
      throw new HttpsError('unavailable', 'Unable to verify Minimart role. Please try again.');
    }
  }
);
