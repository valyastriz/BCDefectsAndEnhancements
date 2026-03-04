const path = require('path');
const fs = require('fs');
const dbApi = require('../../db');
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_STORAGE_BUCKET,
  SUPABASE_STORAGE_ENABLED,
  uploadsRoot,
} = require('../config');

function sanitizeUploadFilename(fileName) {
  return String(fileName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildSupabaseObjectPath(submissionId, originalName) {
  const safeName = sanitizeUploadFilename(originalName);
  const uniquePrefix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${submissionId}/${uniquePrefix}-${safeName}`;
}

function encodeStoragePath(pathValue) {
  return String(pathValue || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildSupabasePublicUrl(objectPath) {
  const baseUrl = String(SUPABASE_URL || '').replace(/\/+$/, '');
  return `${baseUrl}/storage/v1/object/public/${encodeURIComponent(SUPABASE_STORAGE_BUCKET)}/${encodeStoragePath(objectPath)}`;
}

async function uploadFileToSupabaseStorage(tempFilePath, submissionId, originalName, mimeType) {
  if (!SUPABASE_STORAGE_ENABLED) return null;

  const objectPath = buildSupabaseObjectPath(submissionId, originalName);
  const uploadUrl = `${String(SUPABASE_URL).replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(SUPABASE_STORAGE_BUCKET)}/${encodeStoragePath(objectPath)}`;
  const fileBuffer = fs.readFileSync(tempFilePath);

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': mimeType || 'application/octet-stream',
      'x-upsert': 'false',
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(bodyText || `Supabase storage upload failed (${response.status})`);
  }

  return {
    objectPath,
    publicUrl: buildSupabasePublicUrl(objectPath),
  };
}

function extractSupabaseObjectPathFromUrl(filePath) {
  const value = String(filePath || '').trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    const marker = `/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) return null;
    const encodedPath = parsed.pathname.slice(index + marker.length);
    if (!encodedPath) return null;
    return encodedPath
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    return null;
  }
}

async function deleteSupabaseStoredFileByUrl(filePath) {
  if (!SUPABASE_STORAGE_ENABLED) return false;

  const objectPath = extractSupabaseObjectPathFromUrl(filePath);
  if (!objectPath) return false;

  const deleteUrl = `${String(SUPABASE_URL).replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(SUPABASE_STORAGE_BUCKET)}/${encodeStoragePath(objectPath)}`;
  const response = await fetch(deleteUrl, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
  });

  if (!response.ok && response.status !== 404) {
    const bodyText = await response.text();
    throw new Error(bodyText || `Supabase storage delete failed (${response.status})`);
  }

  return true;
}

async function persistUploadedFiles(db, submissionId, files, uploadedByRole) {
  if (!files || files.length === 0) return [];

  const dbModels = dbApi.getModels() || {};
  const Attachment = dbModels.Attachment;
  if (!Attachment) {
    throw new Error('Attachment model is not initialized');
  }

  const destDir = path.join(uploadsRoot, String(submissionId));
  if (!SUPABASE_STORAGE_ENABLED) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const inserted = [];

  for (const file of files) {
    let storedPath = '';
    try {
      if (SUPABASE_STORAGE_ENABLED) {
        const uploaded = await uploadFileToSupabaseStorage(
          file.path,
          submissionId,
          file.originalname,
          file.mimetype,
        );
        storedPath = uploaded.publicUrl;
      } else {
        const safeName = sanitizeUploadFilename(file.originalname);
        const finalName = `${Date.now()}-${safeName}`;
        const finalPath = path.join(destDir, finalName);
        fs.renameSync(file.path, finalPath);
        storedPath = path.relative(path.join(__dirname, '..', '..'), finalPath).replaceAll('\\', '/');
      }
    } finally {
      if (fs.existsSync(file.path)) {
        fs.rmSync(file.path, { force: true });
      }
    }

    const uploadedAt = new Date().toISOString();
    const createdAttachment = await Attachment.create({
      submission_id: submissionId,
      filename: file.originalname,
      mime_type: file.mimetype || 'application/octet-stream',
      file_path: storedPath,
      uploaded_at: uploadedAt,
      uploaded_by_role: uploadedByRole,
    });
    const insertedId = Number(createdAttachment.id);

    inserted.push({
      id: insertedId,
      submission_id: submissionId,
      filename: file.originalname,
      mime_type: file.mimetype || 'application/octet-stream',
      file_path: storedPath,
      uploaded_at: uploadedAt,
      uploaded_by_role: uploadedByRole,
    });
  }

  return inserted;
}

module.exports = {
  sanitizeUploadFilename,
  buildSupabaseObjectPath,
  encodeStoragePath,
  buildSupabasePublicUrl,
  uploadFileToSupabaseStorage,
  extractSupabaseObjectPathFromUrl,
  deleteSupabaseStoredFileByUrl,
  persistUploadedFiles,
};
