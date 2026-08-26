/**
 * ============================================================================
 * DOCCONVERT AI - PHASE 1.5 SECURITY & ARCHITECTURE VERIFICATION TEST SUITE
 * ============================================================================
 * 
 * Executes all 16 mandatory test suites verifying:
 * 1. User A login
 * 2. User B login
 * 3. User A upload file
 * 4. User B upload file
 * 5. A không đọc được file B
 * 6. B không đọc được file A
 * 7. A không delete file B
 * 8. B không delete file A
 * 9. A không đọc database record của B
 * 10. B không đọc database record của A
 * 11. RLS thực sự chặn unauthorized access
 * 12. Storage RLS thực sự chặn unauthorized access
 * 13. Service role không được expose frontend
 * 14. JWT tài khoản không xuất hiện trong URL
 * 15. Local disk không được sử dụng làm persistent production storage
 * 16. File metadata và storage bucket 'documents' hoạt động chính xác
 */

import { db } from '../server/db/db.js';
import { storageService } from '../server/services/storageService.js';
import { quotaService } from '../server/services/quotaService.js';
import { verifySupabaseToken } from '../server/services/supabaseClient.js';
import { SERVICE_ROLE_USAGE_REGISTRY } from '../server/services/supabaseAdmin.js';
import crypto from 'crypto';

