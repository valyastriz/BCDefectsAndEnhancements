import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useViewer } from '../hooks/useViewer';
import { Button, Modal } from '../components/bite-size/BitsizeUI';
import { DuplicateCheck } from '../components/public/DuplicateCheck';
import { ScreenshotDropZone } from '../components/public/ScreenshotDropZone';
import { SubmitReadinessRail } from '../components/public/SubmitReadinessRail';

const initialForm = {
  created_by: '',
  type: 'defect',
  application_name: 'Billing Center',
  policy_num: '',
  account_num: '',
  transaction_num: '',
  screen_title: '',
  summary_of_issue: '',
  steps_to_reproduce: '',
  what_happened_exact_details: '',
  request: '',
  date_of_error: '',
  time_of_error: '',
  needs_workaround: false,
};

const SUMMARY_MAX_LENGTH = 140;

// Mirrors the server's per-type checks in server/src/routes/submissionRoutes.js
// (:46 created_by, :73 defect trio + date, :91 enhancement pair). Keep the two
// in step — anything the server rejects that is missing here reaches the rep as
// a bare 400 instead of an inline prompt.
const REQUIRED_FIELDS = {
  defect: [
    { key: 'created_by', label: 'Your name' },
    { key: 'summary_of_issue', label: 'One-line summary' },
    { key: 'screen_title', label: 'Screen title' },
    { key: 'date_of_error', label: 'Date it happened' },
    { key: 'what_happened_exact_details', label: 'What you saw' },
  ],
  enhancement: [
    { key: 'created_by', label: 'Your name' },
    { key: 'summary_of_issue', label: 'One-line summary' },
    { key: 'request', label: 'What should change' },
  ],
};

const FIELD_ERRORS = {
  created_by: 'Enter your name.',
  summary_of_issue: 'Write one line describing the issue.',
  screen_title: 'Name the screen you were on.',
  date_of_error: 'Pick the date.',
  what_happened_exact_details: 'Describe what you saw.',
  request: 'Describe the change you would like.',
};

const COUNT_WORDS = ['no', 'One', 'Two', 'Three', 'Four', 'Five'];

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** A labelled control with its counter and inline error slot. */
function Field({ name, label, required, optional, counter, error, children }) {
  return (
    <div className={`rs-field${error ? ' is-bad' : ''}`}>
      <label htmlFor={`rs-${name}`}>
        {label}
        {required && <em className="rs-req">*</em>}
        {optional && <span className="rs-chip rs-chip--opt">Optional</span>}
        {counter && <span className="rs-count">{counter}</span>}
      </label>
      {children}
      {error && <p className="rs-bad">{error}</p>}
    </div>
  );
}

