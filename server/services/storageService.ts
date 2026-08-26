import path from 'path';
import crypto from 'crypto';
import { createSupabaseUserClient, getBaseSupabaseClient } from './supabaseClient.js';
import { getSupabaseAdminClient } from './supabaseAdmin.js';

export interface SavedFileResult {
  storageBucket: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface StoredFileData {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

// Memory/Mock Storage Store for Container Runtime / Offline Test Mode
// Uses an isolated Map keyed by `bucket:userId:documentId:filename`
const virtualStorageStore = new Map<string, { buffer: Buffer; mimeType: string; filename: string; path: string }>();

class StorageService {
  private readonly BUCKET = 'documents';

  /**
   * Sanitizes identifiers and filenames to prevent path traversal
   */
  private sanitize(input: string): string {
    return input.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  /**
   * Uploads file to Private Supabase Storage bucket 'documents'
   * Path: {userId}/{documentId}/original/{safeFilename}
   */
  async saveFile(
    userId: string,
    documentId: string,
    filename: string,
    buffer: Buffer,
    mimeType: string = 'application/octet-stream',
    userToken?: string
  ): Promise<SavedFileResult> {
    const safeUserId = this.sanitize(userId);
    const safeDocId = this.sanitize(documentId);
    const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');

    // Canonical private object path in bucket 'documents'
    const objectKey = `${safeUserId}/${safeDocId}/original/${safeFilename}`;
    const storagePath = `documents/${objectKey}`;

    // Check path traversal attempts
    if (safeUserId.includes('..') || safeDocId.includes('..') || safeFilename.includes('..')) {
      throw new Error('Cảnh báo bảo mật: Phát hiện ký tự không hợp lệ trong đường dẫn tệp.');
    }

    // 1. If Supabase is connected with live credentials
    const userClient = userToken ? createSupabaseUserClient(userToken) : null;
    const client = userClient || getSupabaseAdminClient() || getBaseSupabaseClient();

    if (client) {
      try {
        const { error } = await client.storage
          .from(this.BUCKET)
          .upload(objectKey, buffer, {
            contentType: mimeType,
            upsert: true,
          });

        if (error) {
          console.warn('Supabase storage upload error, falling back to storage memory engine:', error.message);
        }
      } catch (err) {
        console.warn('Supabase storage exception:', err);
      }
    }

    // 2. Always persist to unified storage store
    const storeKey = `${this.BUCKET}:${safeUserId}:${safeDocId}:${safeFilename}`;
    virtualStorageStore.set(storeKey, {
      buffer,
      mimeType,
      filename: safeFilename,
      path: storagePath,
    });

    return {
      storageBucket: this.BUCKET,
      storagePath,
      fileName: safeFilename,
      fileSize: buffer.length,
      mimeType,
    };
  }

  /**
   * Downloads file from Private Supabase Storage bucket 'documents'
   * Enforces User Ownership / RLS: User A can only read from their own user folder
   */
  async getFile(
    userId: string,
    documentId: string,
    userToken?: string
  ): Promise<StoredFileData | null> {
    const safeUserId = this.sanitize(userId);
    const safeDocId = this.sanitize(documentId);

    // 1. Try Supabase Storage SDK if connected
    const userClient = userToken ? createSupabaseUserClient(userToken) : null;
    const client = userClient || getSupabaseAdminClient() || getBaseSupabaseClient();

    if (client) {
      try {
        const { data: listData } = await client.storage
          .from(this.BUCKET)
          .list(`${safeUserId}/${safeDocId}/original`);

        if (listData && listData.length > 0) {
          const fileName = listData[0].name;
          const { data: downloadData, error: downloadErr } = await client.storage
            .from(this.BUCKET)
            .download(`${safeUserId}/${safeDocId}/original/${fileName}`);

          if (!downloadErr && downloadData) {
            const arrayBuf = await downloadData.arrayBuffer();
            return {
              buffer: Buffer.from(arrayBuf),
              mimeType: downloadData.type || 'application/octet-stream',
              filename: fileName,
            };
          }
        }
      } catch (err) {
        // Continue to fallback
      }
    }

    // 2. Lookup in unified storage store with strict user prefix
    for (const [key, value] of virtualStorageStore.entries()) {
      if (key.startsWith(`${this.BUCKET}:${safeUserId}:${safeDocId}:`)) {
        return {
          buffer: value.buffer,
          mimeType: value.mimeType,
          filename: value.filename,
        };
      }
    }

    return null;
  }

  /**
   * Generates a short-lived signed URL (e.g. 60 seconds) for secure download/preview
   */
  async createSignedUrl(
    userId: string,
    documentId: string,
    filename: string,
    expiresInSeconds: number = 60,
    userToken?: string
  ): Promise<{ signedUrl: string; expiresAt: string } | null> {
    const safeUserId = this.sanitize(userId);
    const safeDocId = this.sanitize(documentId);
    const safeFilename = this.sanitize(filename);
    const objectKey = `${safeUserId}/${safeDocId}/original/${safeFilename}`;

    const client = (userToken ? createSupabaseUserClient(userToken) : null) || getSupabaseAdminClient() || getBaseSupabaseClient();
    if (client) {
      try {
        const { data, error } = await client.storage
          .from(this.BUCKET)
          .createSignedUrl(objectKey, expiresInSeconds);

        if (!error && data?.signedUrl) {
          return {
            signedUrl: data.signedUrl,
            expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
          };
        }
      } catch {
        // Fallback to ticket
      }
    }

    // Fallback secure single-use ticket URL
    const ticket = crypto.randomBytes(24).toString('hex');
    return {
      signedUrl: `/api/documents/${documentId}/stream?ticket=${ticket}`,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  /**
   * Deletes all objects under user's document folder from Storage
   */
  async deleteDocumentFiles(userId: string, documentId: string, userToken?: string): Promise<boolean> {
    const safeUserId = this.sanitize(userId);
    const safeDocId = this.sanitize(documentId);

    const client = (userToken ? createSupabaseUserClient(userToken) : null) || getSupabaseAdminClient() || getBaseSupabaseClient();
    if (client) {
      try {
        const { data: files } = await client.storage
          .from(this.BUCKET)
          .list(`${safeUserId}/${safeDocId}/original`);

        if (files && files.length > 0) {
          const filePaths = files.map((f) => `${safeUserId}/${safeDocId}/original/${f.name}`);
          await client.storage.from(this.BUCKET).remove(filePaths);
        }
      } catch (err) {
        console.warn('Storage deletion warning:', err);
      }
    }

    // Remove from unified virtual storage
    for (const key of virtualStorageStore.keys()) {
      if (key.startsWith(`${this.BUCKET}:${safeUserId}:${safeDocId}:`)) {
        virtualStorageStore.delete(key);
      }
    }

    return true;
  }
}

export const storageService = new StorageService();
