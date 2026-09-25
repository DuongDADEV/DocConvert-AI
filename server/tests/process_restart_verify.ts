import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { db } from '../db/db.js';
import { preflightService } from '../services/preflightService.js';
import { getSupabaseAdminClient } from '../services/supabaseClient.js';

const mode = process.argv[2]; // 'write' or 'read'
const docIdFile = path.resolve('scratch/persisted_doc_id.txt');
const testUserId = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c';

async function main() {
  if (mode === 'write') {
    console.log('=== PROCESS 1: INSERTING DATA INTO SUPABASE AND EXITING ===');
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const page = pdfDoc.addPage([600, 800]);
    page.drawText('Process Restart Verification: Dong sao ke ngan hang Techcombank 25,000,000 VND', {
      x: 50,
      y: 700,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    const pdfBuffer = Buffer.from(await pdfDoc.save());

    const preflight = await preflightService.analyzeDocument(pdfBuffer, 'application/pdf', 'restart_verify.pdf');
    const docId = crypto.randomUUID();

    await db.createDocument({
      id: docId,
      user_id: testUserId,
      original_filename: 'restart_verify.pdf',
      file_type: 'PDF',
      file_size: pdfBuffer.length,
      status: 'WAITING_CONFIRMATION',
      output_type: 'EXCEL',
      page_count: preflight.pageCount,
      preflight_summary: preflight.summary,
    });

    const pageRecords = preflight.pages.map((p) => ({
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

    await db.createDocumentPages(pageRecords);
    fs.mkdirSync(path.dirname(docIdFile), { recursive: true });
    fs.writeFileSync(docIdFile, docId, 'utf-8');
    console.log(`[PROCESS 1 DONE] Successfully wrote docId ${docId} to Supabase and saved to file.`);
    process.exit(0);
  } else if (mode === 'read') {
    console.log('=== PROCESS 2 (NEW PROCESS): READING DATA FROM SUPABASE ===');
    if (!fs.existsSync(docIdFile)) {
      throw new Error(`File ${docIdFile} not found.`);
    }
    const docId = fs.readFileSync(docIdFile, 'utf-8').trim();
    console.log(`Verifying docId: ${docId} in fresh Node.js process (no memory state)...`);

    const doc = await db.getUserDocumentById(testUserId, docId);
    if (!doc) {
      throw new Error(`Document ${docId} was NOT found in Supabase!`);
    }
    console.log(`[PASS] Document retrieved from Supabase: status=${doc.status}, output_type=${doc.output_type}`);

    const pages = await db.getDocumentPages(testUserId, docId);
    if (!pages || pages.length === 0) {
      throw new Error(`Document pages for ${docId} were NOT found in Supabase!`);
    }
    console.log(`[PASS] ${pages.length} document_pages retrieved from Supabase:`);
    for (const p of pages) {
      console.log(`       - Page ${p.page_number}: ${p.classification} (confidence: ${p.classification_confidence})`);
    }

    // Clean up
    const client = getSupabaseAdminClient();
    await client.from('document_pages').delete().eq('document_id', docId);
    await client.from('documents').delete().eq('id', docId);
    fs.unlinkSync(docIdFile);
    console.log('[PASS] Cleanup complete. Verification succeeded across process restart!');
  } else {
    console.error('Usage: tsx process_restart_verify.ts <write|read>');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
