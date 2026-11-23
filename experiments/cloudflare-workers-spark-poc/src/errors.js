export class SaleError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'SaleError';
    this.status = status;
    this.code = code;
  }
}

export const invalid = (message) => {
  throw new SaleError(400, 'invalid-argument', message);
};

export const authenticated = (message) => {
  throw new SaleError(401, 'unauthenticated', message);
};

export const denied = (message) => {
  throw new SaleError(403, 'permission-denied', message);
};

export const authorizationExpired = (message) => {
  throw new SaleError(401, 'authorization-expired', message);
};

export const held = (message) => {
  throw new SaleError(409, 'expired-hold', message);
};

export const failed = (message) => {
  throw new SaleError(409, 'failed-precondition', message);
};

export const exhausted = (message) => {
  throw new SaleError(429, 'resource-exhausted', message);
};

export function errorBody(error) {
  if (error instanceof SaleError) {
    return { status: error.status, body: { ok: false, code: error.code, message: error.message } };
  }
  return { status: 500, body: { ok: false, code: 'internal', message: 'Server ချို့ယွင်းမှုကြောင့် အရောင်းကို မသိမ်းနိုင်ပါ။ ထပ်မံကြိုးစားပါ။' } };
}
