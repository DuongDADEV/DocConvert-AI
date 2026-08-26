import { Router, Response } from 'express';
import { db } from '../db/db.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { auditService } from '../services/auditService.js';
import { quotaService } from '../services/quotaService.js';

const router = Router();

// GET ALL PLANS (Public / Auth)
router.get('/', (_req, res): void => {
  try {
    const plans = db.getPlans();
    res.json({
      success: true,
      plans,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Không thể tải danh sách gói cước' });
  }
});

// UPGRADE PLAN (Authenticated, Mock Payment with clear tag)
router.post('/upgrade', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  try {
    const userId = req.user!.id;
    const { planId } = req.body;

    const plan = db.getPlanById(planId);
    if (!plan) {
      res.status(400).json({ success: false, error: 'Gói cước không hợp lệ.' });
      return;
    }

    // Update user's current plan and reset / boost quota
    db.updateProfile(userId, {
      current_plan_id: plan.id,
      used_documents: 0, // Reset usage for new plan cycle
    });

    auditService.log({
      userId,
      action: 'UPGRADE_PLAN',
      resourceType: 'plans',
      resourceId: plan.id,
      ipAddress: req.ip,
      metadata: {
        planName: plan.name,
        paymentNote: 'MOCK_PAYMENT_PROCESSED',
      },
    });

    const updatedQuota = quotaService.checkUserQuota(userId);

    res.json({
      success: true,
      message: `Đã nâng cấp lên ${plan.name} thành công (Môi trường Thử nghiệm - Cổng thanh toán Sandbox).`,
      quota: updatedQuota,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Có lỗi xảy ra khi nâng cấp gói cước.' });
  }
});

export default router;
