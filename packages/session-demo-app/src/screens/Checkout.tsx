import { useState, type FormEvent } from 'react';
import { ApiError, apiPost } from '../api/client';
import { Card } from '../components/ui';

/**
 * The redaction fixture.
 *
 * This form deliberately sends secret-shaped values — a password, a card number,
 * a CVV, and an `authorization` header — so M2's fuzzing test has known needles
 * to grep the raw archive bytes for. Everything here is fake and local; the
 * point is to prove the recorder strips it, not to protect it.
 *
 * The `data-record-*` attributes are inert until M2 wires them to rrweb's
 * masking options. They are placed now so the markup that the fidelity and
 * redaction tests target does not shift underneath them later.
 */

const SEEDED_SECRETS = {
  password: 'hunter2-CORRECT-horse',
  cardNumber: '4111 1111 1111 1111',
  cvv: '123',
  authToken:
    'Bearer eyJhbGciOiJIUzI1NiJ9.c2VlZGVkLXRlc3QtdG9rZW4.9wD8sQ2mKfL0pXvB1nY4tR7cJ',
} as const;

interface FormState {
  email: string;
  fullName: string;
  password: string;
  cardNumber: string;
  cvv: string;
  expiry: string;
  plan: string;
  seats: string;
  billingCycle: string;
  notes: string;
  terms: boolean;
}

const INITIAL: FormState = {
  email: '',
  fullName: '',
  password: SEEDED_SECRETS.password,
  cardNumber: SEEDED_SECRETS.cardNumber,
  cvv: SEEDED_SECRETS.cvv,
  expiry: '12/29',
  plan: 'team',
  seats: '12',
  billingCycle: 'annual',
  notes: '',
  terms: false,
};

type Errors = Partial<Record<keyof FormState, string>>;

function validate(form: FormState): Errors {
  const errors: Errors = {};
  if (!form.email.includes('@')) errors.email = 'Enter a valid email address.';
  if (form.fullName.trim().length < 2) errors.fullName = 'Enter the name on the account.';
  if (form.cardNumber.replace(/\D/g, '').length < 15)
    errors.cardNumber = 'Enter a 16-digit card number.';
  if (form.cvv.length < 3) errors.cvv = 'CVV must be at least 3 digits.';
  if (!form.terms) errors.terms = 'You must accept the terms to continue.';
  return errors;
}

export function Checkout() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<Errors>({});
  const [simulate, setSimulate] = useState<'ok' | 'validation-error' | 'server-error'>(
    'ok',
  );
  const [result, setResult] = useState<{ kind: 'ok' | 'err'; message: string } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setResult(null);
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const response = await apiPost<{ orderId: string }>(
        '/api/checkout',
        { ...form, simulate, apiKey: 'sk_test_seeded_0000000000000000' },
        { authorization: SEEDED_SECRETS.authToken },
      );
      setResult({ kind: 'ok', message: `Subscription confirmed — ${response.orderId}` });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 400
          ? 'Card was declined by the issuer. Try a different payment method.'
          : 'Something went wrong on our side. Your card was not charged.';
      setResult({ kind: 'err', message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <Card title="Billing details">
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="fullName">Name on account</label>
              <input
                id="fullName"
                value={form.fullName}
                onChange={(e) => set('fullName', e.target.value)}
                aria-invalid={errors.fullName ? 'true' : undefined}
                autoComplete="name"
              />
              {errors.fullName && <span className="field-error">{errors.fullName}</span>}
            </div>

            {/* Not sensitive, and developers need it to reproduce bugs — so this
                one is explicitly opted out of masking. */}
            <div className="field">
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                aria-invalid={errors.email ? 'true' : undefined}
                autoComplete="email"
                data-record-unmask
              />
              {errors.email ? (
                <span className="field-error">{errors.email}</span>
              ) : (
                <span className="field-note">
                  Visible in replay — marked data-record-unmask
                </span>
              )}
            </div>

            <div className="field">
              <label htmlFor="password">Account password</label>
              <input
                id="password"
                type="password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                autoComplete="new-password"
                data-record-mask
              />
              <span className="field-note">
                Masked in replay · redacted from the archive
              </span>
            </div>

            <div className="field">
              <label htmlFor="cardNumber">Card number</label>
              <input
                id="cardNumber"
                inputMode="numeric"
                value={form.cardNumber}
                onChange={(e) => set('cardNumber', e.target.value)}
                aria-invalid={errors.cardNumber ? 'true' : undefined}
                data-record-mask
              />
              {errors.cardNumber ? (
                <span className="field-error">{errors.cardNumber}</span>
              ) : (
                <span className="field-note">
                  Masked in replay · redacted from the archive
                </span>
              )}
            </div>

            <div className="field">
              <label htmlFor="expiry">Expiry</label>
              <input
                id="expiry"
                value={form.expiry}
                onChange={(e) => set('expiry', e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="cvv">CVV</label>
              <input
                id="cvv"
                inputMode="numeric"
                value={form.cvv}
                onChange={(e) => set('cvv', e.target.value)}
                aria-invalid={errors.cvv ? 'true' : undefined}
                data-record-mask
              />
              {errors.cvv && <span className="field-error">{errors.cvv}</span>}
            </div>

            <div className="field">
              <label htmlFor="plan">Plan</label>
              <select
                id="plan"
                value={form.plan}
                onChange={(e) => set('plan', e.target.value)}
              >
                <option value="starter">Starter</option>
                <option value="team">Team</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="seats">Seats</label>
              <input
                id="seats"
                type="number"
                min={1}
                value={form.seats}
                onChange={(e) => set('seats', e.target.value)}
              />
            </div>

            <div className="field span-2">
              <label>Billing cycle</label>
              <div className="radio-row">
                {['monthly', 'annual'].map((cycle) => (
                  <label key={cycle} className="checkline">
                    <input
                      type="radio"
                      name="billingCycle"
                      value={cycle}
                      checked={form.billingCycle === cycle}
                      onChange={(e) => set('billingCycle', e.target.value)}
                    />
                    <span style={{ textTransform: 'capitalize' }}>{cycle}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="field span-2">
              <label htmlFor="notes">Purchase order notes</label>
              <textarea
                id="notes"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </div>

            <div className="field span-2">
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={form.terms}
                  onChange={(e) => set('terms', e.target.checked)}
                />
                <span>
                  I accept the terms of service and the data processing agreement.
                </span>
              </label>
              {errors.terms && <span className="field-error">{errors.terms}</span>}
            </div>

            <div className="field span-2">
              <label htmlFor="simulate">Simulate response</label>
              <select
                id="simulate"
                value={simulate}
                onChange={(e) => setSimulate(e.target.value as typeof simulate)}
              >
                <option value="ok">200 — success</option>
                <option value="validation-error">400 — validation error</option>
                <option value="server-error">500 — server error</option>
              </select>
              <span className="field-note">
                The full failure matrix moves to the Chaos Panel in M2.
              </span>
            </div>
          </div>

          {result && (
            <div
              className={`banner ${result.kind === 'ok' ? 'success' : 'error'}`}
              style={{ marginTop: 16 }}
            >
              {result.message}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? 'Processing…' : 'Confirm subscription'}
            </button>
            <button
              type="button"
              className="subtle"
              onClick={() => {
                setForm(INITIAL);
                setErrors({});
                setResult(null);
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