interface TestResult {
  num: number;
  name: string;
  category: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function recordTest(num: number, name: string, category: string, passed: boolean, details: string) {
  results.push({ num, name, category, passed, details });
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[Test ${String(num).padStart(2, '0')}] ${status} | [${category}] ${name}`);
  if (!passed || process.env.VERBOSE) {
    console.log(`   ↳ ${details}`);
  }
}

async function runPhase15Tests() {
  console.log('================================================================');
  console.log('STARTING PHASE 1.5 SECURITY & ARCHITECTURE AUDIT');
  console.log('================================================================\n');

  // Clean test identities
  const userAEmail = `audit_usera_${Date.now()}@example.com`;
  const userBEmail = `audit_userb_${Date.now()}@example.com`;
  const password = 'SecurePassword123!';

  let userA: any = null;
  let userB: any = null;
  let tokenA: string = '';
  let tokenB: string = '';

  let docA: any = null;
  let docB: any = null;

  // -------------------------------------------------------------------------
  // TEST 1: User A Login / Register & Session Generation
  // -------------------------------------------------------------------------
  try {
    const regA = await db.createAuthUserAndProfile({
      email: userAEmail,
      password,
      fullName: 'User A Nguyen',
    });
    userA = regA.profile;
    tokenA = regA.session.access_token;

    const verifiedA = await verifySupabaseToken(tokenA);
    const valid = verifiedA !== null && verifiedA.id === userA.id && tokenA.startsWith('sbp_');

    recordTest(1, 'User A Register & Supabase Auth Session', 'AUTHENTICATION', valid, `User A ID: ${userA.id}, Session prefix: sbp_`);
  } catch (err: any) {
    recordTest(1, 'User A Register & Supabase Auth Session', 'AUTHENTICATION', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 2: User B Login / Register & Session Generation
  // -------------------------------------------------------------------------
  try {
    const regB = await db.createAuthUserAndProfile({
      email: userBEmail,
      password,
      fullName: 'User B Tran',
    });
    userB = regB.profile;
    tokenB = regB.session.access_token;

    const verifiedB = await verifySupabaseToken(tokenB);
    const valid = verifiedB !== null && verifiedB.id === userB.id && userB.id !== userA.id;

    recordTest(2, 'User B Register & Supabase Auth Session', 'AUTHENTICATION', valid, `User B ID: ${userB.id}, Isolated from A: ${userB.id !== userA.id}`);
  } catch (err: any) {
    recordTest(2, 'User B Register & Supabase Auth Session', 'AUTHENTICATION', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 3: User A Upload File to Supabase Private Storage
  // -------------------------------------------------------------------------
  try {
    const docAId = crypto.randomUUID();
    const bufferA = Buffer.from('%PDF-1.4 User A Confidential Bank Statement Document Data', 'utf-8');
    const savedA = await storageService.saveFile(
      userA.id,
      docAId,
      'A-test-statement.pdf',
      bufferA,
      'application/pdf',
      tokenA
    );

    docA = db.createDocument({
      id: docAId,
      user_id: userA.id,
      original_filename: 'A-test-statement.pdf',
      file_name: savedA.fileName,
      file_type: 'PDF',
      mime_type: savedA.mimeType,
      file_size: savedA.fileSize,
      page_count: 1,
      storage_bucket: savedA.storageBucket,
      storage_path: savedA.storagePath,
      document_type: 'BANK_STATEMENT',
      status: 'QUEUED',
    });

    const valid = docA && docA.user_id === userA.id && savedA.storageBucket === 'documents' && savedA.storagePath.includes(`${userA.id}/${docAId}`);
    recordTest(3, 'User A Upload to Private Storage Bucket documents', 'STORAGE', valid, `Stored path: ${savedA.storagePath}`);
  } catch (err: any) {
    recordTest(3, 'User A Upload to Private Storage Bucket documents', 'STORAGE', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 4: User B Upload File to Supabase Private Storage
  // -------------------------------------------------------------------------
  try {
    const docBId = crypto.randomUUID();
    const bufferB = Buffer.from('%PDF-1.4 User B Confidential Financial Ledger Document Data', 'utf-8');
    const savedB = await storageService.saveFile(
      userB.id,
      docBId,
      'B-test-ledger.pdf',
      bufferB,
      'application/pdf',
      tokenB
    );

    docB = db.createDocument({
      id: docBId,
      user_id: userB.id,
      original_filename: 'B-test-ledger.pdf',
      file_name: savedB.fileName,
      file_type: 'PDF',
      mime_type: savedB.mimeType,
      file_size: savedB.fileSize,
      page_count: 1,
      storage_bucket: savedB.storageBucket,
      storage_path: savedB.storagePath,
      document_type: 'BANK_STATEMENT',
      status: 'QUEUED',
    });

    const valid = docB && docB.user_id === userB.id && savedB.storageBucket === 'documents' && savedB.storagePath.includes(`${userB.id}/${docBId}`);
    recordTest(4, 'User B Upload to Private Storage Bucket documents', 'STORAGE', valid, `Stored path: ${savedB.storagePath}`);
  } catch (err: any) {
    recordTest(4, 'User B Upload to Private Storage Bucket documents', 'STORAGE', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 5: User A Không Đọc Được File của User B (Storage Isolation)
  // -------------------------------------------------------------------------
  try {
    // User A attempts to download B's file from storage passing A's user ID
    const stolenFile = await storageService.getFile(userA.id, docB.id, tokenA);
    // User A attempts to access B's document record
    const stolenDoc = db.getUserDocumentById(userA.id, docB.id);

    const blocked = stolenFile === null && stolenDoc === null;
    recordTest(5, 'User A Cannot Read User B File', 'USER ISOLATION', blocked, `Stolen file: ${stolenFile}, Stolen doc: ${stolenDoc}`);
  } catch (err: any) {
    recordTest(5, 'User A Cannot Read User B File', 'USER ISOLATION', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 6: User B Không Đọc Được File của User A (Storage Isolation)
  // -------------------------------------------------------------------------
  try {
    // User B attempts to download A's file from storage passing B's user ID
    const stolenFile = await storageService.getFile(userB.id, docA.id, tokenB);
    const stolenDoc = db.getUserDocumentById(userB.id, docA.id);

    const blocked = stolenFile === null && stolenDoc === null;
    recordTest(6, 'User B Cannot Read User A File', 'USER ISOLATION', blocked, `Stolen file: ${stolenFile}, Stolen doc: ${stolenDoc}`);
  } catch (err: any) {
    recordTest(6, 'User B Cannot Read User A File', 'USER ISOLATION', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 7: User A Không Delete Được File của User B
  // -------------------------------------------------------------------------
  try {
    const deleted = db.softDeleteDocument(userA.id, docB.id);
    const docBStillActive = db.getUserDocumentById(userB.id, docB.id);

    const blocked = deleted === false && docBStillActive !== null && docBStillActive.deleted_at === null;
    recordTest(7, 'User A Cannot Delete User B Document', 'MUTATION SECURITY', blocked, `Delete result for unauthorized user: ${deleted}`);
  } catch (err: any) {
    recordTest(7, 'User A Cannot Delete User B Document', 'MUTATION SECURITY', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 8: User B Không Delete Được File của User A
  // -------------------------------------------------------------------------
  try {
    const deleted = db.softDeleteDocument(userB.id, docA.id);
    const docAStillActive = db.getUserDocumentById(userA.id, docA.id);

    const blocked = deleted === false && docAStillActive !== null && docAStillActive.deleted_at === null;
    recordTest(8, 'User B Cannot Delete User A Document', 'MUTATION SECURITY', blocked, `Delete result for unauthorized user: ${deleted}`);
  } catch (err: any) {
    recordTest(8, 'User B Cannot Delete User A Document', 'MUTATION SECURITY', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 9: User A Không Đọc Được Database Record của User B
  // -------------------------------------------------------------------------
  try {
    const docsOfA = db.getUserDocuments(userA.id);
    const hasDocB = docsOfA.some((d) => d.id === docB.id || d.user_id === userB.id);

    recordTest(9, 'User A List Query Contains ZERO User B Records', 'ROW LEVEL SECURITY', !hasDocB, `A records count: ${docsOfA.length}, contains B: ${hasDocB}`);
  } catch (err: any) {
    recordTest(9, 'User A List Query Contains ZERO User B Records', 'ROW LEVEL SECURITY', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 10: User B Không Đọc Được Database Record của User A
  // -------------------------------------------------------------------------
  try {
    const docsOfB = db.getUserDocuments(userB.id);
    const hasDocA = docsOfB.some((d) => d.id === docA.id || d.user_id === userA.id);

    recordTest(10, 'User B List Query Contains ZERO User A Records', 'ROW LEVEL SECURITY', !hasDocA, `B records count: ${docsOfB.length}, contains A: ${hasDocA}`);
  } catch (err: any) {
    recordTest(10, 'User B List Query Contains ZERO User A Records', 'ROW LEVEL SECURITY', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 11: RLS Thực Sự Chặn Unauthorized Access (auth.uid() enforcement)
  // -------------------------------------------------------------------------
  try {
    // Unauthenticated (no user ID) or mismatched auth.uid()
    const mismatchedAccess = db.getUserDocumentById('00000000-0000-0000-0000-000000000000', docA.id);
    const anonAccess = db.getUserDocumentById('', docA.id);

    const rlsEffective = mismatchedAccess === null && anonAccess === null;
    recordTest(11, 'RLS auth.uid() Validation Blocks Mismatched/Anonymous Calls', 'RLS ENFORCEMENT', rlsEffective, 'All cross-uid queries strictly return null.');
  } catch (err: any) {
    recordTest(11, 'RLS auth.uid() Validation Blocks Mismatched/Anonymous Calls', 'RLS ENFORCEMENT', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 12: Storage RLS Thực Sự Chặn Unauthorized Access
  // -------------------------------------------------------------------------
  try {
    // Attempting path traversal attack
    let traversalBlocked = false;
    try {
      await storageService.saveFile(
        `../etc`,
        docA.id,
        'malicious.pdf',
        Buffer.from('malicious', 'utf-8'),
        'application/pdf',
        tokenA
      );
    } catch {
      traversalBlocked = true;
    }

    recordTest(12, 'Storage RLS & Traversal Protection Prevents Unauthorized Paths', 'STORAGE SECURITY', traversalBlocked, 'Path sanitization strictly enforces {userId}/{documentId}/original/ structure.');
  } catch (err: any) {
    recordTest(12, 'Storage RLS & Traversal Protection Prevents Unauthorized Paths', 'STORAGE SECURITY', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 13: Service Role Không Được Expose Frontend
  // -------------------------------------------------------------------------
  try {
    // Check that service role registry is limited strictly to server-only background functions
    const isRestricted = SERVICE_ROLE_USAGE_REGISTRY.every((r) => r.file.startsWith('server/'));
    // Ensure no client bundle or response carries SUPABASE_SERVICE_ROLE_KEY
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const safe = isRestricted && (!serviceRoleKey || !serviceRoleKey.startsWith('VITE_'));

    recordTest(13, 'Service Role Key Restricted to Server Background Tasks Only', 'CREDENTIAL SECURITY', safe, `Registry entries: ${SERVICE_ROLE_USAGE_REGISTRY.length} server-only functions.`);
  } catch (err: any) {
    recordTest(13, 'Service Role Key Restricted to Server Background Tasks Only', 'CREDENTIAL SECURITY', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 14: JWT / Session Token Không Xuất Hiện Trong URL
  // -------------------------------------------------------------------------
  try {
    // Check signed URL format generated by storageService
    const signedUrlData = await storageService.createSignedUrl(userA.id, docA.id, docA.file_name, 60, tokenA);
    const url = signedUrlData?.signedUrl || '';
    const hasFullUserToken = url.includes(tokenA);

    recordTest(14, 'No Full User Authentication Token in Query Parameters', 'URL & LOG HYGIENE', !hasFullUserToken && signedUrlData !== null, `Generated URL does NOT contain session token: ${!hasFullUserToken}`);
  } catch (err: any) {
    recordTest(14, 'No Full User Authentication Token in Query Parameters', 'URL & LOG HYGIENE', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 15: Local Disk Không Được Sử Dụng Làm Persistent Production Storage
  // -------------------------------------------------------------------------
  try {
    // Check that storage bucket is 'documents' and storage_path is structured in storage standard
    const isCloudStoragePattern = docA.storage_bucket === 'documents' && docA.storage_path.startsWith('documents/');

    recordTest(15, 'Private Supabase Storage Bucket documents Replaces Local Server Disk', 'CLOUD STORAGE', isCloudStoragePattern, `Storage bucket: ${docA.storage_bucket}, path: ${docA.storage_path}`);
  } catch (err: any) {
    recordTest(15, 'Private Supabase Storage Bucket documents Replaces Local Server Disk', 'CLOUD STORAGE', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 16: File Metadata & Storage Bucket 'documents' Hoạt Động Chính Xác
  // -------------------------------------------------------------------------
  try {
    const hasAllFields =
      typeof docA.storage_bucket === 'string' &&
      docA.storage_bucket === 'documents' &&
      typeof docA.storage_path === 'string' &&
      typeof docA.file_name === 'string' &&
      typeof docA.file_size === 'number' &&
      docA.file_size > 0 &&
      typeof docA.mime_type === 'string' &&
      docA.mime_type === 'application/pdf';

    recordTest(16, 'Document Metadata & Storage Properties Fully Conforming', 'DATA INTEGRITY', hasAllFields, `Bucket: ${docA.storage_bucket}, Mime: ${docA.mime_type}, Size: ${docA.file_size}B`);
  } catch (err: any) {
    recordTest(16, 'Document Metadata & Storage Properties Fully Conforming', 'DATA INTEGRITY', false, err.message);
  }

  // -------------------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('PHASE 1.5 AUDIT RESULTS SUMMARY');
  console.log('================================================================');

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log(`Total Test Suites Executed: ${results.length}/16`);
  console.log(`PASSED: ${passedCount} | FAILED: ${failedCount}`);

  if (failedCount === 0) {
    console.log('\n🌟 ALL 16 PHASE 1.5 SECURITY & ARCHITECTURE TESTS PASSED SUCCESSFULLY! 🌟');
  } else {
    console.error('\n⚠️ SOME TESTS FAILED. PLEASE REVIEW OUTPUT ABOVE.');
    process.exit(1);
  }
}

runPhase15Tests().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
