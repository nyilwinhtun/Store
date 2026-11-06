import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, getDocFromServer, type DocumentReference } from 'firebase/firestore';
import { FIREBASE_BUSINESS_ID, firebaseApp, firebaseAuth, firestore } from '../lib/firebase';
import { useBusinessAccess, type BusinessRole } from '../lib/businessAccess';

const REQUEST_TIMEOUT_MS = 15000;

type FirebaseErrorLike = Error & { code?: string };

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
}

function isNetworkError(error: unknown): boolean {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return ['unavailable', 'deadline-exceeded', 'cancelled', 'unknown', 'network-request-failed'].includes(code)
    || message.includes('network') || message.includes('internet') || message.includes('offline');
}

function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const error = new Error(`${label}: 15 seconds ကျော်သွားပါပြီ။ Internet ချိတ်ဆက်မှုကို စစ်ဆေးပါ။`) as FirebaseErrorLike;
      error.code = 'deadline-exceeded';
      reject(error);
    }, REQUEST_TIMEOUT_MS);
    operation.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

async function readAccessDocument(reference: DocumentReference, label: string) {
  try {
    return await withTimeout(getDocFromServer(reference), label);
  } catch (serverError) {
    if (!isNetworkError(serverError)) throw serverError;
    // Firestore is configured with persistent IndexedDB cache. When the device
    // is offline, allow a previously cached Owner / Member document to unlock
    // the POS; an account never verified on this device still cannot enter.
    try {
      const cached = await withTimeout(getDoc(reference), `${label} (local cache)`);
      if (cached.metadata.fromCache && cached.exists()) return cached;
    } catch {
      // Preserve the original server/network error for the UI.
    }
    throw serverError;
  }
}

/**
 * Resolves access with one-time server reads instead of a permanent onSnapshot
 * listener. Owners are primarily identified by businesses/{businessId}.ownerUid;
 * Cashiers are checked through businesses/{businessId}/members/{uid}.
 */