export function RepSubmitPage() {
  // Who the server will record this as. When it already knows, the form stops
  // asking — the name field would be a box whose value is discarded on arrival
  // (server/src/services/reporterService.js), which is worse than absent.
  const { viewer } = useViewer();
  const knownReporter = viewer.isAuthenticated ? viewer.user : null;

  const [form, setForm] = useState(initialForm);
  const [files, setFiles] = useState([]);
  const [fileUrls, setFileUrls] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [confirmNoScreenshots, setConfirmNoScreenshots] = useState(false);
  // Only true once the rep has tried to submit — nobody wants a form that turns
  // red while they are still filling in the first field.
  const [showErrors, setShowErrors] = useState(false);
  const formRef = useRef(null);

  // One object URL per attached file, revoked whenever the list changes or the
  // page unmounts — creating them inline in render leaks a new URL per keystroke.
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setFileUrls(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  const isDefect = form.type === 'defect';
  const isEnhancement = form.type === 'enhancement';
  // `created_by` drops out of the required set once the reporter is known,
  // mirroring the server: it no longer reads a typed name for a signed-in caller,
  // so demanding one here would block a submit that would have succeeded.
  const requiredFields = knownReporter
    ? REQUIRED_FIELDS[form.type].filter((field) => field.key !== 'created_by')
    : REQUIRED_FIELDS[form.type];
  const missing = requiredFields.filter((field) => !String(form[field.key] ?? '').trim());

  function updateField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function setType(nextType) {
    setForm((prev) => ({ ...prev, type: nextType }));
    setFiles([]);
    setError('');
    setShowErrors(false);
  }

  function errorFor(key) {
    return showErrors && missing.some((field) => field.key === key) ? FIELD_ERRORS[key] : '';
  }

  function onSubmit(event) {
    event.preventDefault();
    setError('');

    if (missing.length > 0) {
      setShowErrors(true);
      // Send focus to the first thing that needs attention, so a keyboard or
      // screen-reader user is not left to hunt for the red field.
      document.getElementById(`rs-${missing[0].key}`)?.focus();
      return;
    }

    if (isDefect && files.length < 1) {
      setConfirmNoScreenshots(true);
      return;
    }

    submitForm();
  }

  async function submitForm() {
    try {
      setSaving(true);
      const formData = new FormData();
      const payload = {
        ...form,
        created_by_email: '-',
        application_name: isEnhancement ? 'Billing Center' : form.application_name || 'Billing Center',
        steps_to_reproduce: isDefect ? form.steps_to_reproduce || '-' : '-',
        request: isDefect ? '-' : form.request,
        // Defect-only, and the server enforces that too — an enhancement is not
        // stopping anyone today.
        needs_workaround: isDefect && form.needs_workaround,
        date_time_of_error: isDefect ? `${form.date_of_error}T${form.time_of_error || '00:00'}` : '',
      };
      Object.entries(payload).forEach(([key, value]) => formData.append(key, value));
      files.forEach((file) => formData.append('attachments', file));

      const result = await api.submitRepSubmission(formData);
      // Snapshot what was sent before resetting — the confirmation shows the rep
      // the ticket the team will see, and the form state is about to be cleared.
      setSubmitted({
        id: result.id,
        type: form.type,
        summary: form.summary_of_issue,
        screen: form.screen_title,
        // The confirmation must echo the name the server actually recorded, not
        // the (ignored) form field, or a signed-in rep sees a blank "filed by".
        name: knownReporter ? knownReporter.displayName : form.created_by,
        fileCount: files.length,
      });
      setForm(initialForm);
      setFiles([]);
      setShowErrors(false);
      formRef.current?.reset();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  }

  // Filing needs a signed-in person and there isn't one. Shown instead of the
  // form rather than around it: a form that cannot be submitted is worse than an
  // honest wall, and the server refuses the POST either way.
  if (viewer.submitRequiresAuth && !viewer.isAuthenticated) {
    return (
      <div className="rs-page">
        <section className="rs-locked">
          <h2>Sign in to report an issue</h2>
          <p>
            Reports are filed under your name so the team can come back to you with
            questions and you can follow your own tickets. Sign in with your work
            account to continue.
          </p>
          {/* No sign-in button on purpose: there is no SSO login route to point
              at yet, and a dead button is worse than none. Under a real provider
              the redirect happens before this page ever renders — this state is
              the fail-safe for when it somehow doesn't. Wire the provider's
              login URL here when SSO lands. */}
          <p className="rs-locked-alt">
            You can still <Link to="/public">read the status board</Link> without signing in.
          </p>
        </section>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="rs-page">
        <section className="rs-done">
          <div className="rs-done-top">
            <span className="rs-done-icon"><CheckIcon /></span>
            <h2>Reported</h2>
            <p className="rs-done-ref">#{submitted.id}</p>
            <p>
              Your report is in the triage queue with the status <strong>Reported</strong>.
              Quote <strong>#{submitted.id}</strong> if you need to follow it up.
            </p>
          </div>
          <div className="rs-done-body">
            <div className="rs-done-recap">
              <div className="rs-recap-top">
                <span className="rs-ref">#{submitted.id}</span>
                <h4>{submitted.summary}</h4>
              </div>
              <p className="rs-recap-meta">
                {submitted.type === 'defect' ? 'Defect' : 'Enhancement'} · Billing Center
                {submitted.screen ? ` · ${submitted.screen}` : ''}
                {` · Reported by ${submitted.name}`}
                {submitted.fileCount > 0
                  ? ` · ${submitted.fileCount} screenshot${submitted.fileCount === 1 ? '' : 's'} attached`
                  : ''}
              </p>
            </div>
            <div className="rs-done-acts">
              <Link className="rs-act" to="/public">Follow it on the Status Board</Link>
              <button
                type="button"
                className="rs-act rs-act--ghost"
                onClick={() => { setSubmitted(null); setError(''); }}
              >
                Submit another request
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="rs-page">
      <div className="rs-head">
        <div>
          <h1>Report a Billing Center issue</h1>
          <p>
            Defects and enhancements go to the same triage queue. You&rsquo;ll get a reference
            number and can follow it on the Status Board.
          </p>
        </div>
        <Link className="rs-headlink" to="/public">Status Board →</Link>
      </div>

      <form ref={formRef} className="rs-cols" onSubmit={onSubmit} noValidate>
        <div className="rs-main">

          <section className="rs-card">
            <p className="rs-grouplabel">What are you reporting?</p>
            <div className="rs-types">
              <button
                type="button"
                className="rs-type"
                aria-pressed={isDefect}
                onClick={() => setType('defect')}
              >
                <span className="rs-type-mark" aria-hidden="true" />
                <span className="rs-type-name">Defect</span>
              </button>
              <button
                type="button"
                className="rs-type"
                aria-pressed={isEnhancement}
                onClick={() => setType('enhancement')}
              >
                <span className="rs-type-mark" aria-hidden="true" />
                <span className="rs-type-name">Enhancement</span>
              </button>
            </div>
          </section>

          <section className="rs-card">
            <p className="rs-grouplabel">Your request</p>

            {showErrors && missing.length > 0 && (
              <div className="rs-alert" role="alert">
                <span className="rs-alert-glyph" aria-hidden="true">!</span>
                <b>
                  {missing.length === 1
                    ? 'One required field is still empty'
                    : `${COUNT_WORDS[missing.length] ?? missing.length} required fields are still empty`}
                </b>
                <span>
                  They are marked below and listed under &ldquo;Before you submit&rdquo;.
                  Nothing you have typed has been lost.
                </span>
              </div>
            )}

            {error && (
              <div className="rs-alert" role="alert">
                <span className="rs-alert-glyph" aria-hidden="true">!</span>
                <b>That did not send</b>
                <span>{error}</span>
              </div>
            )}

            {knownReporter ? (
              // Stated rather than asked. The rep still sees whose name goes on
              // the ticket — they just cannot put someone else's there.
              <div className="rs-field rs-reporter">
                <span className="rs-reporter-label">Filing as</span>
                <span className="rs-reporter-name">{knownReporter.displayName}</span>
                {knownReporter.email && (
                  <span className="rs-reporter-email">{knownReporter.email}</span>
                )}
              </div>
            ) : (
              <Field
                name="created_by"
                label="Your name"
                required
                error={errorFor('created_by')}
              >
                <input
                  id="rs-created_by"
                  type="text"
                  autoComplete="name"
                  placeholder="First and last name"
                  value={form.created_by}
                  onChange={(e) => updateField('created_by', e.target.value)}
                />
              </Field>
            )}

            <div className="rs-field-lead">
              <Field
                name="summary_of_issue"
                label="Summarize it in one line"
                required
                counter={`${form.summary_of_issue.length} / ${SUMMARY_MAX_LENGTH}`}
                error={errorFor('summary_of_issue')}
              >
                <input
                  id="rs-summary_of_issue"
                  type="text"
                  maxLength={SUMMARY_MAX_LENGTH}
                  placeholder="e.g. Renewal invoice shows the prior term's installment amount"
                  value={form.summary_of_issue}
                  onChange={(e) => updateField('summary_of_issue', e.target.value)}
                />
              </Field>
            </div>

            <DuplicateCheck query={form.summary_of_issue} />
          </section>

          {isDefect && (
            <>
              <section className="rs-card">
                <p className="rs-grouplabel">Where it happened</p>
                <div className="rs-row rs-row--when">
                  <Field
                    name="screen_title"
                    label="Screen title"
                    required
                    error={errorFor('screen_title')}
                  >
                    <input
                      id="rs-screen_title"
                      type="text"
                      placeholder="e.g. Invoice Details"
                      value={form.screen_title}
                      onChange={(e) => updateField('screen_title', e.target.value)}
                    />
                  </Field>
                  <Field
                    name="date_of_error"
                    label="Date it happened"
                    required
                    error={errorFor('date_of_error')}
                  >
                    <input
                      id="rs-date_of_error"
                      type="date"
                      value={form.date_of_error}
                      onChange={(e) => updateField('date_of_error', e.target.value)}
                    />
                  </Field>
                  <Field name="time_of_error" label="Time" optional>
                    <input
                      id="rs-time_of_error"
                      type="time"
                      value={form.time_of_error}
                      onChange={(e) => updateField('time_of_error', e.target.value)}
                    />
                  </Field>
                </div>

                <div className="rs-sub">
                  <div className="rs-sub-head">
                    <b>Reference numbers</b>
                    {/* The three fields below carry no required marker, so this
                        chip is the only thing saying they are optional. */}
                    <span className="rs-chip rs-chip--opt">Optional</span>
                  </div>
                  <div className="rs-row">
                    <Field name="policy_num" label="Policy number">
                      <input
                        id="rs-policy_num"
                        type="text"
                        placeholder="e.g. 40-123456"
                        value={form.policy_num}
                        onChange={(e) => updateField('policy_num', e.target.value)}
                      />
                    </Field>
                    <Field name="account_num" label="Account number">
                      <input
                        id="rs-account_num"
                        type="text"
                        placeholder="e.g. 8004521"
                        value={form.account_num}
                        onChange={(e) => updateField('account_num', e.target.value)}
                      />
                    </Field>
                    <Field name="transaction_num" label="Transaction number">
                      <input
                        id="rs-transaction_num"
                        type="text"
                        placeholder="e.g. 90211884"
                        value={form.transaction_num}
                        onChange={(e) => updateField('transaction_num', e.target.value)}
                      />
                    </Field>
                  </div>
                </div>
              </section>

              <section className="rs-card">
                <p className="rs-grouplabel">What happened</p>
                <Field
                  name="what_happened_exact_details"
                  label="Exactly what you saw"
                  required
                  counter={`${form.what_happened_exact_details.length} characters`}
                  error={errorFor('what_happened_exact_details')}
                >
                  <textarea
                    id="rs-what_happened_exact_details"
                    rows={5}
                    placeholder="What you expected, what appeared instead, and any error message word-for-word."
                    value={form.what_happened_exact_details}
                    onChange={(e) => updateField('what_happened_exact_details', e.target.value)}
                  />
                </Field>
                <Field
                  name="steps_to_reproduce"
                  label="Steps to reproduce"
                  optional
                >
                  <textarea
                    id="rs-steps_to_reproduce"
                    rows={3}
                    placeholder={'1. Open the account\n2. Click Invoices\n3. …'}
                    value={form.steps_to_reproduce}
                    onChange={(e) => updateField('steps_to_reproduce', e.target.value)}
                  />
                </Field>
              </section>

              {/* Defects only. An enhancement is by definition not stopping
                  anyone today, so there is nothing to work around.

                  The wording is deliberately scoped to THIS case. "Blocked" or
                  "to keep working" reads as the whole job being stopped, so a
                  rep with one stuck account talks themselves out of ticking it
                  — which is exactly the case the team can most easily help
                  with. */}
              <section className="rs-card">
                <p className="rs-grouplabel">Do you need a workaround?</p>
                <label className="rs-flag">
                  <input
                    type="checkbox"
                    checked={form.needs_workaround}
                    onChange={(e) => updateField('needs_workaround', e.target.checked)}
                  />
                  <span>I need a workaround to finish this specific case</span>
                </label>
              </section>
            </>
          )}

          {isEnhancement && (
            <section className="rs-card">
              <p className="rs-grouplabel">What you&rsquo;d like</p>
              <Field
                name="request"
                label="What should change, and why"
                required
                counter={`${form.request.length} characters`}
                error={errorFor('request')}
              >
                <textarea
                  id="rs-request"
                  rows={6}
                  placeholder="Describe the change and what it would save you — time per case, errors avoided, calls prevented."
                  value={form.request}
                  onChange={(e) => updateField('request', e.target.value)}
                />
              </Field>
            </section>
          )}

          <section className="rs-card">
            <p className="rs-grouplabel">
              Screenshots
              <span className={`rs-chip${isDefect ? '' : ' rs-chip--opt'}`}>
                {isDefect ? 'Strongly encouraged' : 'Optional'}
              </span>
            </p>
            <ScreenshotDropZone
              files={files}
              fileUrls={fileUrls}
              onFilesChange={setFiles}
              onPreview={setPreviewImage}
            />
          </section>

        </div>

        <SubmitReadinessRail
          requiredFields={requiredFields}
          values={form}
          showErrors={showErrors}
          isDefect={isDefect}
          fileCount={files.length}
          saving={saving}
        />

        {/* Narrow screens only. A sibling of the rail rather than nested inside
            the form column, so once the layout stacks it still lands last —
            below the readiness checklist, not above it. */}
        <div className="rs-stickybar">
          <span className="rs-stickybar-left">
            {missing.length === 0
              ? 'Ready to submit'
              : `${missing.length} required field${missing.length === 1 ? '' : 's'} left`}
          </span>
          <button type="submit" className="rs-submit" disabled={saving}>
            {saving && <span className="rs-spin" aria-hidden="true" />}
            {saving ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </form>

      <Modal open={Boolean(previewImage)} onClose={() => setPreviewImage(null)} title="Image Preview">
        {previewImage && <img className="bs-preview-image" src={previewImage} alt="Preview" />}
      </Modal>

      <Modal
        open={confirmNoScreenshots}
        onClose={() => setConfirmNoScreenshots(false)}
        title="Submit Without Screenshots?"
      >
        <p>
          Screenshots are strongly encouraged for defects. Screens change over time, and without
          one, developers may not be able to see what the issue looked like — which dramatically
          reduces the chances of reproducing and fixing it.
        </p>
        <div className="bs-actions">
          <Button type="button" onClick={() => setConfirmNoScreenshots(false)}>
            Go Back &amp; Add Screenshots
          </Button>
          <Button
            kind="ghost"
            type="button"
            disabled={saving}
            onClick={() => {
              setConfirmNoScreenshots(false);
              submitForm();
            }}
          >
            Submit Anyway
          </Button>
        </div>
      </Modal>
    </div>
  );
}
