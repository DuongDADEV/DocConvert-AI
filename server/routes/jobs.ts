import { Router, Response } from 'express';
import { db } from '../db/db.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET PROCESSING JOB STATUS
router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const jobId = req.params.id;

    const job = await db.getProcessingJob(userId, jobId);
    if (!job) {
      res.status(404).json({
        success: false,
        error: 'Không tìm thấy tiến trình xử lý hoặc bạn không có quyền truy cập.',
      });
      return;
    }

    res.json({
      success: true,
      job,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Không thể tải trạng thái tiến trình' });
  }
});

export default router;
