import 'dotenv/config';
import express from 'express';
import path from 'path';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { generalApiRateLimiter } from './server/middleware/rateLimiter.js';
import authRoutes from './server/routes/auth.js';
import documentRoutes from './server/routes/documents.js';
import jobRoutes from './server/routes/jobs.js';
import planRoutes from './server/routes/plans.js';
import auditRoutes from './server/routes/audit.js';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Basic security and parsing middleware
  app.use(cors());
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));
  app.use('/api', generalApiRateLimiter);

  // API Routes (Mounted first)
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'DocConvert AI SaaS Platform API',
      version: '1.0.0',
      azureDocumentIntelligence: 'PHASE_2_PREPARED',
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/jobs', jobRoutes);
  app.use('/api/plans', planRoutes);
  app.use('/api/audit-logs', auditRoutes);

  // Global Error Handler for API
  app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled API Error:', err);
    res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Đã xảy ra lỗi máy chủ nội bộ. Vui lòng thử lại.',
    });
  });

  // Vite Middleware for SPA Frontend
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[DocConvert AI] Server is running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start DocConvert AI server:', err);
});
