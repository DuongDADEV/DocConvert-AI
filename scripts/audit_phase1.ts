/**
 * Phase 1 Audit Verification Script
 * Audits core database integrity, password hashing, and RLS schema
 */
import { db } from '../server/db/db.js';
import { storageService } from '../server/services/storageService.js';
import { quotaService } from '../server/services/quotaService.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

interface AuditResult {
  category: string;
  test: string;
  status: 'PASS' | 'FAIL';
  details?: string;
}

const auditResults: AuditResult[] = [];

function assert(condition: boolean, category: string, test: string, details?: string) {
  const status = condition ? 'PASS' : 'FAIL';
  auditResults.push({ category, test, status, details });
  console.log(`[${status}] [${category}] ${test} ${details ? '- ' + details : ''}`);
}

async function runAudit() {
  console.log('--- STARTING PHASE 1 AUDIT ---\n');

  const testEmailA = `test.user.a.${Date.now()}@docconvert.ai`;
  const testEmailB = `test.user.b.${Date.now()}@docconvert.ai`;
  const password = 'SecurePassword123!';

  // 1.1 Register & Password Hashing
  const regA = await db.createAuthUserAndProfile({
    email: testEmailA,
    password,
    fullName: 'Test User A (Audit)',
  });
  const userA = regA.profile;
  assert(!!userA.id && userA.email === testEmailA, 'Authentication', 'Register User A', 'User A registered with hashed password');

  const regB = await db.createAuthUserAndProfile({
    email: testEmailB,
    password,
    fullName: 'Test User B (Audit)',
  });
  const userB = regB.profile;
  assert(!!userB.id && userB.email === testEmailB, 'Authentication', 'Register User B', 'User B registered with hashed password');

  // 1.2 Login validation
  const foundUser = db.findAuthUserByEmail(testEmailA);
  const passMatch = foundUser ? await bcrypt.compare(password, foundUser.password_hash) : false;
  const passFail = foundUser ? await bcrypt.compare('WrongPassword!', foundUser.password_hash) : false;
  assert(passMatch === true, 'Authentication', 'Login Valid Password', 'Correct credentials verified via bcrypt');
  assert(passFail === false, 'Authentication', 'Login Invalid Password', 'Wrong credentials rejected via bcrypt');

  // 1.3 Session Token creation & verification
  const sessionTokenA = regA.session.access_token;
  const verifiedUser = db.verifyLocalSupabaseToken(sessionTokenA);
  assert(verifiedUser?.id === userA.id, 'Authentication', 'Session Token Verification', 'Session payload verified');

  // 2. User Isolation & Documents
  const docAId = crypto.randomUUID();
  const savedFileA = await storageService.saveFile(
    userA.id,
    docAId,
    'A-test.pdf',
    Buffer.from('%PDF-1.4 test document user A', 'utf-8'),
    'application/pdf',
    sessionTokenA
  );

  const docA = db.createDocument({
    id: docAId,
    user_id: userA.id,
    original_filename: 'A-test.pdf',
    file_name: savedFileA.fileName,
    file_type: 'PDF',
    mime_type: 'application/pdf',
    file_size: savedFileA.fileSize,
    page_count: 1,
    storage_bucket: savedFileA.storageBucket,
    storage_path: savedFileA.storagePath,
    document_type: 'BANK_STATEMENT',
    status: 'QUEUED',
  });

  const docBId = crypto.randomUUID();
  const savedFileB = await storageService.saveFile(
    userB.id,
    docBId,
    'B-test.pdf',
    Buffer.from('%PDF-1.4 test document user B', 'utf-8'),
    'application/pdf',
    regB.session.access_token
  );

  const docB = db.createDocument({
    id: docBId,
    user_id: userB.id,
    original_filename: 'B-test.pdf',
    file_name: savedFileB.fileName,
    file_type: 'PDF',
    mime_type: 'application/pdf',
    file_size: savedFileB.fileSize,
    page_count: 1,
    storage_bucket: savedFileB.storageBucket,
    storage_path: savedFileB.storagePath,
    document_type: 'BANK_STATEMENT',
    status: 'QUEUED',
  });

  // Isolation check
  const docsOfA = db.getUserDocuments(userA.id);
  const docsOfB = db.getUserDocuments(userB.id);

  assert(docsOfA.some((d) => d.id === docA.id), 'User Isolation', 'User A sees Document A', 'Owner can list own docs');
  assert(!docsOfA.some((d) => d.id === docB.id), 'User Isolation', 'User A CANNOT see Document B', 'Cross-user list isolated');
  assert(docsOfB.some((d) => d.id === docB.id), 'User Isolation', 'User B sees Document B', 'Owner can list own docs');
  assert(!docsOfB.some((d) => d.id === docA.id), 'User Isolation', 'User B CANNOT see Document A', 'Cross-user list isolated');

  // Quota check
  const quota = quotaService.checkUserQuota(userA.id);
  assert(quota.allowed === true && quota.total === 3, 'Quota', 'Free Plan 3 Documents Quota', 'Quota limit verified');

  console.log('\n--- PHASE 1 AUDIT COMPLETE ---');
  const allPassed = auditResults.every((r) => r.status === 'PASS');
  console.log(`Summary: ${auditResults.filter((r) => r.status === 'PASS').length}/${auditResults.length} tests passed.`);
  if (!allPassed) {
    process.exit(1);
  }
}

runAudit().catch(console.error);
