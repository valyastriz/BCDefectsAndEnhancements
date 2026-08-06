import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useViewer } from '../hooks/useViewer';
import { Button, Modal } from '../components/bite-size/BitsizeUI';
import { DuplicateCheck } from '../components/public/DuplicateCheck';
import { ScreenshotDropZone } from '../components/public/ScreenshotDropZone';
import { SubmitReadinessRail } from '../components/public/SubmitReadinessRail';
// Shared with the admin Add-a-ticket dialog, which offers the same six words.
import { USAGE_FREQUENCIES } from '../constants/reportConstants';

const initialForm = {
  created_by: '',
  type: 'defect',
  // `application_name` is deliberately NOT here. The form has no application
  // picker, so holding one in form state only created somewhere for a hardcoded
  // application name to live; it is derived from the viewer at send time instead
  // (see homeApplicationName).
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
  // ── Report requests ───────────────────────────────────────────────────────
  // Title is `summary_of_issue`, Description is `what_happened_exact_details`
  // and "what's not working" is `request`, so those three are already above.
  //
  // `application_name` IS here, unlike for the other two types — for a report
  // request it is a question ("whose data is this about?"), and only the requester
  // knows the answer. It is sent only on the report branch; everything else still
  // derives the application from the viewer.
  application_name: '',
  is_new_dashboard: true,
  needed_data: '',
  measures_and_sources: '',
  primary_contact: '',
  existing_report_link: '',
  changes_requested: '',
  report_usage_frequency: '',
  department: '',
  desired_completion_date: '',
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
  // Deliberately minimal, and mirroring the server's own report branch. The
  // confirmed field list is a SAMPLE, so somebody blocked by a required question
  // they cannot answer types anything to get past it — and then the field is
  // worse than absent. The readiness rail still asks for the rest.
  report: [
    { key: 'created_by', label: 'Your name' },
    { key: 'summary_of_issue', label: 'One-line summary' },
    { key: 'what_happened_exact_details', label: 'Description' },
    // Required, not defaulted. It decides which analysts ever see the request, so
    // a silent default files it into the wrong team's queue — which is exactly
    // what happened while this was derived from the requester's own membership.
    { key: 'application_name', label: 'Which application' },
  ],
};

/** The one field the chosen branch cannot do without, plus the change branch's identity. */
const REPORT_BRANCH_FIELDS = {
  new: [{ key: 'measures_and_sources', label: 'Measures and sources' }],
  change: [
    { key: 'existing_report_link', label: 'Which report' },
    { key: 'changes_requested', label: 'What should change' },
  ],
};

const FIELD_ERRORS = {
  created_by: 'Enter your name.',
  summary_of_issue: 'Write one line describing the issue.',
  screen_title: 'Name the screen you were on.',
  date_of_error: 'Pick the date.',
  what_happened_exact_details: 'Describe what you saw.',
  request: 'Describe the change you would like.',
  measures_and_sources: 'List the measures and where the data comes from.',
  existing_report_link: 'Link the report, or say where you open it.',
  changes_requested: 'Describe what should change.',
  application_name: 'Choose which application the data comes from.',
};

// The summary and description labels change with the type — a report request is
// not an issue, and "what you saw" is a defect's question.
const FIELD_ERRORS_REPORT = {
  summary_of_issue: 'Write one line describing what you need.',
  what_happened_exact_details: 'Describe the report you need.',
};

const COUNT_WORDS = ['no', 'One', 'Two', 'Three', 'Four', 'Five'];

const TYPE_LABELS = { defect: 'Defect', enhancement: 'Enhancement', report: 'Report request' };

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** A labelled control with its counter, help line and inline error slot. */
function Field({ name, label, required, optional, counter, help, error, children }) {
  return (
    <div className={`rs-field${error ? ' is-bad' : ''}`}>
      <label htmlFor={`rs-${name}`}>
        {label}
        {required && <em className="rs-req">*</em>}
        {optional && <span className="rs-chip rs-chip--opt">Optional</span>}
        {counter && <span className="rs-count">{counter}</span>}
      </label>
      {/* Wired to the control with aria-describedby by the caller, not just
          placed near it — a screen reader otherwise reads the label and skips
          the sentence explaining it. */}
      {help && <p className="rs-help" id={`rs-${name}-help`}>{help}</p>}
      {children}
      {error && <p className="rs-bad">{error}</p>}
    </div>
  );
}

