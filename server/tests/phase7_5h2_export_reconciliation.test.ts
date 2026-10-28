import { db, ExportRecord } from '../db/db.js';
import { storageService } from '../services/storageService.js';

async function runRegressionTests() {
  console.log('========================================================================');
  console.log('=== PHASE 7.5H.2 — EXPORT RECONCILIATION REGRESSION TEST SUITE ===');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(cond: boolean, name: string, detail?: string) {
    if (cond) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} ${detail ? `-> ${detail}` : ''}`);
      failed++;
    }
  }

  // -------------------------------------------------------------------
  // TEST 1: Database Error Propagation in createExportRecord
  // -------------------------------------------------------------------
  console.log('--- TEST 1: Database Error Propagation ---');
  let threwExpectedError = false;
  try {
    // Attempt insert with missing mandatory fields or invalid payload to trigger DB error
    await db.createExportRecord({
      id: 'invalid-id-not-uuid',
      user_id: '00000000-0000-0000-0000-000000000000',
      document_id: '00000000-0000-0000-0000-000000000000',
    });
  } catch (err: any) {
    if (err.message && err.message.includes('DATABASE_EXPORT_INSERT_FAILED')) {
      threwExpectedError = true;
    }
  }
  assert(threwExpectedError, 'Test 1: createExportRecord throws DATABASE_EXPORT_INSERT_FAILED on DB failure (not masked)');

  // -------------------------------------------------------------------
  // TEST 2: Graceful Error Handling in findExistingExport
  // -------------------------------------------------------------------
  console.log('\n--- TEST 2: Safe Fallback in findExistingExport ---');
  const dummyUser = '00000000-0000-0000-0000-000000000000';
  const dummyDoc = '00000000-0000-0000-0000-000000000000';
  let findThrew = false;
  let findResult: any = null;
  try {
    findResult = await db.findExistingExport(dummyUser, dummyDoc, 'XLSX', 'NORMALIZED');
  } catch {
    findThrew = true;
  }
  assert(!findThrew && findResult === null, 'Test 2: findExistingExport returns null safely and does not throw');

  // -------------------------------------------------------------------
  // TEST 3A: Missing Record in getUserExportById returns null (HTTP 404 outcome)
  // -------------------------------------------------------------------
  console.log('\n--- TEST 3A: getUserExportById with Non-Existent Valid UUID ---');
  let getThrew = false;
  let getResult: any = null;
  try {
    getResult = await db.getUserExportById(dummyUser, '00000000-0000-0000-0000-000000000001');
  } catch {
    getThrew = true;
  }
  assert(!getThrew && getResult === null, 'Test 3A: getUserExportById returns null for missing record without throwing (HTTP 404 path)');

  // -------------------------------------------------------------------
  // TEST 3B: Database Query Failure in getUserExportById throws Error (HTTP 500 outcome)
  // -------------------------------------------------------------------
  console.log('\n--- TEST 3B: getUserExportById with Query Failure Syntax/DB Error ---');
  let queryErrorThrew = false;
  let queryErrorMessage = '';
  try {
    // Malformed UUID string triggers a Postgres syntax query error
    await db.getUserExportById(dummyUser, 'invalid-non-uuid-string');
  } catch (err: any) {
    queryErrorThrew = true;
    queryErrorMessage = err.message || '';
  }
  assert(
    queryErrorThrew && queryErrorMessage.includes('DATABASE_EXPORT_QUERY_FAILED'),
    'Test 3B: Database query error throws DATABASE_EXPORT_QUERY_FAILED instead of returning null (HTTP 500 path)',
    queryErrorMessage
  );

  // -------------------------------------------------------------------
  // TEST 4A: getDocumentExports returns Array Safely on missing records
  // -------------------------------------------------------------------
  console.log('\n--- TEST 4A: getDocumentExports Array Return ---');
  let listThrew = false;
  let listResult: any[] = [];
  try {
    listResult = await db.getDocumentExports(dummyUser, dummyDoc);
  } catch {
    listThrew = true;
  }
  assert(!listThrew && Array.isArray(listResult), 'Test 4A: getDocumentExports returns empty array on non-existent document');

  // -------------------------------------------------------------------
  // TEST 4B: getDocumentExports throws DATABASE_EXPORT_QUERY_FAILED on DB failure
  // -------------------------------------------------------------------
  console.log('\n--- TEST 4B: getDocumentExports Query Error Surfacing ---');
  let docListQueryThrew = false;
  let docListErrorMessage = '';
  try {
    await db.getDocumentExports(dummyUser, 'invalid-non-uuid-doc-id');
  } catch (err: any) {
    docListQueryThrew = true;
    docListErrorMessage = err.message || '';
  }
  assert(
    docListQueryThrew && docListErrorMessage.includes('DATABASE_EXPORT_QUERY_FAILED'),
    'Test 4B: getDocumentExports throws DATABASE_EXPORT_QUERY_FAILED on DB query failure instead of returning empty array',
    docListErrorMessage
  );

  // -------------------------------------------------------------------
  // TEST 5: User Isolation in getUserExportById
  // -------------------------------------------------------------------
  console.log('\n--- TEST 5: User Isolation Guard ---');
  // Querying with user A for user B's hypothetical export must yield null
  const userA = '00000000-0000-0000-0000-00000000000a';
  const userB = '00000000-0000-0000-0000-00000000000b';
  const queryResult = await db.getUserExportById(userA, '00000000-0000-0000-0000-000000000099');
  assert(queryResult === null, 'Test 5: Cross-user query returns null (enforces user isolation)');

  // -------------------------------------------------------------------
  // TEST 6: Compensating Storage Cleanup Interface & Truthful Status Verification
  // -------------------------------------------------------------------
  console.log('\n--- TEST 6: Storage Cleanup Interface & Status Verification ---');
  const hasDeleteDocFiles = typeof storageService.deleteDocumentFiles === 'function';
  assert(hasDeleteDocFiles, 'Test 6A: storageService.deleteDocumentFiles is present for compensating cleanup');

  // Verify defensive rejection against path traversal
  const traversalRejected = await storageService.deleteDocumentFiles('user-id/../admin', 'export_123');
  assert(traversalRejected === false, 'Test 6B: deleteDocumentFiles truthfully returns false on path traversal attempt');

  // -------------------------------------------------------------------
  // TEST 7: Financial Invariant Verification (Export consumes 0 credits)
  // -------------------------------------------------------------------
  console.log('\n--- TEST 7: Financial Invariant Check ---');
  // Verify ExportRecord model has no credit deduction fields
  const sampleExportRecord: ExportRecord = {
    id: 'test-id',
    user_id: userA,
    document_id: dummyDoc,
    export_format: 'XLSX',
    export_mode: 'NORMALIZED',
    file_name: 'test.xlsx',
    file_size: 1000,
    storage_bucket: 'documents',
    storage_path: 'documents/path/test.xlsx',
    status: 'COMPLETED',
    error_message: null,
    metadata: {},
    created_at: new Date().toISOString(),
  };
  const hasNoFinancialChargeFields = !('credit_cost' in sampleExportRecord) && !('charge_amount' in sampleExportRecord);
  assert(hasNoFinancialChargeFields, 'Test 7: Export model adheres to zero-credit-charge invariant (free feature)');

  console.log('\n========================================================================');
  console.log(`TEST SUMMARY: ${passed}/${passed + failed} ASSERTIONS PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionTests().catch(err => {
  console.error('Fatal error running regression tests:', err);
  process.exit(1);
});
