import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { auditService } from '../services/auditService.js';

const router = Router();
router.use(authMiddleware);

// GET RECENT AUDIT LOGS FOR CURRENT USER
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string) || 20;
    const logs = await auditService.getUserLogs(userId, limit);

    res.json({
      success: true,
      logs,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Không thể tải nhật ký hoạt động' });
  }
});

export default router;
