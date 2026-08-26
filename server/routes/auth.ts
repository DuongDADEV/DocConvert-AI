import { Router, Request, Response } from 'express';
import { db } from '../db/db.js';
import { getBaseSupabaseClient, verifySupabaseToken } from '../services/supabaseClient.js';
import { quotaService } from '../services/quotaService.js';
import { auditService } from '../services/auditService.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

// ============================================================================
// 1. REGISTER USER (Supabase Auth Integration)
// ============================================================================
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, fullName, confirmPassword } = req.body;

    if (!email || !password || !fullName) {
      res.status(400).json({
        success: false,
        error: 'Vui lòng điền đầy đủ họ tên, email và mật khẩu.',
      });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({
        success: false,
        error: 'Mật khẩu phải chứa ít nhất 6 ký tự.',
      });
      return;
    }

    if (confirmPassword && password !== confirmPassword) {
      res.status(400).json({
        success: false,
        error: 'Mật khẩu xác nhận không khớp.',
      });
      return;
    }

    // 1. If Supabase Auth Live Client is available
    const liveSupabase = getBaseSupabaseClient();
    if (liveSupabase) {
      const { data: authData, error: authError } = await liveSupabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
        },
      });

      if (authError || !authData.user) {
        res.status(400).json({
          success: false,
          error: authError?.message || 'Không thể tạo tài khoản với Supabase Auth.',
        });
        return;
      }

      const token = authData.session?.access_token || '';
      const quota = quotaService.checkUserQuota(authData.user.id);

      auditService.log({
        userId: authData.user.id,
        action: 'REGISTER_USER',
        resourceType: 'profiles',
        resourceId: authData.user.id,
        ipAddress: req.ip,
      });

      res.status(201).json({
        success: true,
        message: 'Đăng ký tài khoản thành công qua Supabase Auth.',
        token,
        user: {
          id: authData.user.id,
          email: authData.user.email,
          fullName: fullName.trim(),
          currentPlanId: 'FREE',
          usedDocuments: 0,
          createdAt: authData.user.created_at,
        },
        quota,
      });
      return;
    }

    // 2. Unified Supabase Local Auth Engine
    const { user, profile, session } = await db.createAuthUserAndProfile({
      email,
      password,
      fullName,
    });

    const quota = quotaService.checkUserQuota(user.id);

    auditService.log({
      userId: user.id,
      action: 'REGISTER_USER',
      resourceType: 'profiles',
      resourceId: user.id,
      ipAddress: req.ip,
    });

    res.status(201).json({
      success: true,
      message: 'Đăng ký tài khoản thành công.',
      token: session.access_token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        currentPlanId: profile.current_plan_id,
        usedDocuments: profile.used_documents,
        createdAt: profile.created_at,
      },
      quota,
    });
  } catch (err: any) {
    console.error('Registration error:', err);
    res.status(400).json({
      success: false,
      error: err.message || 'Đăng ký không thành công. Vui lòng thử lại.',
    });
  }
});

// ============================================================================
// 2. LOGIN USER (Supabase Auth Integration)
// ============================================================================
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: 'Vui lòng nhập đầy đủ email và mật khẩu.',
      });
      return;
    }

    // 1. If Supabase Auth Live Client is available
    const liveSupabase = getBaseSupabaseClient();
    if (liveSupabase) {
      const { data: authData, error: authError } = await liveSupabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError || !authData.session || !authData.user) {
        res.status(401).json({
          success: false,
          error: 'Email hoặc mật khẩu không chính xác.',
        });
        return;
      }

      const token = authData.session.access_token;
      const profile = db.findProfileById(authData.user.id);
      const quota = quotaService.checkUserQuota(authData.user.id);

      auditService.log({
        userId: authData.user.id,
        action: 'LOGIN_USER',
        resourceType: 'profiles',
        resourceId: authData.user.id,
        ipAddress: req.ip,
      });

      res.json({
        success: true,
        message: 'Đăng nhập thành công qua Supabase Auth.',
        token,
        user: {
          id: authData.user.id,
          email: authData.user.email,
          fullName: profile?.full_name || authData.user.user_metadata?.full_name || 'User',
          currentPlanId: profile?.current_plan_id || 'FREE',
          usedDocuments: profile?.used_documents || 0,
          createdAt: authData.user.created_at,
        },
        quota,
      });
      return;
    }

    // 2. Unified Supabase Local Auth Engine
    const result = await db.authenticateUser(email, password);
    if (!result) {
      res.status(401).json({
        success: false,
        error: 'Email hoặc mật khẩu không chính xác.',
      });
      return;
    }

    const { profile, session } = result;
    const quota = quotaService.checkUserQuota(profile.id);

    auditService.log({
      userId: profile.id,
      action: 'LOGIN_USER',
      resourceType: 'profiles',
      resourceId: profile.id,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'Đăng nhập thành công.',
      token: session.access_token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        currentPlanId: profile.current_plan_id,
        usedDocuments: profile.used_documents,
        createdAt: profile.created_at,
      },
      quota,
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({
      success: false,
      error: 'Lỗi máy chủ khi xác thực đăng nhập.',
    });
  }
});

// ============================================================================
// 3. GET CURRENT USER PROFILE & QUOTA (Requires Supabase Session)
// ============================================================================
router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const quota = quotaService.checkUserQuota(user.id);

    res.json({
      success: true,
      user,
      quota,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Không thể tải thông tin người dùng.' });
  }
});

// ============================================================================
// 4. LOGOUT (Revokes Supabase Session)
// ============================================================================
router.post('/logout', authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const token = req.userToken;
    if (token) {
      const liveSupabase = getBaseSupabaseClient();
      if (liveSupabase) {
        await liveSupabase.auth.signOut();
      }
      db.revokeSession(token);
    }

    if (req.user) {
      auditService.log({
        userId: req.user.id,
        action: 'LOGOUT_USER',
        resourceType: 'profiles',
        resourceId: req.user.id,
        ipAddress: req.ip,
      });
    }

    res.json({ success: true, message: 'Đăng xuất thành công.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Lỗi khi đăng xuất.' });
  }
});

export default router;
