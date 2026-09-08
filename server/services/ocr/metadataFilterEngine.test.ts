import { MetadataFilterEngine } from './metadataFilterEngine.js';
import { OCRMetadataObservation, OCRExtractedTable, OCRPage } from './types.js';

function runUnitTests() {
  console.log('======================================================================');
  console.log('PHASE 2A.1 METADATA FILTER ENGINE UNIT TESTS (12 MANDATORY TEST CASES)');
  console.log('======================================================================\n');

  let passedCount = 0;
  let totalTests = 0;

  function assertTest(condition: boolean, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
      console.log(`✅ [PASS] Test #${totalTests}: ${testName}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] Test #${totalTests}: ${testName}${detail ? ` -> ${detail}` : ''}`);
    }
  }

  // --- Test Case 1: "Từ ngày(from)" & "Tu ngay" same value -> STATEMENT_FROM -> merge ---
  const obs1: OCRMetadataObservation[] = [
    { rawLabel: 'Từ ngày(from)', rawValue: '01/05/2024', confidence: 0.99, sourcePage: 1 },
    { rawLabel: 'Tu ngay', rawValue: '01/05/2024', confidence: 0.96, sourcePage: 2 },
  ];
  const res1 = MetadataFilterEngine.processObservations(obs1);
  assertTest(
    res1.canonicalMetadata.length === 1 &&
      res1.canonicalMetadata[0].semanticType === 'STATEMENT_FROM' &&
      res1.canonicalMetadata[0].status === 'AUTO' &&
      res1.canonicalMetadata[0].occurrenceCount === 2,
    '"Từ ngày(from)" + "Tu ngay" with same value resolves to STATEMENT_FROM and auto-merges'
  );

  // --- Test Case 2: "đến ngày(to)" -> STATEMENT_TO ---
  const obs2: OCRMetadataObservation[] = [
    { rawLabel: 'đến ngày(to):', rawValue: '31/10/2024', confidence: 0.98, sourcePage: 1 },
  ];
  const res2 = MetadataFilterEngine.processObservations(obs2);
  assertTest(
    res2.canonicalMetadata.length === 1 &&
      res2.canonicalMetadata[0].semanticType === 'STATEMENT_TO' &&
      res2.canonicalMetadata[0].value === '31/10/2024',
    '"đến ngày(to)" resolves cleanly to STATEMENT_TO'
  );

  // --- Test Case 3: "Account No." & "Số tài khoản" -> ACCOUNT_NUMBER ---
  const obs3: OCRMetadataObservation[] = [
    { rawLabel: 'Account No.', rawValue: '051704070011450', confidence: 0.99, sourcePage: 1 },
    { rawLabel: 'Số tài khoản:', rawValue: '051704070011450', confidence: 0.97, sourcePage: 2 },
  ];
  const res3 = MetadataFilterEngine.processObservations(obs3);
  assertTest(
    res3.canonicalMetadata.length === 1 &&
      res3.canonicalMetadata[0].semanticType === 'ACCOUNT_NUMBER' &&
      res3.canonicalMetadata[0].value === '051704070011450',
    '"Account No." and "Số tài khoản" resolve to ACCOUNT_NUMBER and merge'
  );

  // --- Test Case 4: "Customer name" & "Tên khách hàng" -> ACCOUNT_HOLDER ---
  const obs4: OCRMetadataObservation[] = [
    { rawLabel: 'Customer name', rawValue: 'NGUYEN THI TUYET LAN', confidence: 0.98, sourcePage: 1 },
    { rawLabel: 'Tên khách hàng:', rawValue: 'NGUYEN THI TUYET LAN', confidence: 0.97, sourcePage: 2 },
  ];
  const res4 = MetadataFilterEngine.processObservations(obs4);
  assertTest(
    res4.canonicalMetadata.length === 1 &&
      res4.canonicalMetadata[0].semanticType === 'ACCOUNT_HOLDER' &&
      res4.canonicalMetadata[0].value === 'NGUYEN THI TUYET LAN',
    '"Customer name" and "Tên khách hàng" resolve to ACCOUNT_HOLDER and merge'
  );

  // --- Test Case 5: "Currency" & "Loại tiền" -> CURRENCY ---
  const obs5: OCRMetadataObservation[] = [
    { rawLabel: 'Currency', rawValue: 'VND', confidence: 0.99, sourcePage: 1 },
    { rawLabel: 'Loại tiền:', rawValue: 'VND', confidence: 0.95, sourcePage: 2 },
  ];
  const res5 = MetadataFilterEngine.processObservations(obs5);
  assertTest(
    res5.canonicalMetadata.length === 1 &&
      res5.canonicalMetadata[0].semanticType === 'CURRENCY' &&
      res5.canonicalMetadata[0].value === 'VND',
    '"Currency" and "Loại tiền" resolve to CURRENCY and merge'
  );

  // --- Test Case 6: "Tax code" & "Mã số thuế" -> TAX_CODE ---
  const obs6: OCRMetadataObservation[] = [
    { rawLabel: 'Tax code', rawValue: '0312345678', confidence: 0.96, sourcePage: 1 },
    { rawLabel: 'Mã số thuế:', rawValue: '0312345678', confidence: 0.95, sourcePage: 2 },
  ];
  const res6 = MetadataFilterEngine.processObservations(obs6);
  assertTest(
    res6.canonicalMetadata.length === 1 &&
      res6.canonicalMetadata[0].semanticType === 'TAX_CODE' &&
      res6.canonicalMetadata[0].value === '0312345678',
    '"Tax code" and "Mã số thuế" resolve to TAX_CODE and merge'
  );

  // --- Test Case 7: multi-line malformed key/value -> rejected ---
  const obs7: OCRMetadataObservation[] = [
    {
      rawLabel: 'Number of Check:\nOrgNbr\nExtraLine',
      rawValue: '0\n1807524\nExtraVal',
      confidence: 0.85,
      sourcePage: 1,
    },
  ];
  const res7 = MetadataFilterEngine.processObservations(obs7);
  assertTest(
    res7.canonicalMetadata.length === 0 && res7.metrics.filteredMalformedCount === 1,
    'Multi-line malformed compound observation is rejected by structural filter'
  );

  // --- Test Case 8: unknown labels + same value -> NOT auto-merged ---
  const obs8: OCRMetadataObservation[] = [
    { rawLabel: 'Reference ID', rawValue: '99887766', confidence: 0.95, sourcePage: 1 },
    { rawLabel: 'Batch Code', rawValue: '99887766', confidence: 0.95, sourcePage: 2 },
  ];
  const res8 = MetadataFilterEngine.processObservations(obs8);
  assertTest(
    res8.canonicalMetadata.length === 2 &&
      res8.canonicalMetadata.every((m) => m.semanticType === 'OTHER'),
    'Unknown labels with identical value remain separate canonical items (zero-guessing)'
  );

  // --- Test Case 9: same semantic type + different values -> CONFLICT ---
  const obs9: OCRMetadataObservation[] = [
    { rawLabel: 'Số tài khoản:', rawValue: '051704070011450', confidence: 0.99, sourcePage: 1 },
    { rawLabel: 'Account Number:', rawValue: '029171780009999', confidence: 0.95, sourcePage: 2 },
  ];
  const res9 = MetadataFilterEngine.processObservations(obs9);
  assertTest(
    res9.canonicalMetadata.length === 1 &&
      res9.canonicalMetadata[0].semanticType === 'ACCOUNT_NUMBER' &&
      res9.canonicalMetadata[0].status === 'CONFLICT' &&
      res9.canonicalMetadata[0].alternatives?.length === 1,
    'Same semantic type with different values produces 1 CONFLICT item with alternatives'
  );

  // --- Test Case 10: table-overlap candidate -> rejected ---
  const obs10: OCRMetadataObservation[] = [
    {
      rawLabel: 'Số tiền rút',
      rawValue: '50,000,000',
      confidence: 0.92,
      sourcePage: 1,
      keyBoundingPolygon: [0.1, 4.0, 0.3, 4.0, 0.3, 4.2, 0.1, 4.2],
      valueBoundingPolygon: [0.4, 4.0, 0.6, 4.0, 0.6, 4.2, 0.4, 4.2],
    },
    { rawLabel: 'Kỳ sao kê:', rawValue: 'Tháng 10/2024', confidence: 0.98, sourcePage: 1 },
  ];
  const tables10: OCRExtractedTable[] = [
    {
      pageNumber: 1,
      tableIndex: 0,
      rowCount: 20, // Clearly a transaction table
      columnCount: 8,
      confidence: 0.95,
      boundingRegions: [{ pageNumber: 1, polygon: [0.05, 3.5, 0.95, 3.5, 0.95, 9.5, 0.05, 9.5] }],
      rows: [
        {
          rowIndex: 0,
          cells: [{ rowIndex: 0, columnIndex: 0, rawValue: 'STT', cellType: 'TEXT', confidence: 0.99 }],
        },
      ],
    },
  ];
  const res10 = MetadataFilterEngine.processObservations(obs10, tables10);
  assertTest(
    res10.canonicalMetadata.length === 1 &&
      res10.canonicalMetadata[0].label === 'Kỳ sao kê' &&
      res10.metrics.filteredTableOverlapCount === 1,
    'Observation inside transaction table polygon is rejected by table exclusion filter'
  );

  // --- Test Case 11: header-line candidate -> accepted only when structural evidence supports it ---
  const pages11: OCRPage[] = [
    {
      pageNumber: 1,
      height: 11.0,
      width: 8.5,
      lines: [
        // Upper header zone line (normTop=0.09, normBot=0.10)
        { content: 'Từ ngày(from): 01/05/2024 đến ngày(to): 31/10/2024', polygon: [1.0, 1.0, 5.0, 1.0, 5.0, 1.1, 1.0, 1.1] },
        // Lower transaction area line (normTop=0.60, normBot=0.62) -> should be excluded by header zone
        { content: 'Số tiền: 5,000,000 VND', polygon: [1.0, 6.6, 3.0, 6.6, 3.0, 6.8, 1.0, 6.8] },
      ],
    },
  ];
  const res11 = MetadataFilterEngine.processObservations([], [], pages11);
  assertTest(
    res11.canonicalMetadata.length === 2 &&
      res11.canonicalMetadata.some((m) => m.semanticType === 'STATEMENT_FROM') &&
      res11.canonicalMetadata.some((m) => m.semanticType === 'STATEMENT_TO'),
    'Header-line candidate is extracted from upper header zone and lower body lines are ignored'
  );

  // --- Test Case 12: numeric identifier leading zeros -> preserve exact raw string ---
  const obs12: OCRMetadataObservation[] = [
    { rawLabel: 'Tài khoản:', rawValue: '051704070011450', confidence: 0.98, sourcePage: 1 },
    { rawLabel: 'Mã số thuế:', rawValue: '0300123456', confidence: 0.97, sourcePage: 1 },
  ];
  const res12 = MetadataFilterEngine.processObservations(obs12);
  assertTest(
    res12.canonicalMetadata.find((m) => m.semanticType === 'ACCOUNT_NUMBER')?.value === '051704070011450' &&
      res12.canonicalMetadata.find((m) => m.semanticType === 'TAX_CODE')?.value === '0300123456',
    'Leading zeros in numeric identifiers are strictly preserved as exact strings'
  );

  // --- Test Case 13: print timestamps vs legitimate statement dates ---
  const obs13: OCRMetadataObservation[] = [
    { rawLabel: 'In lúc:', rawValue: '14:35:20 15/05/2024', confidence: 0.95, sourcePage: 1 },
    { rawLabel: 'Print time:', rawValue: '2024-05-15 14:35:20', confidence: 0.96, sourcePage: 1 },
    { rawLabel: 'Printed at', rawValue: '14:35', confidence: 0.94, sourcePage: 2 },
    { rawLabel: 'Ngày sao kê:', rawValue: '15/05/2024', confidence: 0.99, sourcePage: 1 },
    { rawLabel: 'Statement Date:', rawValue: '15/05/2024', confidence: 0.98, sourcePage: 2 },
  ];
  const res13 = MetadataFilterEngine.processObservations(obs13);
  const printItems = res13.canonicalMetadata.filter(
    (m) =>
      m.rawLabel.includes('In lúc') ||
      m.rawLabel.includes('Print time') ||
      m.rawLabel.includes('Printed at')
  );
  const stmtDateItems = res13.canonicalMetadata.filter(
    (m) => m.semanticType === 'STATEMENT_DATE'
  );
  assertTest(
    printItems.length === 3 &&
      printItems.every((m) => m.semanticType === 'OTHER' && m.visibilityClass === 'ADDITIONAL') &&
      stmtDateItems.length === 1 &&
      stmtDateItems[0].semanticType === 'STATEMENT_DATE' &&
      stmtDateItems[0].visibilityClass === 'CORE' &&
      stmtDateItems[0].occurrenceCount === 2,
    'Operational print timestamps resolve to OTHER/ADDITIONAL, while legitimate dates resolve to STATEMENT_DATE/CORE'
  );

  console.log('\n======================================================================');
  console.log(`UNIT TESTS SUMMARY: ${passedCount}/${totalTests} TESTS PASSED CLEANLY!`);
  console.log('======================================================================\n');

  if (passedCount !== totalTests) {
    throw new Error(`Unit tests failed: ${totalTests - passedCount} failures`);
  }
}

runUnitTests();

