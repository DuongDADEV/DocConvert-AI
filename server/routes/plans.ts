import { Router, Response } from 'express';
import { db } from '../db/db.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { auditService } from '../services/auditService.js';
import { quotaService } from '../services/quotaService.js';

const router = Router();

// GET ALL PLANS (Public / Auth)
router.get('/', async (_req, res): Promise<void> => {
  try {
    const plans = await db.getPlans();
    res.json({
      success: true,
      plans,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Không thể tải danh sách gói cước' });
  }
});

// UPGRADE PLAN (Authenticated, Mock Payment with clear tag)
router.post('/upgrade', authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { planId } = req.body;

    const plan = await db.getPlanById(planId);
    if (!plan) {
      res.status(400).json({ success: false, error: 'Gói cước không hợp lệ.' });
      return;
    }

    // Perform atomic plan upgrade across profiles, subscriptions, and usage with compensating rollback
    await db.upgradeUserPlan(userId, plan.id, plan.duration_days, req.userToken);

    await auditService.log({
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

    const updatedQuota = await quotaService.checkUserQuota(userId);

    res.json({
      success: true,
      message: `Đã nâng cấp lên ${plan.name} thành công (Môi trường Thử nghiệm - Cổng thanh toán Sandbox).`,
      quota: updatedQuota,
    });
  } catch (err: any) {
    console.error('Upgrade plan error:', err);
    res.status(500).json({ success: false, error: err.message || 'Có lỗi xảy ra khi nâng cấp gói cước.' });
  }
});

export default router;
