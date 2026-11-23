import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, Check, HelpCircle, X } from 'lucide-react';

export type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
};

export type PromptDialogOptions = {
  title: string;
  message?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  inputType?: 'text' | 'password' | 'number';
  inputMode?: 'text' | 'numeric' | 'decimal';
  step?: string;
  required?: boolean;
  minLength?: number;
  confirmLabel?: string;
  cancelLabel?: string;
  readOnlyCopy?: boolean;
};

export type FormDialogField = {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  inputType?: 'text' | 'password' | 'number';
  inputMode?: 'text' | 'numeric' | 'decimal';
};

export type FormDialogOptions = {
  title: string;
  message?: string;
  fields: FormDialogField[];
  confirmLabel?: string;
  cancelLabel?: string;
};

type DialogApi = {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  prompt: (options: PromptDialogOptions) => Promise<string | null>;
  form: (options: FormDialogOptions) => Promise<Record<string, string> | null>;
};

type QueuedDialog =
  | { kind: 'confirm'; options: ConfirmDialogOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptDialogOptions; resolve: (value: string | null) => void }
  | { kind: 'form'; options: FormDialogOptions; resolve: (value: Record<string, string> | null) => void };

const DialogContext = createContext<DialogApi | null>(null);

export function useAppDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useAppDialog must be used inside DialogProvider');
  }
  return ctx;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueuedDialog[]>([]);
  const active = queue[0] ?? null;

  const [promptValue, setPromptValue] = useState('');
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [validationError, setValidationError] = useState('');
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!active) return;
    setValidationError('');
    if (active.kind === 'prompt') {
      setPromptValue(active.options.defaultValue ?? '');
    } else if (active.kind === 'form') {
      const initial: Record<string, string> = {};
      for (const field of active.options.fields) {
        initial[field.name] = field.defaultValue ?? '';
      }
      setFormValues(initial);
    }
    const timer = window.setTimeout(() => {
      if (active.kind === 'prompt' || active.kind === 'form') {
        firstInputRef.current?.focus();
        if (active.kind === 'prompt' && active.options.readOnlyCopy) {
          firstInputRef.current?.select();
        }
      } else {
        confirmBtnRef.current?.focus();
      }
    }, 10);
    return () => window.clearTimeout(timer);
  }, [active]);

  const dismissActive = useCallback(() => {
    setQueue((current) => {
      if (current.length === 0) return current;
      const [head, ...rest] = current;
      if (head.kind === 'confirm') head.resolve(false);
      else head.resolve(null);
      return rest;
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissActive();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, dismissActive]);

  const confirm = useCallback((options: ConfirmDialogOptions) => (
    new Promise<boolean>((resolve) => {
      setQueue((current) => [...current, { kind: 'confirm', options, resolve }]);
    })
  ), []);

  const prompt = useCallback((options: PromptDialogOptions) => (
    new Promise<string | null>((resolve) => {
      setQueue((current) => [...current, { kind: 'prompt', options, resolve }]);
    })
  ), []);

  const form = useCallback((options: FormDialogOptions) => (
    new Promise<Record<string, string> | null>((resolve) => {
      setQueue((current) => [...current, { kind: 'form', options, resolve }]);
    })
  ), []);

  const handleConfirmAccept = () => {
    setQueue((current) => {
      if (current.length === 0) return current;
      const [head, ...rest] = current;
      if (head.kind === 'confirm') head.resolve(true);
      return rest;
    });
  };

  const handlePromptSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!active || active.kind !== 'prompt') return;
    if (active.options.readOnlyCopy) {
      dismissActive();
      return;
    }
    const trimmed = promptValue.trim();
    if (active.options.required && !trimmed) {
      setValidationError('တန်ဖိုးကို ဖြည့်စွက်ပါ။');
      firstInputRef.current?.focus();
      return;
    }
    if (active.options.minLength && trimmed.length < active.options.minLength) {
      setValidationError(`အနည်းဆုံး စာလုံး ${active.options.minLength} လုံး ဖြည့်ပါ။`);
      firstInputRef.current?.focus();
      return;
    }
    const result = promptValue;
    setQueue((current) => {
      if (current.length === 0) return current;
      const [head, ...rest] = current;
      if (head.kind === 'prompt') head.resolve(result);
      return rest;
    });
  };

  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!active || active.kind !== 'form') return;
    for (const field of active.options.fields) {
      if (field.required && !(formValues[field.name] ?? '').trim()) {
        setValidationError(`${field.label} ကို ဖြည့်စွက်ပါ။`);
        return;
      }
    }
    const result = { ...formValues };
    setQueue((current) => {
      if (current.length === 0) return current;
      const [head, ...rest] = current;
      if (head.kind === 'form') head.resolve(result);
      return rest;
    });
  };

  return (
    <DialogContext.Provider value={{ confirm, prompt, form }}>
      {children}
      {active && (
        <div
          className="modal-backdrop app-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) dismissActive();
          }}
        >
          {active.kind === 'confirm' ? (
            <section
              className="modal-card app-dialog-card ios-alert-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="app-dialog-title"
            >
              <div className="modal-header">
                <div className="app-dialog-title-row">
                  <span className={`app-dialog-icon ${active.options.tone === 'danger' ? 'danger' : ''}`}>
                    {active.options.tone === 'danger' ? <AlertTriangle size={18} /> : <HelpCircle size={18} />}
                  </span>
                  <div>
                    <h2 id="app-dialog-title">{active.options.title}</h2>
                  </div>
                </div>
              </div>
              <p className="app-dialog-message">{active.options.message}</p>
              <div className="modal-actions">
                <button className="button button-outline" type="button" onClick={dismissActive}>
                  {active.options.cancelLabel || 'မလုပ်တော့ပါ'}
                </button>
                <button
                  ref={confirmBtnRef}
                  className={`button ${active.options.tone === 'danger' ? 'button-danger' : 'button-primary'}`}
                  type="button"
                  onClick={handleConfirmAccept}
                >
                  <Check size={16} /> {active.options.confirmLabel || 'အတည်ပြုမည်'}
                </button>
              </div>
            </section>
          ) : active.kind === 'prompt' ? (
            <form
              className="modal-card app-dialog-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="app-dialog-title"
              onSubmit={handlePromptSubmit}
            >
              <div className="modal-header">
                <div>
                  <h2 id="app-dialog-title">{active.options.title}</h2>
                </div>
                <button className="icon-btn" type="button" onClick={dismissActive} aria-label="ပိတ်ရန်">
                  <X size={18} />
                </button>
              </div>
              {active.options.message && <p className="app-dialog-message">{active.options.message}</p>}
              <div className="app-dialog-fields">
                <label>
                  {active.options.label || 'ထည့်သွင်းရန်'}
                  <input
                    ref={firstInputRef}
                    type={active.options.inputType || 'text'}
                    inputMode={active.options.inputMode}
                    step={active.options.step}
                    value={promptValue}
                    readOnly={active.options.readOnlyCopy}
                    placeholder={active.options.placeholder}
                    onChange={(event) => {
                      setPromptValue(event.target.value);
                      if (validationError) setValidationError('');
                    }}
                  />
                </label>
                {validationError && <p className="app-dialog-error" role="alert">{validationError}</p>}
              </div>
              <div className="modal-actions">
                {!active.options.readOnlyCopy && (
                  <button className="button button-outline" type="button" onClick={dismissActive}>
                    {active.options.cancelLabel || 'မလုပ်တော့ပါ'}
                  </button>
                )}
                <button className="button button-primary" type="submit">
                  <Check size={16} /> {active.options.readOnlyCopy ? 'ပိတ်မည်' : (active.options.confirmLabel || 'အတည်ပြုမည်')}
                </button>
              </div>
            </form>
          ) : (
            <form
              className="modal-card app-dialog-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="app-dialog-title"
              onSubmit={handleFormSubmit}
            >
              <div className="modal-header">
                <div>
                  <h2 id="app-dialog-title">{active.options.title}</h2>
                </div>
                <button className="icon-btn" type="button" onClick={dismissActive} aria-label="ပိတ်ရန်">
                  <X size={18} />
                </button>
              </div>
              {active.options.message && <p className="app-dialog-message">{active.options.message}</p>}
              <div className="app-dialog-fields">
                {active.options.fields.map((field, index) => (
                  <label key={field.name}>
                    {field.label}{field.required ? ' *' : ''}
                    <input
                      ref={index === 0 ? firstInputRef : undefined}
                      type={field.inputType || 'text'}
                      inputMode={field.inputMode}
                      value={formValues[field.name] ?? ''}
                      placeholder={field.placeholder}
                      onChange={(event) => {
                        const value = event.target.value;
                        setFormValues((prev) => ({ ...prev, [field.name]: value }));
                        if (validationError) setValidationError('');
                      }}
                    />
                  </label>
                ))}
                {validationError && <p className="app-dialog-error" role="alert">{validationError}</p>}
              </div>
              <div className="modal-actions">
                <button className="button button-outline" type="button" onClick={dismissActive}>
                  {active.options.cancelLabel || 'မလုပ်တော့ပါ'}
                </button>
                <button className="button button-primary" type="submit">
                  <Check size={16} /> {active.options.confirmLabel || 'သိမ်းဆည်းမည်'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </DialogContext.Provider>
  );
}
