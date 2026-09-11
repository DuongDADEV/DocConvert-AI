import 'dotenv/config';
import { db } from '../server/db/db.js';

async function verify() {
  console.log('===============================================================');
  console.log('VERIFYING OCR DOCUMENT STATUS SYNC');
  console.log('===============================================================\n');

  const userId = '27a10269-da23-4bfd-aa19-5ed66b974eff';
  const docs = await db.getUserDocuments(userId);

  console.log(`Total documents found for user: ${docs.length}`);
  docs.slice(0, 5).forEach((d) => {
    console.log(`- Document ID: ${d.id}`);
    console.log(`  File: ${d.file_name}`);
    console.log(`  Status: ${d.status}`);
    console.log(`  Created: ${d.created_at}`);
    console.log(`  Updated: ${d.updated_at}`);
  });

  const latestDoc = docs[0];
  const job = await db.getJobByDocumentId(userId, latestDoc.id);
  console.log(`\nLatest Document Job:`);
  console.log({
    jobId: job?.id,
    jobStatus: job?.status,
    jobProgress: job?.progress,
    startedAt: job?.started_at,
    completedAt: job?.completed_at,
    error: job?.error_code || job?.error_message,
  });

  // Verify DB Status consistency:
  const isConsistent = latestDoc.status === job?.status || (latestDoc.status === 'READY' && job?.status === 'READY');
  console.log(`\nDocument vs Job status match: ${isConsistent} (Doc: ${latestDoc.status}, Job: ${job?.status})`);

  // Verify status mapping in StatusBadge for all possible statuses:
  const testStatuses = [
    'QUEUED',
    'PENDING',
    'PROCESSING',
    'PARSING',
    'VALIDATING',
    'VALIDATING_RESULT',
    'UPLOADING',
    'REVIEW_REQUIRED',
    'READY',
    'COMPLETED',
    'FAILED',
    'UPLOADED',
  ];

  console.log('\nStatusBadge mapping verification:');
  testStatuses.forEach((st) => {
    const s = st.toUpperCase();
    let label = '';
    let hasSpinner = false;
    if (s === 'READY' || s === 'COMPLETED') {
      label = 'Đã hoàn tất';
    } else if (s === 'REVIEW_REQUIRED') {
      label = 'Cần kiểm tra';
    } else if (['PROCESSING', 'PARSING', 'VALIDATING', 'VALIDATING_RESULT', 'UPLOADING'].includes(s)) {
      label = 'Đang xử lý OCR';
      hasSpinner = true;
    } else if (s === 'QUEUED' || s === 'PENDING') {
      label = 'Đang chờ xử lý';
    } else if (s === 'FAILED') {
      label = 'Lỗi xử lý';
    } else {
      label = 'Đã tải lên';
    }
    console.log(`  [${st}] => Label: "${label}", Spinner: ${hasSpinner}`);
  });
}

verify().catch(console.error);