export function AccessBootstrap() {
  const setAccess = useBusinessAccess((state) => state.setAccess);
  const resetAccess = useBusinessAccess((state) => state.resetAccess);

  useEffect(() => {
    if (!firebaseAuth || !firestore || !firebaseApp) {
      resetAccess();
      return;
    }

    let disposed = false;
    let generation = 0;

    const unsubscribeAuth = onAuthStateChanged(firebaseAuth, (user) => {
      const currentGeneration = ++generation;
      const isCurrent = () => !disposed && currentGeneration === generation;

      if (!user) {
        resetAccess();
        return;
      }

      const businessPath = `businesses/${FIREBASE_BUSINESS_ID}`;
      const membershipPath = `${businessPath}/members/${user.uid}`;
      console.info('[Minimart Firebase Access]', {
        projectId: firebaseApp.options.projectId,
        businessId: FIREBASE_BUSINESS_ID,
        uid: user.uid,
        businessPath,
        membershipPath,
        strategy: 'server reads with persistent-cache fallback; ownerUid first',
      });

      setAccess({
        status: 'loading', uid: user.uid, email: user.email || '',
        displayName: user.displayName || '', role: null, branchIds: [],
        message: 'Firebase Server သို့မဟုတ် ယခင်သိမ်းထားသော Offline Cache မှ Owner / Member Access ကို စစ်ဆေးနေပါတယ်။',
      });

      void (async () => {
        let businessReadError: unknown = null;
        let businessExists = false;

        // 1) The business owner is the UID stored on the existing business document.
        // This avoids requiring a separate owner membership record for the Owner login.
        try {
          const businessSnapshot = await readAccessDocument(
            doc(firestore, 'businesses', FIREBASE_BUSINESS_ID),
            'Business document read',
          );
          if (!isCurrent()) return;
          businessExists = businessSnapshot.exists();

          if (businessSnapshot.exists()) {
            const business = businessSnapshot.data();
            if (business.ownerUid === user.uid) {
              if (business.active === false) {
                setAccess({
                  status: 'disabled', uid: user.uid, email: user.email || '',
                  displayName: user.displayName || '', role: 'owner', branchIds: [],
                  message: 'Business ကို ပိတ်ထားပါတယ်။ Owner က Firebase Console မှ active=true ပြန်ဖွင့်ပါ။',
                });
                return;
              }
              setAccess({
                status: 'active', uid: user.uid, email: user.email || '',
                displayName: user.displayName || (typeof business.ownerName === 'string' ? business.ownerName : ''),
                role: 'owner', branchIds: [],
                message: businessSnapshot.metadata.fromCache
                  ? 'Internet မရှိပါ။ ဒီ Device မှာ ယခင်က အတည်ပြုထားတဲ့ Owner Access Cache ကို အသုံးပြုပြီး POS ကို ဖွင့်ထားပါတယ်။ Internet ပြန်ရချိန် Server မှ ပြန်စစ်ပါမယ်။'
                  : 'Business ownerUid နဲ့ Firebase Login UID ကိုက်ညီပါတယ်။ Owner Access အတည်ပြုပြီးပါပြီ။',
              });
              console.info('[Minimart Owner Access]', {
                projectId: firebaseApp.options.projectId,
                businessId: FIREBASE_BUSINESS_ID,
                businessPath,
                exists: true,
                ownerUidMatched: true,
              });
              return;
            }
          }
        } catch (error) {
          businessReadError = error;
          console.warn('[Minimart Business Document Read]', {
            projectId: firebaseApp.options.projectId,
            businessPath,
            code: errorCode(error),
            error,
          });
        }

        // 2) Non-owner accounts are checked against their own member document.
        try {
          const memberSnapshot = await readAccessDocument(
            doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'members', user.uid),
            'Membership document read',
          );
          if (!isCurrent()) return;

          console.info('[Minimart Membership Read]', {
            projectId: firebaseApp.options.projectId,
            path: membershipPath,
            exists: memberSnapshot.exists(),
            source: memberSnapshot.metadata.fromCache ? 'local-cache' : 'server',
          });

          if (!memberSnapshot.exists()) {
            const businessErrorCode = errorCode(businessReadError);
            if (businessReadError && (isNetworkError(businessReadError) || businessErrorCode === 'permission-denied')) {
              throw businessReadError;
            }
            setAccess({
              status: 'unassigned', uid: user.uid, email: user.email || '',
              displayName: user.displayName || '', role: null, branchIds: [],
              message: businessExists
                ? `ဒီ Account သည် Business ownerUid မဟုတ်သလို Member Document လည်း မရှိပါ: ${membershipPath}`
                : `Business Document မတွေ့ပါ: ${businessPath}။ Firestore Path နဲ့ Business ID ကို စစ်ပါ။`,
            });
            return;
          }

          const data = memberSnapshot.data();
          const role = data.role === 'owner' || data.role === 'cashier' ? data.role as BusinessRole : null;
          const branchIds = Array.isArray(data.branchIds)
            ? data.branchIds.filter((value: unknown): value is string => typeof value === 'string')
            : [];

          if (data.uid !== user.uid) {
            setAccess({
              status: 'error', uid: user.uid, email: user.email || '',
              displayName: user.displayName || '', role: null, branchIds: [],
              message: 'Member Document ရဲ့ uid Field က လက်ရှိ Firebase Login UID နဲ့ မကိုက်ညီပါ။',
            });
            return;
          }
          if (typeof data.email === 'string' && user.email && data.email.toLowerCase() !== user.email.toLowerCase()) {
            setAccess({
              status: 'error', uid: user.uid, email: user.email || '',
              displayName: user.displayName || '', role: null, branchIds: [],
              message: 'Member Document ရဲ့ email Field က လက်ရှိ Login Email နဲ့ မကိုက်ညီပါ။',
            });
            return;
          }
          if (data.status !== 'active') {
            setAccess({
              status: 'disabled', uid: user.uid, email: user.email || '',
              displayName: user.displayName || '', role, branchIds,
              message: 'ဒီ Account ကို Owner က ပိတ်ထားပါတယ်။',
            });
            return;
          }
          if (!role || (role === 'cashier' && branchIds.length === 0)) {
            setAccess({
              status: 'error', uid: user.uid, email: user.email || '',
              displayName: user.displayName || '', role: null, branchIds,
              message: 'Member Role သို့မဟုတ် Branch Assignment မမှန်ကန်ပါ။ Cashier အတွက် branchIds အနည်းဆုံးတစ်ခု လိုအပ်ပါတယ်။',
            });
            return;
          }

          setAccess({
            status: 'active', uid: user.uid, email: user.email || '',
            displayName: typeof data.displayName === 'string' && data.displayName
              ? data.displayName : user.displayName || '',
            role, branchIds, message: memberSnapshot.metadata.fromCache
              ? 'Internet မရှိပါ။ ဒီ Device မှာ ယခင်က အတည်ပြုထားတဲ့ Membership Cache ကို အသုံးပြုပြီး POS ကို ဖွင့်ထားပါတယ်။ Internet ပြန်ရချိန် Server မှ ပြန်စစ်ပါမယ်.'
              : 'Business Membership အတည်ပြုပြီးပါပြီ။',
          });
        } catch (error) {
          if (!isCurrent()) return;
          const code = errorCode(error);
          console.error('[Minimart Access Resolution Error]', {
            projectId: firebaseApp.options.projectId,
            businessId: FIREBASE_BUSINESS_ID,
            uid: user.uid,
            businessPath,
            membershipPath,
            code,
            error,
          });
          const networkProblem = isNetworkError(error) || isNetworkError(businessReadError);
          setAccess({
            status: 'error', uid: user.uid, email: user.email || '',
            displayName: user.displayName || '', role: null, branchIds: [],
            message: networkProblem
              ? 'Firebase Server ကို မချိတ်ဆက်နိုင်ပါ။ Internet ပြန်ချိတ်ပြီး “ပြန်စမ်းရန်” ကို နှိပ်ပါ။ 15 စက္ကန့်အတွင်း တုံ့ပြန်မှုမရပါက Network ကို စစ်ဆေးပါ။'
              : code === 'permission-denied'
                ? `Firestore Rules က ${membershipPath} သို့မဟုတ် ${businessPath} ကို ဖတ်ခွင့်မပြုပါ။ Rules ထဲမှာ Owner ကို ownerUid နဲ့ Business Document get လုပ်ခွင့်ပေးထားရန် လိုအပ်ပါတယ်။`
                : error instanceof Error ? error.message : 'Business Access ကို အတည်ပြုမရပါ။ Firebase Console နဲ့ Path ကို စစ်ဆေးပါ။',
          });
        }
      })();
    });

    return () => {
      disposed = true;
      generation += 1;
      unsubscribeAuth();
    };
  }, [resetAccess, setAccess]);

  return null;
}
