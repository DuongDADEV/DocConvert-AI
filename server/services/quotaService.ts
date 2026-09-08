import { db } from '../db/db.js';

export interface QuotaStatus {
  allowed: boolean;
  used: number;
  total: number;
  remaining: number;
  planId: string;
  planName: string;
  message?: string;
}

export class QuotaService {
  /**
   * Check if user is allowed to upload another document.
   * Strict server-side verification: never trust client values.
   */
  async checkUserQuota(userId: string): Promise<QuotaStatus> {
    const user = await db.findProfileById(userId);
    if (!user) {
      return {
        allowed: false,
        used: 0,
        total: 0,
        remaining: 0,
        planId: 'NONE',
        planName: 'Chưa xác định',
        message: 'Không tìm thấy tài khoản người dùng',
      };
    }

    const plan = (await db.getPlanById(user.current_plan_id)) || {
      id: 'FREE',
      name: 'Gói Miễn Phí (Free)',
      document_quota: 3,
    };

    const used = user.used_documents || 0;
    const total = plan.document_quota;
    const remaining = Math.max(0, total - used);
    const allowed = used < total;

    return {
      allowed,
      used,
      total,
      remaining,
      planId: plan.id,
      planName: plan.name,
      message: allowed
        ? `Bạn đã sử dụng ${used}/${total} tài liệu.`
        : `Bạn đã sử dụng hết ${total}/${total} tài liệu miễn phí. Vui lòng nâng cấp gói để tiếp tục.`,
    };
  }

  /**
   * Atomically consumes one document quota slot.
   */
  async consumeQuota(userId: string): Promise<QuotaStatus> {
    const status = await this.checkUserQuota(userId);
    if (!status.allowed) {
      throw new Error(status.message || 'Đã vượt quá hạn mức tài liệu');
    }

    await db.updateProfileUsage(userId, status.used + 1);
    return await this.checkUserQuota(userId);
  }
}

export const quotaService = new QuotaService();
