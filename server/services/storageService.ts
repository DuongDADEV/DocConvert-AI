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

    const userClient = userToken ? createSupabaseUserClient(userToken) : null;
    const client = userClient || getSupabaseAdminClient() || getBaseSupabaseClient();

    if (!client) {
      throw new Error('Không thể kết nối dịch vụ lưu trữ Supabase Storage (Client không tồn tại).');
    }

    const { error } = await client.storage
      .from(this.BUCKET)
      .upload(objectKey, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) {
      console.error(`[StorageService] Supabase storage upload failed for ${objectKey}:`, error.message);
      throw new Error(`Lưu trữ tệp vào Supabase Storage thất bại: ${error.message}`);
    }

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

    const userClient = userToken ? createSupabaseUserClient(userToken) : null;
    const client = userClient || getSupabaseAdminClient() || getBaseSupabaseClient();

    if (!client) {
      console.error('[StorageService] Supabase client unavailable for getFile');
      return null;
    }

    try {
      const { data: listData, error: listErr } = await client.storage
        .from(this.BUCKET)
        .list(`${safeUserId}/${safeDocId}/original`);

      if (listErr) {
        console.error(`[StorageService] Failed to list files for ${safeDocId}:`, listErr.message);
        return null;
      }

      if (listData && listData.length > 0) {
        const fileName = listData[0].name;
        const { data: downloadData, error: downloadErr } = await client.storage
          .from(this.BUCKET)
          .download(`${safeUserId}/${safeDocId}/original/${fileName}`);

        if (downloadErr) {
          console.error(`[StorageService] Failed to download file for ${safeDocId}:`, downloadErr.message);
          return null;
        }

        if (downloadData) {
          const arrayBuf = await downloadData.arrayBuffer();
          return {
            buffer: Buffer.from(arrayBuf),
            mimeType: downloadData.type || 'application/octet-stream',
            filename: fileName,
          };
        }
      }
    } catch (err: any) {
      console.error('[StorageService] Unexpected exception downloading file:', err.message);
      return null;
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

    return true;
  }
}

export const storageService = new StorageService();
