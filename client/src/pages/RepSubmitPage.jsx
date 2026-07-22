import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Button, Card, Input, Modal, Notice, Select, Textarea } from '../components/bite-size/BitsizeUI';
import { AiSearchPanel } from '../components/common/AiSearchPanel';
import { PublicItemCard } from '../components/public/PublicItemCard';

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
  desired_completion_date: '',
};

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function RepSubmitPage() {
  const [form, setForm] = useState(initialForm);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [submittedId, setSubmittedId] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [fileUrls, setFileUrls] = useState([]);
  const [confirmNoScreenshots, setConfirmNoScreenshots] = useState(false);
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

  function updateField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function setType(t) {
    setForm((prev) => ({ ...prev, type: t }));
    setFiles([]);
    setError('');
  }

  function onFileChange(event) {
    const selected = Array.from(event.target.files || []);
    setFiles((prev) => {
      const merged = [...prev];
      for (const nextFile of selected) {
        const exists = merged.some(
          (existing) =>
            existing.name === nextFile.name &&
            existing.size === nextFile.size &&
            existing.lastModified === nextFile.lastModified,
        );
        if (!exists) merged.push(nextFile);
      }
      return merged.slice(0, 3);
    });
    event.target.value = '';
  }

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function onSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmittedId(null);

    const isBlank = (v) => String(v ?? '').trim().length === 0;

    const missing = [];
    if (isBlank(form.created_by)) missing.push('Requester Name');
    if (isBlank(form.summary_of_issue)) missing.push(isDefect ? 'Summary of Issue' : 'Summary');
    if (isDefect) {
      if (isBlank(form.screen_title)) missing.push('Screen Title');
      if (isBlank(form.what_happened_exact_details)) missing.push('What Happened (Exact Details)');
      if (isBlank(form.date_of_error)) missing.push('Date of Error');
    }
    if (isEnhancement) {
      if (isBlank(form.request)) missing.push('Request Details');
    }

    if (missing.length > 0) {
      setError(`Missing required field(s): ${missing.join(', ')}`);
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
        date_time_of_error: isDefect ? `${form.date_of_error}T${form.time_of_error || '00:00'}` : '',
      };
      Object.entries(payload).forEach(([k, v]) => formData.append(k, v));
      files.forEach((f) => formData.append('attachments', f));

      const result = await api.submitRepSubmission(formData);
      setSubmittedId(result.id);
      setForm(initialForm);
      setFiles([]);
      formRef.current?.reset();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  }

  if (submittedId) {
    return (
      <div className="submit-page-wrap">
      <Card>
        <div className="submitted-card">
          <div className="submitted-icon"><CheckIcon /></div>
          <h3>Request Submitted</h3>
          <p>Your request has been logged. Reference ID: <strong>#{submittedId}</strong></p>
          <Button onClick={() => { setSubmittedId(null); setError(''); }}>
            Submit Another Request
          </Button>
        </div>
      </Card>
      </div>
    );
  }

  return (
    <div className="submit-page-wrap">
      <div className="page-header">
        <h2>Submit a Request</h2>
        <p>Use this form to report a defect or request an enhancement in Billing Center.</p>
      </div>

      <AiSearchPanel
        scope="public"
        title="Check if this was already reported"
        subtitle="Before you submit, describe your issue to see if it has already been reported — and what happened to it."
        placeholder="e.g. customer was double-charged on a renewal invoice"
        renderResults={(matches) => (
          <div className="public-list">
            {matches.map((item) => (
              <PublicItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      />

      <Card>
        <form ref={formRef} className="bs-form" onSubmit={onSubmit}>

          {/* ── Request type toggle ── */}
          <div className="bs-field">
            <span>Request Type</span>
            <div className="type-picker">
              <button type="button" className={isDefect ? 'active' : ''} onClick={() => setType('defect')}>
                🐛 Defect
              </button>
              <button type="button" className={isEnhancement ? 'active' : ''} onClick={() => setType('enhancement')}>
                ✨ Enhancement
              </button>
            </div>
          </div>

          {/* ── Requester ── */}
          <p className="section-label">Contact</p>
          <Input
            label="Requester Name"
            required
            placeholder="Your full name"
            value={form.created_by}
            onChange={(e) => updateField('created_by', e.target.value)}
          />

          {/* ── Defect fields ── */}
          {isDefect && (
            <>
              <p className="section-label">Incident Details</p>
              <div className="bs-grid two">
                <Input label="Policy Number" value={form.policy_num} onChange={(e) => updateField('policy_num', e.target.value)} />
                <Input label="Account Number" value={form.account_num} onChange={(e) => updateField('account_num', e.target.value)} />
                <Input label="Transaction Number" value={form.transaction_num} onChange={(e) => updateField('transaction_num', e.target.value)} />
                <Input label="Screen Title" required value={form.screen_title} onChange={(e) => updateField('screen_title', e.target.value)} />
                <Input label="Date of Error" type="date" required value={form.date_of_error} onChange={(e) => updateField('date_of_error', e.target.value)} />
                <Input label="Time of Error (optional)" type="time" value={form.time_of_error} onChange={(e) => updateField('time_of_error', e.target.value)} />
              </div>
              <Input label="Summary of Issue" required value={form.summary_of_issue} onChange={(e) => updateField('summary_of_issue', e.target.value)} />
              <Textarea label="Steps to Reproduce" rows={3} value={form.steps_to_reproduce} onChange={(e) => updateField('steps_to_reproduce', e.target.value)} />
              <Textarea label="What Happened? (Exact Details)" rows={4} required value={form.what_happened_exact_details} onChange={(e) => updateField('what_happened_exact_details', e.target.value)} />

              <p className="section-label">Screenshots (strongly encouraged)</p>
              <label className="bs-field">
                <span className="muted" style={{ fontSize: '12px', margin: 0, color: 'var(--color-muted)', fontWeight: 400 }}>Screens change over time — a screenshot makes it far more likely developers can see and reproduce the issue.</span>
                <input type="file" accept="image/*" multiple onChange={onFileChange} />
                <span className="muted" style={{ fontSize: '12px' }}>{files.length}/3 selected — click a thumbnail to preview</span>
              </label>
            </>
          )}

          {/* ── Enhancement fields ── */}
          {isEnhancement && (
            <>
              <p className="section-label">Enhancement Details</p>
              <div className="bs-grid two">
                <Input label="Application Name" value="Billing Center" disabled />
              </div>
              <Input label="Summary" required value={form.summary_of_issue} onChange={(e) => updateField('summary_of_issue', e.target.value)} />
              <Textarea label="Request Details" rows={5} required value={form.request} onChange={(e) => updateField('request', e.target.value)} />

              <p className="section-label">Attachments (optional)</p>
              <label className="bs-field">
                <input type="file" accept="image/*" multiple onChange={onFileChange} />
                <span className="muted" style={{ fontSize: '12px' }}>{files.length}/3 selected</span>
              </label>
            </>
          )}

          {/* ── Thumbnails ── */}
          {files.length > 0 && (
            <div className="thumb-grid">
              {files.map((file, index) => {
                const url = fileUrls[index];
                if (!url) return null;
                return (
                  <article key={`${file.name}-${file.size}-${index}`} className="thumb-item">
                    <button type="button" className="thumb-open-btn" onClick={() => setPreviewImage(url)}>
                      <img src={url} alt={file.name} />
                    </button>
                    <div className="thumb-meta">
                      <span className="thumb-name">{file.name}</span>
                      <Button kind="ghost" type="button" onClick={() => removeFile(index)}>Remove</Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <Notice text={error} />

          <div className="bs-actions">
            <Button type="submit" disabled={saving}>
              {saving ? 'Submitting…' : 'Submit Request'}
            </Button>
          </div>
        </form>
      </Card>

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
