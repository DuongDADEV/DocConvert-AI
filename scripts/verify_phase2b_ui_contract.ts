import 'dotenv/config';
import { db } from '../server/db/db.js';

// Replicate frontend presentation logic from OcrReviewWorkspace.tsx
const SEMANTIC_VI_LABELS: Record<string, string> = {
  ACCOUNT_HOLDER: 'Chủ tài khoản',
  ACCOUNT_NUMBER: 'Số tài khoản',
  CUSTOMER_ID: 'Mã khách hàng',
  TAX_CODE: 'Mã số thuế / CIF',
  CURRENCY: 'Loại tiền',
  ACCOUNT_TYPE: 'Loại tài khoản',
  BRANCH: 'Chi nhánh',
  ADDRESS: 'Địa chỉ',
  STATEMENT_DATE: 'Ngày sao kê',
  STATEMENT_FROM: 'Từ ngày',
  STATEMENT_TO: 'Đến ngày',
};

const CORE_PRIORITY_ORDER: Record<string, number> = {
  ACCOUNT_HOLDER: 1,
  ACCOUNT_NUMBER: 2,
  CUSTOMER_ID: 3,
  TAX_CODE: 4,
  STATEMENT_PERIOD: 5,
  STATEMENT_FROM: 5,
  STATEMENT_TO: 5,
  CURRENCY: 6,
  ACCOUNT_TYPE: 7,
  BRANCH: 8,
  ADDRESS: 9,
  STATEMENT_DATE: 10,
};

function processMetadataForUI(metadataItems: any[]) {
  const rawCore = metadataItems.filter((m) => m.visibilityClass === 'CORE');
  const additional = metadataItems.filter((m) => m.visibilityClass === 'ADDITIONAL');

  const stmtFrom = rawCore.find((m) => m.semanticType === 'STATEMENT_FROM');
  const stmtTo = rawCore.find((m) => m.semanticType === 'STATEMENT_TO');

  const combinedList: any[] = [];

  if (stmtFrom && stmtTo) {
    const combinedPeriodItem = {
      label: 'Kỳ sao kê',
      value: `${stmtFrom.value} → ${stmtTo.value}`,
      confidence: Math.min(stmtFrom.confidence, stmtTo.confidence),
      semanticType: 'STATEMENT_PERIOD',
      sourcePage: stmtFrom.sourcePage,
      isCombined: true,
      status: stmtFrom.status === 'CONFLICT' || stmtTo.status === 'CONFLICT' ? 'CONFLICT' : 'AUTO',
    };

    for (const item of rawCore) {
      if (item.semanticType === 'STATEMENT_FROM' || item.semanticType === 'STATEMENT_TO') {
        continue;
      }
      combinedList.push({
        label: item.semanticType ? SEMANTIC_VI_LABELS[item.semanticType] || item.label : item.label,
        value: item.value,
        confidence: item.confidence,
        semanticType: item.semanticType,
        sourcePage: item.sourcePage,
        status: item.status,
      });
    }
    combinedList.push(combinedPeriodItem);
  } else {
    for (const item of rawCore) {
      combinedList.push({
        label: item.semanticType ? SEMANTIC_VI_LABELS[item.semanticType] || item.label : item.label,
        value: item.value,
        confidence: item.confidence,
        semanticType: item.semanticType,
        sourcePage: item.sourcePage,
        status: item.status,
      });
    }
  }

  combinedList.sort((a, b) => {
    const pA = a.semanticType ? CORE_PRIORITY_ORDER[a.semanticType] || 99 : 99;
    const pB = b.semanticType ? CORE_PRIORITY_ORDER[b.semanticType] || 99 : 99;
    return pA - pB;
  });

  return { coreDisplayItems: combinedList, additionalItems: additional };
}

async function verifyUIContract() {
  console.log('================================================================');
  console.log('PHASE 2B FRONTEND UI CONTRACT & REAL-DATA VERIFICATION');
  console.log('================================================================\n');

  const testDocs = [
    {
      name: 'HDBank (2 pages)',
      userId: '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c',
      docId: '80636c44-d41c-4a62-a502-a198d9d4fde3',
    },
    {
      name: 'Nam A Bank (4 pages)',
      userId: '27a10269-da23-4bfd-aa19-5ed66b974eff',
      docId: '82537093-4f56-4328-962d-de5237e7a9eb',
    },
  ];

  for (const doc of testDocs) {
    console.log(`\nTesting: ${doc.name} (docId: ${doc.docId})`);
    const ocrResult = await db.getDocumentOcrResult(doc.userId, doc.docId);
    if (!ocrResult) {
      console.log(`No OCR result found in DB for ${doc.name}`);
      continue;
    }

    const { documentMetadata } = ocrResult;
    console.log(`Total metadata records returned from API/DB: ${documentMetadata.length}`);

    // Verify 12 mandatory fields
    if (documentMetadata.length > 0) {
      const sample = documentMetadata[0];
      const requiredFields = [
        'id', 'label', 'value', 'rawLabel', 'rawValue', 'confidence',
        'qualityScore', 'semanticType', 'visibilityClass', 'occurrenceCount',
        'status', 'sourcePage'
      ];
      const missing = requiredFields.filter((f) => !(f in sample));
      console.log(`Required fields verification: ${missing.length === 0 ? '✅ ALL 12 PRESENT' : `❌ MISSING: ${missing.join(', ')}`}`);
    }

    const { coreDisplayItems, additionalItems } = processMetadataForUI(documentMetadata);

    console.log(`\n  📌 CORE Display Grid (${coreDisplayItems.length} cards):`);
    coreDisplayItems.forEach((item: any, idx: number) => {
      console.log(`    [${idx + 1}] ${item.label.padEnd(18)} : "${item.value}" (conf: ${(item.confidence * 100).toFixed(1)}%, sem: ${item.semanticType || 'OTHER'})`);
    });

    console.log(`\n  📂 Collapsible "Thông tin khác (${additionalItems.length})" items:`);
    additionalItems.slice(0, 5).forEach((item: any, idx: number) => {
      console.log(`    [${idx + 1}] ${(item.label || item.rawLabel).padEnd(25)} : "${item.value}" (P${item.sourcePage})`);
    });
    if (additionalItems.length > 5) {
      console.log(`    ... and ${additionalItems.length - 5} more additional items.`);
    }

    // Verify print timestamps are NOT in core
    const invalidPrintCore = coreDisplayItems.filter(
      (c: any) =>
        c.label.includes('In lúc') ||
        c.label.includes('Print time') ||
        c.label.includes('Printed at') ||
        c.label.includes('Printed on')
    );
    console.log(`  Print timestamp isolation check: ${invalidPrintCore.length === 0 ? '✅ CLEAN (0 print timestamps in CORE)' : `❌ FAILED: found ${invalidPrintCore.length}`}`);
  }
}

verifyUIContract().catch(console.error);