export function RepSubmitPage() {
  // Who the server will record this as. When it already knows, the form stops
  // asking — the name field would be a box whose value is discarded on arrival
  // (server/src/services/reporterService.js), which is worse than absent.
  // `reload` is used when a submit comes back saying the session has gone: the
  // form has to reshape itself from what the server now knows, not from what it
  // believed when the page was opened.
  const { viewer, reload: reloadViewer } = useViewer();
  const knownReporter = viewer.isAuthenticated ? viewer.user : null;

  // Which application this ticket belongs to. Read from the viewer's own
  // membership — the server decides it from their AD groups, else their most-filed
  // application — with the portal's first active application as the fallback for
  // someone who has neither. The page never names an application itself: this is a
  // multi-application portal, and a hardcoded name silently files Policy Center's
  // tickets into Billing Center's queue.
  const homeApplicationName = useMemo(() => {
    const list = Array.isArray(viewer.applications) ? viewer.applications : [];
    const home = list.find((app) => String(app.id) === String(viewer.homeApplicationId));
    return home?.name || list[0]?.name || '';
  }, [viewer.applications, viewer.homeApplicationId]);

  // Every application this portal takes requests for. A report request ASKS which
  // one, because "whose data is this about" is a question only the requester can
  // answer — somebody in Claims can perfectly well need a report over billing
  // data, and deriving it from their own membership filed those against the wrong
  // queue silently. A defect still derives it: a bug happened where the person
  // was, and they are already there.
  const applicationOptions = useMemo(
    () => (Array.isArray(viewer.applications) ? viewer.applications : []),
    [viewer.applications],
  );

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
  const isReport = form.type === 'report';
  const reportBranch = form.is_new_dashboard ? 'new' : 'change';

  // `created_by` drops out of the required set once the reporter is known,
  // mirroring the server: it no longer reads a typed name for a signed-in caller,
  // so demanding one here would block a submit that would have succeeded.
  const requiredFields = useMemo(() => {
    const base = [
      ...(REQUIRED_FIELDS[form.type] || REQUIRED_FIELDS.defect),
      ...(form.type === 'report' ? REPORT_BRANCH_FIELDS[form.is_new_dashboard ? 'new' : 'change'] : []),
    ];
    return knownReporter ? base.filter((field) => field.key !== 'created_by') : base;
  }, [form.type, form.is_new_dashboard, knownReporter]);
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
    if (!showErrors || !missing.some((field) => field.key === key)) return '';
    return (isReport && FIELD_ERRORS_REPORT[key]) || FIELD_ERRORS[key];
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
        // A report request carries the application the REQUESTER chose; everything
        // else derives it from where they work. `form.application_name` is only
        // ever set by the report branch's own picker.
        application_name: (isReport && form.application_name) || homeApplicationName,
        steps_to_reproduce: isDefect ? form.steps_to_reproduce || '-' : '-',
        // `request` carries the enhancement's ask, and on a report request it
        // carries "what's not working" — which is only asked of a change.
        request: isEnhancement ? form.request : (isReport && reportBranch === 'change' ? form.request : '-'),
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
        typeLabel: TYPE_LABELS[form.type] || 'Request',
        summary: form.summary_of_issue,
        screen: form.screen_title,
        // The confirmation must echo the name the server actually recorded, not
        // the (ignored) form field, or a signed-in rep sees a blank "filed by".
        name: knownReporter ? knownReporter.displayName : form.created_by,
        application: (isReport && form.application_name) || homeApplicationName,
        fileCount: files.length,
      });
      setForm(initialForm);
      setFiles([]);
      setShowErrors(false);
      formRef.current?.reset();
    } catch (submitError) {
      // A LAPSED SESSION, not a missing field. Sessions live in memory on the
      // server, so every deploy drops them while an open tab goes on showing
      // "Filing as …" from the viewer answer it fetched beforehand. The old
      // failure said "Requester Name is required" — a field this form stops
      // showing once it believes it knows who you are, so there was nothing to
      // act on.
      //
      // Nothing typed is cleared. The viewer is re-read so the form reshapes
      // itself: the name field comes back, and it can be sent as an anonymous
      // request without signing in again if that is quicker.
      if (submitError.status === 401 && submitError.body?.sessionExpired) {
        setError(
          'Your session ended — the server was restarted or you have been signed out.'
          + ' Nothing you typed has been lost: sign in again in another tab and press'
          + ' Submit, or fill in your name below and send it without signing in.',
        );
        reloadViewer();
      } else {
        setError(submitError.message);
      }
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
                {submitted.typeLabel}
                {submitted.application ? ` · ${submitted.application}` : ''}
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
          {/* Type-neutral AND application-neutral. Type-neutral because a report
              request is not an issue, and because a heading that rewrites itself
              when you press a segment moves the text above the control you just
              clicked. Application-neutral because this is the Service Requests
              Portal: it takes requests for whatever application the requester
              works in, and naming one of them in the h1 made the page look like
              somebody else's when it was not. The ticket still records the
              application, and the confirmation still says which one it went to. */}
          <h1>Submit a service request</h1>
          <p>
            Defects, enhancements and report requests all go to the same triage queue.
            You&rsquo;ll get a reference number and can follow it on the Status Board.
          </p>
        </div>
        <Link className="rs-headlink" to="/public">Status Board →</Link>
      </div>

      <form
        ref={formRef}
        className="rs-cols"
        data-type={form.type}
        data-branch={reportBranch}
        onSubmit={onSubmit}
        noValidate
      >
        <div className="rs-main">

          <section className="rs-card">
            {/* The type choice reshapes the form, but it is still one bit of
                information — it rides on the group-label row rather than owning a
                card of its own. */}
            <div className="rs-cardhead">
              <p className="rs-grouplabel">Your request</p>
              <div className="rs-seg" role="group" aria-label="What are you reporting?">
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
                <button
                  type="button"
                  className="rs-type"
                  aria-pressed={isReport}
                  onClick={() => setType('report')}
                >
                  <span className="rs-type-mark" aria-hidden="true" />
                  <span className="rs-type-name">Report request</span>
                </button>
              </div>
            </div>

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

            {/* WHO, THEN WHAT — one field per row, both branches.
                The reporter is a STATEMENT for a signed-in filer (nobody can
                change it) and a field for an anonymous one, but either way it
                comes first and the summary gets the full column beneath it.
                The two used to share a row when nobody was signed in, which is
                what a visitor to the live site saw: a 250px name box crowding the
                one field that carries the whole request, and its 140-character
                counter squeezed against the label. A one-line summary is the lead
                field on this form; it does not share. */}
            {knownReporter ? (
              <>
                <p className="rs-filedby">
                  Filing as <b>{knownReporter.displayName}</b>
                  {knownReporter.email && <span>{knownReporter.email}</span>}
                </p>
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
                      placeholder={isReport
                        ? 'e.g. Weekly unapplied cash by billing centre'
                        : "e.g. Renewal invoice shows the prior term's installment amount"}
                      value={form.summary_of_issue}
                      onChange={(e) => updateField('summary_of_issue', e.target.value)}
                    />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <div className="rs-field-name">
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
                </div>

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
                      placeholder={isReport
                        ? 'e.g. Weekly unapplied cash by billing centre'
                        : "e.g. Renewal invoice shows the prior term's installment amount"}
                      value={form.summary_of_issue}
                      onChange={(e) => updateField('summary_of_issue', e.target.value)}
                    />
                  </Field>
                </div>
              </>
            )}

            {/* The type being filed decides what can be a duplicate of it: a
                report request is only ever a duplicate of another report request,
                while a defect and an enhancement stay eligible for each other. */}
            <DuplicateCheck query={form.summary_of_issue} requestType={form.type} />
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

                {/* Defects only. An enhancement is by definition not stopping
                    anyone today, so there is nothing to work around.

                    It sits in this card rather than a titled one of its own: a
                    card around a single checkbox cost 120px for one boolean, and
                    the checkbox's own text asks the question the title was asking.

                    The wording is deliberately scoped to THIS case. "Blocked" or
                    "to keep working" reads as the whole job being stopped, so a
                    rep with one stuck account talks themselves out of ticking it
                    — which is exactly the case the team can most easily help
                    with. */}
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

          {isReport && (
            <>
              <section className="rs-card">
                <div className="rs-cardhead">
                  <p className="rs-grouplabel">What you need</p>
                  {/* The branch choice reshapes this card exactly as the type
                      choice reshapes the form, so it uses the same control. */}
                  <div className="rs-seg rs-seg--sub" role="group" aria-label="Is this new, or a change?">
                    <button
                      type="button"
                      className="rs-type"
                      aria-pressed={reportBranch === 'new'}
                      onClick={() => updateField('is_new_dashboard', true)}
                    >
                      <span className="rs-type-mark" aria-hidden="true" />
                      <span className="rs-type-name">Something new</span>
                    </button>
                    <button
                      type="button"
                      className="rs-type"
                      aria-pressed={reportBranch === 'change'}
                      onClick={() => updateField('is_new_dashboard', false)}
                    >
                      <span className="rs-type-mark" aria-hidden="true" />
                      <span className="rs-type-name">A change to one you already use</span>
                    </button>
                  </div>
                </div>

                {/* WHOSE DATA — asked, not assumed. This is the only type where
                    the application is a question: a defect happened where the
                    reporter was, but somebody in Claims can perfectly well need a
                    report over billing data. It also decides which analysts ever
                    see the request, so a silent default files it into the wrong
                    team's queue — which is what it used to do. */}
                <Field
                  name="application_name"
                  label="Which application is the data from?"
                  required
                  help="The system the numbers come out of, not the team asking for them.
                        If it spans more than one, or you are not sure, choose Other —
                        it goes to every reporting analyst and they will route it."
                  error={errorFor('application_name')}
                >
                  <select
                    id="rs-application_name"
                    aria-describedby="rs-application_name-help"
                    value={form.application_name}
                    onChange={(e) => updateField('application_name', e.target.value)}
                  >
                    <option value="">Select one</option>
                    {applicationOptions.map((application) => (
                      <option key={application.id} value={application.name}>{application.name}</option>
                    ))}
                  </select>
                </Field>

                {/* Identity first on a change: you cannot usefully describe what
                    you want done to a report before saying which one it is. */}
                <div className="rs-when-change">
                  <Field
                    name="existing_report_link"
                    label="Which report is it?"
                    required
                    help="Paste a link to it. If there is no link — a spreadsheet on a share drive,
                          something you open from a menu — just say where you find it."
                    error={errorFor('existing_report_link')}
                  >
                    <input
                      id="rs-existing_report_link"
                      type="text"
                      aria-describedby="rs-existing_report_link-help"
                      placeholder="https://… or where you open it from"
                      value={form.existing_report_link}
                      onChange={(e) => updateField('existing_report_link', e.target.value)}
                    />
                  </Field>
                </div>

                <Field
                  name="what_happened_exact_details"
                  label="Describe what you need"
                  required
                  counter={`${form.what_happened_exact_details.length} characters`}
                  error={errorFor('what_happened_exact_details')}
                >
                  <textarea
                    id="rs-what_happened_exact_details"
                    rows={5}
                    placeholder="What it should show, who will read it, and what decision it helps them make."
                    value={form.what_happened_exact_details}
                    onChange={(e) => updateField('what_happened_exact_details', e.target.value)}
                  />
                </Field>

                <Field name="needed_data" label="What data does it need?" optional>
                  <textarea
                    id="rs-needed_data"
                    rows={3}
                    placeholder="Fields, systems, date ranges — anything you know it has to pull from."
                    value={form.needed_data}
                    onChange={(e) => updateField('needed_data', e.target.value)}
                  />
                </Field>

                <div className="rs-when-new">
                  <Field
                    name="measures_and_sources"
                    label="Measures, and where they come from"
                    required
                    help="The numbers it should calculate, and the system or report each one comes from today."
                    error={errorFor('measures_and_sources')}
                  >
                    <textarea
                      id="rs-measures_and_sources"
                      rows={4}
                      aria-describedby="rs-measures_and_sources-help"
                      placeholder={'e.g. Unapplied cash total — from the nightly billing extract\nCount of open invoices — Billing Center'}
                      value={form.measures_and_sources}
                      onChange={(e) => updateField('measures_and_sources', e.target.value)}
                    />
                  </Field>
                  <Field
                    name="primary_contact"
                    label="Who owns the questions about it?"
                    optional
                    help="Leave it blank and we will come to you."
                  >
                    <input
                      id="rs-primary_contact"
                      type="text"
                      aria-describedby="rs-primary_contact-help"
                      placeholder="Name and email"
                      value={form.primary_contact}
                      onChange={(e) => updateField('primary_contact', e.target.value)}
                    />
                  </Field>
                </div>

                {/* Only asked of a change: nothing is broken about a report that
                    does not exist yet, so asking it of a new one asks for a blank. */}
                <div className="rs-when-change">
                  <Field
                    name="request"
                    label="What&rsquo;s not working, missing, or needed to change?"
                    optional
                  >
                    <textarea
                      id="rs-request"
                      rows={3}
                      placeholder="What it gives you today, and where that falls short."
                      value={form.request}
                      onChange={(e) => updateField('request', e.target.value)}
                    />
                  </Field>
                  <Field
                    name="changes_requested"
                    label="What should change?"
                    required
                    error={errorFor('changes_requested')}
                  >
                    <textarea
                      id="rs-changes_requested"
                      rows={4}
                      placeholder="A new column, a different filter, a number that reads wrong, a different cut of the same data."
                      value={form.changes_requested}
                      onChange={(e) => updateField('changes_requested', e.target.value)}
                    />
                  </Field>
                </div>
              </section>

              <section className="rs-card">
                <p className="rs-grouplabel">About the request</p>
                <div className="rs-field">
                  <p className="rs-grouptitle" id="rs-frequency-label">
                    How often will this be used?
                    <span className="rs-chip rs-chip--opt">Optional</span>
                  </p>
                  <div className="rs-pick" role="group" aria-labelledby="rs-frequency-label">
                    {USAGE_FREQUENCIES.map((frequency) => (
                      <button
                        key={frequency}
                        type="button"
                        className="rs-pickbtn"
                        aria-pressed={form.report_usage_frequency === frequency}
                        // Clicking the chosen one again clears it: an optional
                        // field you cannot un-answer is not optional.
                        onClick={() => updateField(
                          'report_usage_frequency',
                          form.report_usage_frequency === frequency ? '' : frequency,
                        )}
                      >
                        {frequency}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rs-row">
                  <Field name="desired_completion_date" label="When do you need it by?" optional>
                    <input
                      id="rs-desired_completion_date"
                      type="date"
                      value={form.desired_completion_date}
                      onChange={(e) => updateField('desired_completion_date', e.target.value)}
                    />
                  </Field>
                  <Field name="department" label="Which department is this for?" optional>
                    <input
                      id="rs-department"
                      type="text"
                      placeholder="e.g. Claims Operations"
                      value={form.department}
                      onChange={(e) => updateField('department', e.target.value)}
                    />
                  </Field>
                </div>
              </section>
            </>
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
          type={form.type}
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
