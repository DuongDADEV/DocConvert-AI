import { Request, Response, NextFunction } from 'express';
import { verifySupabaseToken, createSupabaseUserClient, AuthenticatedUser } from '../services/supabaseClient.js';
import { SupabaseClient } from '@supabase/supabase-js';

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  userToken?: string;
  supabaseClient?: SupabaseClient | null;
}

/**
 * Express Authentication Middleware
 * Validates Supabase Access Token exclusively via 'Authorization: Bearer <token>' header.
 * 
 * AUDIT RULE:
 * - Query parameter tokens (?token=...) are STRICTLY DISALLOWED to prevent URL/history leakage.
 */
export async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Chưa xác thực hoặc phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
      });
      return;
    }

    const token = authHeader.substring(7).trim();

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Mã xác thực không hợp lệ.',
      });
      return;
    }

    const user = await verifySupabaseToken(token);
    if (!user) {
      res.status(401).json({
        success: false,
        error: 'Phiên làm việc không hợp lệ hoặc đã hết hạn.',
      });
      return;
    }

    req.user = user;
    req.userToken = token;
    req.supabaseClient = createSupabaseUserClient(token);

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({
      success: false,
      error: 'Xác thực thất bại. Vui lòng đăng nhập lại.',
    });
  }
}
