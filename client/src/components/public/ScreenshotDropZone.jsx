import { useCallback, useEffect, useRef, useState } from 'react';

// Mirrors the server's allow-list (server/src/middleware/upload.js) so a file
// the API would reject is refused here, with a reason, instead of coming back
// as a 400 after the rep has filled in the whole form.
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.heif'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function isSameFile(a, b) {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

function rejectionReason(file) {
  const name = String(file.name || '').toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
  // The server checks extension AND mime type; a HEIC that the browser hands
  // over with an empty mime type would fail there, so it fails here too.
  if (!hasAllowedExtension || !String(file.type || '').toLowerCase().startsWith('image/')) {
    return `${file.name || 'That file'} is not an image we can accept.`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 10 MB.`;
  }
  return '';
}

/**
 * A clipboard screenshot usually arrives with no filename at all. Left alone it
 * would fail the extension check above — and, if it somehow got past, multer's
 * identical check on `originalname`. Give it one derived from its mime type.
 */
function withUsableName(file, ordinal) {
  if (/\.[a-z0-9]+$/i.test(file.name || '')) return file;
  const subtype = String(file.type || '').split('/')[1] || 'png';
  const extension = subtype === 'jpeg' ? 'jpg' : subtype;
  return new File([file], `pasted-screenshot-${ordinal}.${extension}`, {
    type: file.type || 'image/png',
    lastModified: file.lastModified || Date.now(),
  });
}

/** `.files` is the common path; `.items` covers browsers that leave it empty. */
function clipboardImages(clipboardData) {
  if (!clipboardData) return [];
  const direct = Array.from(clipboardData.files || []);
  if (direct.length > 0) return direct;
  return Array.from(clipboardData.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Screenshot attachment area.
 *
 * Three ways in, because reps get screenshots three ways: drag from a folder,
 * browse, or — the common one — press PrintScreen and paste.
 *
 * Only the Browse button opens the file picker. Clicking the zone itself just
 * focuses it, which is what someone reaching for Ctrl+V expects; it also keeps
 * the hidden file input from taking focus, because Chrome does not dispatch
 * paste events while an `input[type=file]` is focused. The input is a sibling
 * of the zone, not a child, so its synthetic click cannot bubble back in.
 *
 * Preview URLs are created and revoked by the page that owns `files`, and
 * arrive here as `fileUrls` — index-aligned with `files`.
 */
export function ScreenshotDropZone({ files, fileUrls, onFilesChange, onPreview, max = 3 }) {
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const [notice, setNotice] = useState('');
  const inputRef = useRef(null);
  const zoneRef = useRef(null);

  const isFull = files.length >= max;

  // Memoised because the paste effect below subscribes to it: without this the
  // window listener would be torn down and re-added on every render.
  const addFiles = useCallback(function addFiles(incoming) {
    const candidates = Array.from(incoming || []);
    if (candidates.length === 0) return;

    const accepted = [];
    const problems = [];
    let room = max - files.length;

    candidates.forEach((candidate, index) => {
      const file = withUsableName(candidate, files.length + index + 1);
      const reason = rejectionReason(file);
      if (reason) {
        problems.push(reason);
        return;
      }
      if (files.some((existing) => isSameFile(existing, file))
        || accepted.some((existing) => isSameFile(existing, file))) {
        return;
      }
      if (room <= 0) {
        problems.push(`You can attach ${max} screenshots — ${file.name} was not added.`);
        return;
      }
      accepted.push(file);
      room -= 1;
    });

    if (accepted.length > 0) onFilesChange([...files, ...accepted]);
    setNotice(problems[0] || '');
  }, [files, max, onFilesChange]);

  // Window-level so a paste lands wherever the rep happens to be on the page —
  // they have just come back from another window and will not have clicked the
  // zone first. A plain text paste carries no files and falls straight through.
  useEffect(() => {
    const onPaste = (event) => {
      const pasted = clipboardImages(event.clipboardData);
      if (pasted.length === 0) return;
      event.preventDefault();
      addFiles(pasted);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  function openPicker() {
    if (isFull) return;
    inputRef.current?.click();
  }

  let headline = 'Drag an image here';
  if (isFull) headline = `All ${max} screenshots added`;
  else if (dragging) headline = 'Drop it to attach';
  else if (focused) headline = 'Ready — press Ctrl + V to paste';

  return (
    <>
      <div
        ref={zoneRef}
        className={`rs-drop${dragging ? ' is-dragging' : ''}${focused ? ' is-focused' : ''}`}
        role="group"
        aria-label="Screenshots — drop a file, browse, or press Control V to paste"
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onDragOver={(event) => { event.preventDefault(); if (!isFull) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer?.files);
        }}
      >
        <span className="rs-drop-icon" aria-hidden="true">📷</span>
        <b>{headline}</b>
        {!isFull && (
          <>
            <button type="button" className="rs-drop-browse" onClick={openPicker}>
              Browse…
            </button>
            <span>
              or click this box and press <kbd>Ctrl</kbd> + <kbd>V</kbd> to paste a screenshot
              from your clipboard.
            </span>
          </>
        )}
      </div>

      {/* Sibling, never a child of the zone: as a child its programmatic click
          bubbles back up, and focusing it silently disables Ctrl + V. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="rs-drop-input"
        tabIndex={-1}
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = '';
          // Hand focus back so the next Ctrl + V reaches the page.
          zoneRef.current?.focus();
        }}
        onCancel={() => zoneRef.current?.focus()}
      />

      {notice && <p className="rs-drop-notice">{notice}</p>}

      {files.length > 0 && (
        <div className="rs-shots">
          {files.map((file, index) => {
            const url = fileUrls[index];
            return (
              <figure key={`${file.name}-${file.size}-${file.lastModified}`} className="rs-shot">
                {url ? (
                  <button
                    type="button"
                    className="rs-shot-btn"
                    onClick={() => onPreview(url)}
                    aria-label={`Open ${file.name}`}
                  >
                    <img src={url} alt={file.name} />
                  </button>
                ) : (
                  <span className="rs-shot-btn" />
                )}
                <figcaption className="rs-shot-cap">
                  <span className="rs-shot-name" title={file.name}>{file.name}</span>
                  <span className="rs-shot-size">{formatSize(file.size)}</span>
                  <button
                    type="button"
                    className="rs-shot-x"
                    onClick={() => onFilesChange(files.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}

      <p className="rs-shot-rules">
        {files.length} of {max} added · PNG, JPG, GIF, WEBP, BMP or HEIC · up to 10 MB each
      </p>
    </>
  );
}
