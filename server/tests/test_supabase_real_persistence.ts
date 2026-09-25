import crypto from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { db } from '../db/db.js';
import { preflightService } from '../services/preflightService.js';
import { getSupabaseAdminClient } from '../services/supabaseClient.js';

async function runPersistenceTest() {
  console.log('================================================================');
  console.log('   RUNNING REAL SUPABASE DATABASE PERSISTENCE TEST');
  console.log('================================================================\n');

  const testUserId = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c'; // Medihub test user
  await db.ensureProfile(testUserId, 'medihub@test.com', 'CTY CP MEDIHUB');

  // Step 1: Create a 2-page native text PDF
  console.log('1. Generating 2-page PDF test buffer...');
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  // Page 1
  const page1 = pdfDoc.addPage([600, 800]);
  for (let i = 0; i < 20; i++) {
    page1.drawText(`Sao ke dong ${i + 1}: Chuyen khoan thanh toan hoa don dien nuoc 5,500,000 VND`, {
      x: 50,
      y: 750 - i * 25,
      size: 11,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
  }

  // Page 2
  const page2 = pdfDoc.addPage([600, 800]);
  for (let i = 0; i < 15; i++) {
    page2.drawText(`Trang 2 - Giao dich chuyen tien noi bo ngan hang Techcombank dong ${i + 1}`, {
      x: 50,
      y: 750 - i * 25,
      size: 11,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
  }

  const pdfBuffer = Buffer.from(await pdfDoc.save());

  // Step 2: Run Preflight Engine
  console.log('2. Running Preflight Engine analysis...');
  const preflightResult = await preflightService.analyzeDocument(pdfBuffer, 'application/pdf', 'supabase_persistence_test.pdf');
  console.log(`   Preflight complete: ${preflightResult.pageCount} pages, native: ${preflightResult.summary.nativeTextPages}`);

  // Step 3: Insert Document into Supabase (documents table)
  const docId = crypto.randomUUID();
  console.log(`3. Writing Document record to Supabase (id: ${docId})...`);
  const createdDoc = await db.createDocument({
    id: docId,
    user_id: testUserId,
    original_filename: 'supabase_persistence_test.pdf',
    file_name: 'supabase_persistence_test.pdf',
    file_type: 'PDF',
    file_size: pdfBuffer.length,
    status: 'WAITING_CONFIRMATION',
    output_type: 'EXCEL',
    page_count: preflightResult.pageCount,
    preflight_summary: preflightResult.summary,
  });

  console.log(`   Document created: status = ${createdDoc.status}, output_type = ${createdDoc.output_type}`);

  // Step 4: Insert document_pages into Supabase (document_pages table)
  console.log('4. Writing document_pages records to Supabase...');
  const pageRecords = preflightResult.pages.map((p) => ({
    id: crypto.randomUUID(),
    document_id: docId,
    page_number: p.pageNumber,
    classification: p.classification,
    classification_confidence: p.classificationConfidence,
    text_char_count: p.textCharCount,
    text_block_count: p.textBlockCount,
    text_coverage: p.textCoverage,
    image_count: p.imageCount,
    image_coverage: p.imageCoverage,
    has_full_page_image: p.hasFullPageImage,
    classification_reason: p.classificationReason,
  }));

  const savedPages = await db.createDocumentPages(pageRecords);
  console.log(`   Saved ${savedPages.length} rows to public.document_pages table.`);

  // Step 5: Direct Verification using raw Supabase Admin Client (Bypassing any potential memory state)
  console.log('\n5. Querying directly via raw Supabase Admin Client (database source of truth)...');
  const client = getSupabaseAdminClient();
  
  // Verify documents row in Supabase
  const { data: dbDoc, error: docErr } = await client
    .from('documents')
    .select('*')
    .eq('id', docId)
    .single();

  if (docErr || !dbDoc) {
    throw new Error(`Failed to find document in Supabase: ${docErr?.message}`);
  }

  console.log('   [PASS] Document row exists in PostgreSQL:');
  console.log(`          - id: ${dbDoc.id}`);
  console.log(`          - status: ${dbDoc.status}`);
  console.log(`          - output_type: ${dbDoc.output_type}`);
  console.log(`          - preflight_summary: ${JSON.stringify(dbDoc.preflight_summary)}`);

  if (dbDoc.status !== 'WAITING_CONFIRMATION') {
    throw new Error(`Expected status WAITING_CONFIRMATION, got: ${dbDoc.status}`);
  }
  if (dbDoc.output_type !== 'EXCEL') {
    throw new Error(`Expected output_type EXCEL, got: ${dbDoc.output_type}`);
  }
  if (!dbDoc.preflight_summary || dbDoc.preflight_summary.nativeTextPages !== 2) {
    throw new Error(`Unexpected preflight_summary: ${JSON.stringify(dbDoc.preflight_summary)}`);
  }

  // Verify document_pages rows in Supabase
  const { data: dbPages, error: pagesErr } = await client
    .from('document_pages')
    .select('*')
    .eq('document_id', docId)
    .order('page_number', { ascending: true });

  if (pagesErr || !dbPages) {
    throw new Error(`Failed to find document_pages in Supabase: ${pagesErr?.message}`);
  }

  console.log(`   [PASS] Found ${dbPages.length} document_pages rows in PostgreSQL:`);
  for (const page of dbPages) {
    console.log(`          - Page ${page.page_number}: classification=${page.classification}, conf=${page.classification_confidence}, chars=${page.text_char_count}, textCov=${page.text_coverage}`);
  }

  if (dbPages.length !== preflightResult.pageCount) {
    throw new Error(`Expected ${preflightResult.pageCount} pages, found ${dbPages.length} in database`);
  }

  // Step 6: Verify reading through db service (authoritative read)
  console.log('\n6. Verifying db.getDocumentPages(userId, docId)...');
  const servicePages = await db.getDocumentPages(testUserId, docId);
  if (servicePages.length !== 2) {
    throw new Error(`db.getDocumentPages returned ${servicePages.length} pages, expected 2`);
  }
  console.log('   [PASS] db.getDocumentPages successfully retrieved 2 persisted pages.');

  // Step 7: Clean up test document to keep database tidy
  console.log('\n7. Cleaning up test data...');
  await client.from('document_pages').delete().eq('document_id', docId);
  await client.from('documents').delete().eq('id', docId);
  console.log('   [PASS] Test data cleaned up safely.');

  console.log('\n================================================================');
  console.log('   PERSISTENCE TEST COMPLETED SUCCESSFULLY (100% PERSISTENT)');
  console.log('================================================================\n');
}

runPersistenceTest().catch((err) => {
  console.error('Persistence test failed:', err);
  process.exit(1);
});
