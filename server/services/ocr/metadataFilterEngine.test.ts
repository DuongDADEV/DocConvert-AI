import { MetadataFilterEngine } from './metadataFilterEngine.js';
import { OCRMetadataObservation, OCRExtractedTable, OCRPage, OCRMetadataItem } from './types.js';

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
    res11.canonicalMetadata.length >= 2 &&
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

  // --- Test Case 14: Real Conflict Safety: Account Number (123456789 vs 123456780) ---
  const obs14: OCRMetadataObservation[] = [
    { rawLabel: 'Số tài khoản:', rawValue: '123456789', confidence: 0.99, sourcePage: 1 },
    { rawLabel: 'Account Number:', rawValue: '123456780', confidence: 0.95, sourcePage: 2 },
  ];
  const res14 = MetadataFilterEngine.processObservations(obs14);
  assertTest(
    res14.canonicalMetadata.length === 1 &&
      res14.canonicalMetadata[0].status === 'CONFLICT' &&
      res14.canonicalMetadata[0].alternatives?.length === 1 &&
      res14.metrics.conflictCount === 1,
    'Real Conflict Safety: Account Number 123456789 vs 123456780 preserves CONFLICT status'
  );

  // --- Test Case 15: Real Conflict Safety: Opening Date (19/08/2020 vs 20/08/2020) ---
  const obs15: OCRMetadataObservation[] = [
    { rawLabel: 'Ngày mở TK:', rawValue: '19/08/2020', confidence: 0.99, sourcePage: 1 },
    { rawLabel: 'Opening Date:', rawValue: '20/08/2020', confidence: 0.98, sourcePage: 1 },
  ];
  const res15 = MetadataFilterEngine.processObservations(obs15);
  assertTest(
    res15.canonicalMetadata.length === 1 &&
      res15.canonicalMetadata[0].status === 'CONFLICT' &&
      res15.metrics.conflictCount === 1,
    'Real Conflict Safety: Opening Date 19/08/2020 vs 20/08/2020 preserves CONFLICT status'
  );

  // --- Test Case 16: Real Conflict Safety: Currency (VND vs USD) ---
  const obs16: OCRMetadataObservation[] = [
    { rawLabel: 'Loại tiền:', rawValue: 'VND', confidence: 0.99, sourcePage: 1 },
    { rawLabel: 'Currency:', rawValue: 'USD', confidence: 0.98, sourcePage: 1 },
  ];
  const res16 = MetadataFilterEngine.processObservations(obs16);
  assertTest(
    res16.canonicalMetadata.length === 1 &&
      res16.canonicalMetadata[0].status === 'CONFLICT' &&
      res16.metrics.conflictCount === 1,
    'Real Conflict Safety: Currency VND vs USD preserves CONFLICT status'
  );

  // --- Test Case 17: False Conflict: Date normalization (19/08/2020 vs 19-08-2020) ---
  const obs17: OCRMetadataObservation[] = [
    { rawLabel: 'Ngày mở TK:', rawValue: '19/08/2020', confidence: 0.99, sourcePage: 1 },
    { rawLabel: 'Opening Date:', rawValue: '19-08-2020', confidence: 0.97, sourcePage: 2 },
  ];
  const res17 = MetadataFilterEngine.processObservations(obs17);
  assertTest(
    res17.canonicalMetadata.length === 1 &&
      res17.canonicalMetadata[0].status === 'AUTO' &&
      res17.canonicalMetadata[0].occurrenceCount === 2 &&
      res17.metrics.conflictCount === 0,
    'False Conflict: Date normalization (19/08/2020 vs 19-08-2020) resolves to AUTO without conflict'
  );

  // --- Test Case 18: False Conflict: KVP vs Header Table Same Account Number ---
  const obs18: OCRMetadataObservation[] = [
    { rawLabel: 'Số tài khoản:', rawValue: '0687041113504', confidence: 0.99, sourcePage: 1, sourceType: 'KEY_VALUE' },
    { rawLabel: 'Tài khoản / Acct No.:', rawValue: '0687041113504', confidence: 0.98, sourcePage: 1, sourceType: 'HEADER_TABLE' },
  ];
  const res18 = MetadataFilterEngine.processObservations(obs18);
  assertTest(
    res18.canonicalMetadata.length === 1 &&
      res18.canonicalMetadata[0].status === 'AUTO' &&
      res18.canonicalMetadata[0].occurrenceCount === 2 &&
      res18.metrics.conflictCount === 0,
    'False Conflict: Same account number from KVP and Header Table merges cleanly into 1 AUTO item'
  );

  // --- Test Case 19: False Conflict: Address line-break and punctuation differences ---
  const obs19: OCRMetadataObservation[] = [
    { rawLabel: 'Địa chỉ:', rawValue: '437 KINH DUONG VUONG,\nPHUONG AN LAC, TP HCM', confidence: 0.98, sourcePage: 1 },
    { rawLabel: 'Address:', rawValue: '437 KINH DUONG VUONG, PHUONG AN LAC, TP HCM', confidence: 0.99, sourcePage: 1 },
  ];
  const res19 = MetadataFilterEngine.processObservations(obs19);
  assertTest(
    res19.canonicalMetadata.length === 1 &&
      res19.canonicalMetadata[0].status === 'AUTO' &&
      res19.metrics.conflictCount === 0,
    'False Conflict: Address line-break and spacing differences normalize to single AUTO item'
  );

  // --- Test Case 20: False Conflict: Partial address vs complete continuation address ---
  const obs20: OCRMetadataObservation[] = [
    { rawLabel: 'Địa chỉ:', rawValue: '437 KINH DUONG VUONG,PHUONG', confidence: 0.995, sourcePage: 1 },
    { rawLabel: 'Address:', rawValue: '437 KINH DUONG VUONG,PHUONG AN LAC, QUAN BINH TAN,TP HCM', confidence: 0.989, sourcePage: 1 },
  ];
  const res20 = MetadataFilterEngine.processObservations(obs20);
  assertTest(
    res20.canonicalMetadata.length === 1 &&
      res20.canonicalMetadata[0].status === 'AUTO' &&
      res20.canonicalMetadata[0].value === '437 KINH DUONG VUONG,PHUONG AN LAC, QUAN BINH TAN,TP HCM' &&
      res20.metrics.conflictCount === 0,
    'False Conflict: Partial address vs complete continuation prefers complete address as AUTO'
  );

  // --- Test Case 21: False Conflict: Amount formatting differences (497.503,00 vs 497503.00) ---
  const obs21: OCRMetadataObservation[] = [
    { rawLabel: 'Số dư cuối kỳ:', rawValue: '497.503,00', confidence: 0.99, sourcePage: 1 },
    { rawLabel: 'Closing balance:', rawValue: '497503.00', confidence: 0.98, sourcePage: 2 },
  ];
  const res21 = MetadataFilterEngine.processObservations(obs21);
  assertTest(
    res21.canonicalMetadata.length === 1 &&
      res21.canonicalMetadata[0].status === 'AUTO' &&
      res21.metrics.conflictCount === 0,
    'False Conflict: Amount formatting differences (497.503,00 vs 497503.00) normalize to single AUTO item'
  );

  // --- Test Case 22: Statement Period Dedup: Synthesizes STATEMENT_PERIOD and demotes FROM/TO to ADDITIONAL ---
  const obs22: OCRMetadataObservation[] = [
    { rawLabel: 'Từ ngày:', rawValue: '01/05/2024', confidence: 0.98, sourcePage: 1 },
    { rawLabel: 'Đến ngày:', rawValue: '01/11/2024', confidence: 0.98, sourcePage: 1 },
  ];
  const res22 = MetadataFilterEngine.processObservations(obs22);
  const corePeriod = res22.canonicalMetadata.filter((m) => m.semanticType === 'STATEMENT_PERIOD' && m.visibilityClass === 'CORE');
  const coreFromTo = res22.canonicalMetadata.filter(
    (m) => (m.semanticType === 'STATEMENT_FROM' || m.semanticType === 'STATEMENT_TO') && m.visibilityClass === 'CORE'
  );
  const addFromTo = res22.canonicalMetadata.filter(
    (m) => (m.semanticType === 'STATEMENT_FROM' || m.semanticType === 'STATEMENT_TO') && m.visibilityClass === 'ADDITIONAL'
  );
  assertTest(
    corePeriod.length === 1 &&
      corePeriod[0].value === '01/05/2024 → 01/11/2024' &&
      coreFromTo.length === 0 &&
      addFromTo.length === 2,
    'Statement Period Dedup: Single STATEMENT_PERIOD card in CORE, component FROM/TO demoted to ADDITIONAL'
  );

  // --- Test Case 23: Header Table bilingual sub-header row skipping & 4-column address concatenation ---
  const table23: OCRExtractedTable = {
    pageNumber: 1,
    tableIndex: 0,
    rowCount: 3,
    columnCount: 4,
    confidence: 0.98,
    boundingRegions: [{ pageNumber: 1, polygon: [0.05, 0.5, 0.95, 0.5, 0.95, 2.0, 0.05, 2.0] }],
    rows: [
      {
        id: 'r0',
        rowIndex: 0,
        cells: [
          { id: 'c0', rowIndex: 0, columnIndex: 0, rawValue: 'ĐỊA CHỈ:', cellType: 'TEXT', confidence: 0.99 },
          { id: 'c1', rowIndex: 0, columnIndex: 1, rawValue: '437 KINH DUONG VUONG,PHUONG', cellType: 'TEXT', confidence: 0.99 },
          { id: 'c2', rowIndex: 0, columnIndex: 2, rawValue: 'AN LAC, QUAN BINH', cellType: 'TEXT', confidence: 0.98 },
          { id: 'c3', rowIndex: 0, columnIndex: 3, rawValue: 'TAN,TP HCM', cellType: 'TEXT', confidence: 0.98 },
        ],
      },
      {
        id: 'r1',
        rowIndex: 1,
        cells: [
          { id: 'c4', rowIndex: 1, columnIndex: 0, rawValue: '(Opening Date)', cellType: 'TEXT', confidence: 0.99 },
          { id: 'c5', rowIndex: 1, columnIndex: 1, rawValue: '(Maturity Date)', cellType: 'TEXT', confidence: 0.99 },
        ],
      },
      {
        id: 'r2',
        rowIndex: 2,
        cells: [
          { id: 'c6', rowIndex: 2, columnIndex: 0, rawValue: 'NGÀY MỞ TÀI KHOẢN:', cellType: 'TEXT', confidence: 0.99 },
          { id: 'c7', rowIndex: 2, columnIndex: 1, rawValue: '19/08/2020', cellType: 'TEXT', confidence: 0.99 },
          { id: 'c8', rowIndex: 2, columnIndex: 2, rawValue: 'LOẠI TIỀN:', cellType: 'TEXT', confidence: 0.99 },
          { id: 'c9', rowIndex: 2, columnIndex: 3, rawValue: 'VND', cellType: 'TEXT', confidence: 0.99 },
        ],
      },
    ],
  };
  const page23: OCRPage = {
    pageNumber: 1,
    width: 8.5,
    height: 11.0,
    angle: 0,
    rawText: '',
    confidence: 0.99,
  };
  const res23 = MetadataFilterEngine.processObservations([], [table23], [page23]);
  const addr23 = res23.canonicalMetadata.find((m) => m.semanticType === 'ADDRESS');
  const open23 = res23.canonicalMetadata.find((m) => m.semanticType === 'OPENING_DATE');
  const maturityCandidate = res23.canonicalMetadata.find((m) => m.value.includes('Maturity'));
  assertTest(
    addr23?.value === '437 KINH DUONG VUONG,PHUONG AN LAC, QUAN BINH TAN,TP HCM' &&
      open23?.value === '19/08/2020' &&
      open23?.status === 'AUTO' &&
      !maturityCandidate,
    'Header Table: Concatenates multi-column address, skips bilingual label rows, and rejects fake Maturity Date values'
  );

  // --- Test Case 24: Canonicalization Idempotency - Bản Việt-like metadata ---
  const input24: OCRMetadataItem[] = [
    {
      id: 'm1',
      label: 'Chủ tài khoản',
      value: 'NGUYEN THI TUYET LAN',
      rawLabel: 'Khách hàng',
      rawValue: 'NGUYEN THI TUYET LAN',
      confidence: 0.99,
      sourcePage: 1,
      occurrenceCount: 1,
      status: 'AUTO',
      semanticType: 'ACCOUNT_HOLDER',
      visibilityClass: 'CORE',
    },
    {
      id: 'm2',
      label: 'Số tài khoản',
      value: '0687041113504',
      rawLabel: 'Tài khoản',
      rawValue: '0687041113504',
      confidence: 0.99,
      sourcePage: 1,
      occurrenceCount: 1,
      status: 'AUTO',
      semanticType: 'ACCOUNT_NUMBER',
      visibilityClass: 'CORE',
    },
    {
      id: 'm3',
      label: 'Từ ngày',
      value: '01/05/2024',
      rawLabel: 'Từ ngày',
      rawValue: '01/05/2024',
      confidence: 0.98,
      sourcePage: 1,
      occurrenceCount: 1,
      status: 'AUTO',
      semanticType: 'STATEMENT_FROM',
      visibilityClass: 'CORE',
    },
    {
      id: 'm4',
      label: 'Đến ngày',
      value: '01/11/2024',
      rawLabel: 'Đến ngày',
      rawValue: '01/11/2024',
      confidence: 0.98,
      sourcePage: 1,
      occurrenceCount: 1,
      status: 'AUTO',
      semanticType: 'STATEMENT_TO',
      visibilityClass: 'CORE',
    },
    {
      id: 'm5',
      label: 'Địa chỉ',
      value: '437 KINH DUONG VUONG,PHUONG AN LAC, QUAN BINH TAN,TP HCM',
      rawLabel: 'Địa chỉ',
      rawValue: '437 KINH DUONG VUONG,PHUONG AN LAC, QUAN BINH TAN,TP HCM',
      confidence: 0.99,
      sourcePage: 1,
      occurrenceCount: 2,
      status: 'CONFLICT',
      alternatives: [
        {
          rawLabel: 'Địa chỉ',
          rawValue: '437 KINH DUONG VUONG,PHUONG',
          confidence: 0.98,
          sourcePage: 1,
        },
      ],
      semanticType: 'ADDRESS',
      visibilityClass: 'ADDITIONAL',
    },
    {
      id: 'm6',
      label: 'Ngày mở tài khoản',
      value: '19/08/2020',
      rawLabel: 'Ngày mở',
      rawValue: '19/08/2020',
      confidence: 0.99,
      sourcePage: 1,
      occurrenceCount: 2,
      status: 'CONFLICT',
      alternatives: [
        {
          rawLabel: 'Ngày mở',
          rawValue: '(Maturity Date)',
          confidence: 0.95,
          sourcePage: 1,
        },
      ],
      semanticType: 'OPENING_DATE',
      visibilityClass: 'ADDITIONAL',
    },
  ];
  const once24 = MetadataFilterEngine.canonicalizeMetadata(input24);
  const twice24 = MetadataFilterEngine.canonicalizeMetadata(once24);
  assertTest(
    JSON.stringify(once24) === JSON.stringify(twice24),
    'Canonicalization Idempotency: C(C(x)) === C(x) on Bản Việt-like metadata (period synthesis, address, opening date)'
  );

  // --- Test Case 25: Canonicalization Idempotency - Already synthesized STATEMENT_PERIOD ---
  const input25: OCRMetadataItem[] = [
    {
      id: 'p1',
      label: 'Kỳ sao kê',
      value: '01/05/2024 → 01/11/2024',
      rawLabel: 'Kỳ sao kê',
      rawValue: '01/05/2024 → 01/11/2024',
      confidence: 0.98,
      sourcePage: 1,
      occurrenceCount: 1,
      status: 'AUTO',
      semanticType: 'STATEMENT_PERIOD',
      visibilityClass: 'CORE',
    },
    {
      id: 'f1',
      label: 'Từ ngày',
      value: '01/05/2024',
      rawLabel: 'Từ ngày',
      rawValue: '01/05/2024',
      confidence: 0.98,
      sourcePage: 1,
      occurrenceCount: 1,
      status: 'AUTO',
      semanticType: 'STATEMENT_FROM',
      visibilityClass: 'ADDITIONAL',
    },
    {
      id: 't1',
      label: 'Đến ngày',
      value: '01/11/2024',
      rawLabel: 'Đến ngày',
      rawValue: '01/11/2024',
      confidence: 0.98,
      sourcePage: 1,
      occurrenceCount: 1,
      status: 'AUTO',
      semanticType: 'STATEMENT_TO',
      visibilityClass: 'ADDITIONAL',
    },
  ];
  const once25 = MetadataFilterEngine.canonicalizeMetadata(input25);
  const twice25 = MetadataFilterEngine.canonicalizeMetadata(once25);
  assertTest(
    JSON.stringify(once25) === JSON.stringify(twice25),
    'Canonicalization Idempotency: C(C(x)) === C(x) when STATEMENT_PERIOD already exists (no duplicate period created)'
  );

  // --- Test Case 26: Canonicalization Idempotency - Address partial vs full candidates ---
  const input26: OCRMetadataItem[] = [
    {
      id: 'addr1',
      label: 'Địa chỉ',
      value: '437 KINH DUONG VUONG',
      rawLabel: 'Địa chỉ',
      rawValue: '437 KINH DUONG VUONG',
      confidence: 0.95,
      sourcePage: 1,
      occurrenceCount: 2,
      status: 'CONFLICT',
      alternatives: [
        {
          rawLabel: 'Địa chỉ',
          rawValue: '437 KINH DUONG VUONG, PHUONG AN LAC, QUAN BINH TAN, TP HCM',
          confidence: 0.99,
          sourcePage: 1,
        },
      ],
      semanticType: 'ADDRESS',
      visibilityClass: 'ADDITIONAL',
    },
  ];
  const once26 = MetadataFilterEngine.canonicalizeMetadata(input26);
  const twice26 = MetadataFilterEngine.canonicalizeMetadata(once26);
  assertTest(
    JSON.stringify(once26) === JSON.stringify(twice26),
    'Canonicalization Idempotency: C(C(x)) === C(x) on address partial/full candidates'
  );

  // --- Test Case 27: Canonicalization Idempotency - Real currency conflict preserved ---
  const input27: OCRMetadataItem[] = [
    {
      id: 'curr1',
      label: 'Loại tiền',
      value: 'VND',
      rawLabel: 'Loại tiền',
      rawValue: 'VND',
      confidence: 0.99,
      sourcePage: 1,
      occurrenceCount: 2,
      status: 'CONFLICT',
      alternatives: [
        {
          rawLabel: 'Loại tiền',
          rawValue: 'USD',
          confidence: 0.95,
          sourcePage: 1,
        },
      ],
      semanticType: 'CURRENCY',
      visibilityClass: 'CORE',
    },
  ];
  const once27 = MetadataFilterEngine.canonicalizeMetadata(input27);
  const twice27 = MetadataFilterEngine.canonicalizeMetadata(once27);
  assertTest(
    JSON.stringify(once27) === JSON.stringify(twice27) &&
      twice27[0].status === 'CONFLICT' &&
      twice27[0].alternatives?.length === 1 &&
      twice27[0].alternatives[0].rawValue === 'USD',
    'Canonicalization Idempotency: C(C(x)) === C(x) preserves real currency conflict (VND vs USD)'
  );

  // --- Test Case 28: Canonicalization Idempotency - Real date conflict preserved ---
  const input28: OCRMetadataItem[] = [
    {
      id: 'd1',
      label: 'Ngày mở',
      value: '19/08/2020',
      rawLabel: 'Ngày mở',
      rawValue: '19/08/2020',
      confidence: 0.99,
      sourcePage: 1,
      occurrenceCount: 2,
      status: 'CONFLICT',
      alternatives: [
        {
          rawLabel: 'Ngày mở',
          rawValue: '20/08/2020',
          confidence: 0.95,
          sourcePage: 1,
        },
      ],
      semanticType: 'OPENING_DATE',
      visibilityClass: 'ADDITIONAL',
    },
  ];
  const once28 = MetadataFilterEngine.canonicalizeMetadata(input28);
  const twice28 = MetadataFilterEngine.canonicalizeMetadata(once28);
  assertTest(
    JSON.stringify(once28) === JSON.stringify(twice28) &&
      twice28[0].status === 'CONFLICT' &&
      twice28[0].alternatives?.length === 1 &&
      twice28[0].alternatives[0].rawValue === '20/08/2020',
    'Canonicalization Idempotency: C(C(x)) === C(x) preserves real date conflict (19/08/2020 vs 20/08/2020)'
  );

  // --- Test Case 29: Canonicalization Idempotency - Real account number conflict preserved ---
  const input29: OCRMetadataItem[] = [
    {
      id: 'acc1',
      label: 'Số tài khoản',
      value: '123456789',
      rawLabel: 'Số tài khoản',
      rawValue: '123456789',
      confidence: 0.99,
      sourcePage: 1,
      occurrenceCount: 2,
      status: 'CONFLICT',
      alternatives: [
        {
          rawLabel: 'Số tài khoản',
          rawValue: '123456780',
          confidence: 0.97,
          sourcePage: 1,
        },
      ],
      semanticType: 'ACCOUNT_NUMBER',
      visibilityClass: 'CORE',
    },
  ];
  const once29 = MetadataFilterEngine.canonicalizeMetadata(input29);
  const twice29 = MetadataFilterEngine.canonicalizeMetadata(once29);
  assertTest(
    JSON.stringify(once29) === JSON.stringify(twice29) &&
      twice29[0].status === 'CONFLICT' &&
      twice29[0].alternatives?.length === 1 &&
      twice29[0].alternatives[0].rawValue === '123456780',
    'Canonicalization Idempotency: C(C(x)) === C(x) preserves real account number conflict with alternatives'
  );
  console.log(`UNIT TESTS SUMMARY: ${passedCount}/${totalTests} TESTS PASSED CLEANLY!`);
  console.log('======================================================================\n');

  if (passedCount !== totalTests) {
    throw new Error(`Unit tests failed: ${totalTests - passedCount} failures`);
  }
}

runUnitTests();

