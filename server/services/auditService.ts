import { db, AuditLogRecord } from '../db/db.js';

export class AuditService {
  log(params: {
    userId: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    ipAddress?: string;
    metadata?: Record<string, any>;
  }): AuditLogRecord {
    // Sanitize metadata to never log passwords or raw file binary data
    const cleanMetadata = { ...params.metadata };
    delete cleanMetadata.password;
    delete cleanMetadata.password_hash;
    delete cleanMetadata.file_buffer;

    return db.createAuditLog({
      user_id: params.userId,
      action: params.action,
      resource_type: params.resourceType,
      resource_id: params.resourceId,
      ip_address: params.ipAddress,
      metadata: cleanMetadata,
    });
  }

  getUserLogs(userId: string, limit = 20): AuditLogRecord[] {
    return db.getUserAuditLogs(userId, limit);
  }
}

export const auditService = new AuditService();
