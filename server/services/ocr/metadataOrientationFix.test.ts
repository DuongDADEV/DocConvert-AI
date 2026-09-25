import { MetadataFilterEngine } from './metadataFilterEngine.js';
import { OCRMetadataObservation, OCRExtractedTable, OCRPage } from './types.js';

function runOrientationAndIsolationTests() {
  console.log('======================================================================');
  console.log('METADATA ORIENTATION AND HEADER ISOLATION TEST SUITE');
  console.log('======================================================================\n');

  let totalTests = 0;
  let passedCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
      console.log(`✅ [PASS] Test #${totalTests}: ${testName}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] Test #${totalTests}: ${testName}${detail ? ` -> ${detail}` : ''}`);
    }
  }

  // =====================================================================
  // 1. ORIENTATION & ANGLE NORMALIZATION TESTS (Section 39)
  // =====================================================================
  console.log('\n--- Section 1: Angle Normalization ---');
  assert(MetadataFilterEngine.normalizeAngle(0) === 0, 'Angle 0° maps to 0°');
  assert(MetadataFilterEngine.normalizeAngle(0.3) === 0, 'Angle 0.3° maps to 0°');
  assert(MetadataFilterEngine.normalizeAngle(89.8) === 90, 'Angle 89.8° maps to 90°');
  assert(MetadataFilterEngine.normalizeAngle(90.3) === 90, 'Angle 90.3° maps to 90°');
  assert(MetadataFilterEngine.normalizeAngle(179.9) === 180, 'Angle 179.9° maps to 180°');
  assert(MetadataFilterEngine.normalizeAngle(269.8) === 270, 'Angle 269.8° maps to 270°');
  assert(MetadataFilterEngine.normalizeAngle(-90.22) === 270, 'Angle -90.22° maps to 270°');
  assert(MetadataFilterEngine.normalizeAngle(-89.7) === 270, 'Angle -89.7° maps to 270°');
  assert(MetadataFilterEngine.normalizeAngle(undefined) === 0, 'Undefined angle defaults to 0°');

  console.log('\n--- Section 2: Visual Coordinate Transformations (0°, 90°, 180°, 270°) ---');
  const W = 8.5;
  const H = 11.0;

  // 0 degrees: Top-left in physical is Top-left in visual
  const poly0TopLeft = [0.5, 0.5, 2.0, 0.5, 2.0, 1.5, 0.5, 1.5];
  const b0 = MetadataFilterEngine.normalizePolygonToVisualBounds(poly0TopLeft, W, H, 0);
  assert(
    b0 !== null && b0.top < 0.15 && b0.bottom < 0.20 && b0.left < 0.10,
    '0°: physical top-left maps to visual top-left'
  );

  // 90 degrees: In 90° CW, visual top-left is at physical (W, 0)
  const poly90TopLeft = [7.5, 0.5, 8.0, 0.5, 8.0, 2.0, 7.5, 2.0];
  const b90 = MetadataFilterEngine.normalizePolygonToVisualBounds(poly90TopLeft, W, H, 90);
  assert(
    b90 !== null && b90.top < 0.15 && b90.left < 0.20,
    '90°: physical top-right maps to visual top-left'
  );

  // 180 degrees: In 180°, visual top-left is at physical (W, H)
  const poly180TopLeft = [7.0, 9.5, 8.0, 9.5, 8.0, 10.5, 7.0, 10.5];
  const b180 = MetadataFilterEngine.normalizePolygonToVisualBounds(poly180TopLeft, W, H, 180);
  assert(
    b180 !== null && b180.top < 0.15 && b180.left < 0.20,
    '180°: physical bottom-right maps to visual top-left'
  );

  // 270 degrees (or -90.22°): In 270°, visual top-left is at physical (0, H)
  const poly270TopLeft = [0.5, 9.5, 1.5, 9.5, 1.5, 10.5, 0.5, 10.5];
  const b270 = MetadataFilterEngine.normalizePolygonToVisualBounds(poly270TopLeft, W, H, -90.22);
  assert(
    b270 !== null && b270.top < 0.20 && b270.left < 0.15,
    '270° (-90.22°): physical bottom-left maps to visual top-left'
  );

  // Center stays center regardless of angle
  const polyCenter = [3.75, 5.0, 4.75, 5.0, 4.75, 6.0, 3.75, 6.0];
  const bCenter0 = MetadataFilterEngine.normalizePolygonToVisualBounds(polyCenter, W, H, 0);
  const bCenter270 = MetadataFilterEngine.normalizePolygonToVisualBounds(polyCenter, W, H, -90.22);
  assert(
    bCenter0 !== null && Math.abs(bCenter0.centerX - 0.5) < 0.05 && Math.abs(bCenter0.centerY - 0.5) < 0.05,
    '0°: physical center maps to visual center'
  );
  assert(
    bCenter270 !== null && Math.abs(bCenter270.centerX - 0.5) < 0.05 && Math.abs(bCenter270.centerY - 0.5) < 0.05,
    '270°: physical center maps to visual center'
  );

  // =====================================================================
  // 2. HEADER TABLE CLASSIFICATION TESTS (Section 40)
  // =====================================================================
  console.log('\n--- Section 3: Header Table Classification ---');

  // Case A: 2-row metadata header table -> HEADER
  const tableA: OCRExtractedTable = {
    pageNumber: 1,
    tableIndex: 0,
    rowCount: 2,
    columnCount: 4,
    confidence: 0.98,
    boundingRegions: [{ pageNumber: 1, polygon: [0.5, 0.5, 8.0, 0.5, 8.0, 1.5, 0.5, 1.5] }],
    rows: [
      {
        rowIndex: 0,
        cells: [
          { rowIndex: 0, columnIndex: 0, rawValue: 'Khách hàng:', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 0, columnIndex: 1, rawValue: 'NGUYEN VAN A', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 0, columnIndex: 2, rawValue: 'Số TK:', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 0, columnIndex: 3, rawValue: '123456789', cellType: 'TEXT', confidence: 0.98 },
        ],
      },
    ],
  };
  assert(MetadataFilterEngine.isHeaderTable(tableA, 11.0), '2-row metadata table is classified as HEADER');

  // Case B: 10-row metadata-rich header table -> HEADER (prioritizes content over rowCount)
  const tableB: OCRExtractedTable = {
    pageNumber: 1,
    tableIndex: 0,
    rowCount: 10,
    columnCount: 4,
    confidence: 0.98,
    boundingRegions: [{ pageNumber: 1, polygon: [0.34, 0.52, 2.76, 0.52, 2.75, 11.23, 0.33, 11.23] }],
    rows: [
      {
        rowIndex: 0,
        cells: [
          { rowIndex: 0, columnIndex: 0, rawValue: 'Tên tài khoản (Account name):', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 0, columnIndex: 1, rawValue: 'NGUYEN THI TUYET LAN', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 0, columnIndex: 2, rawValue: 'Loại tiền (Currency):', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 0, columnIndex: 3, rawValue: 'VND', cellType: 'TEXT', confidence: 0.98 },
        ],
      },
      {
        rowIndex: 1,
        cells: [
          { rowIndex: 1, columnIndex: 0, rawValue: 'Số tài khoản (Account no):', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 1, columnIndex: 1, rawValue: '0687041113504', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 1, columnIndex: 2, rawValue: 'Số CIF (CIF):', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 1, columnIndex: 3, rawValue: '00353094', cellType: 'TEXT', confidence: 0.98 },
        ],
      },
      {
        rowIndex: 2,
        cells: [
          { rowIndex: 2, columnIndex: 0, rawValue: 'Địa chỉ (Address):', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 2, columnIndex: 1, rawValue: '123 ABC Street', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 2, columnIndex: 2, rawValue: 'Ngày mở (Open date):', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 2, columnIndex: 3, rawValue: '19/08/2020', cellType: 'TEXT', confidence: 0.98 },
        ],
      },
      {
        rowIndex: 3,
        cells: [
          { rowIndex: 3, columnIndex: 0, rawValue: 'Số dư đầu kỳ (Opening balance):', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 3, columnIndex: 1, rawValue: '0,00', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 3, columnIndex: 2, rawValue: 'Số dư cuối kỳ (Closing balance):', cellType: 'TEXT', confidence: 0.98 },
          { rowIndex: 3, columnIndex: 3, rawValue: '500.000,00', cellType: 'TEXT', confidence: 0.98 },
        ],
      },
    ],
  };
  const pageB: OCRPage = { pageNumber: 1, width: 8.27, height: 11.69, angle: -90.22 };
  assert(
    MetadataFilterEngine.isHeaderTable(tableB, 11.69, [], pageB),
    '10-row rotated metadata-rich table is correctly classified as HEADER'
  );

  // Case C: 20-row transaction ledger -> TRANSACTION / NOT header
  const tableC: OCRExtractedTable = {
    pageNumber: 1,
    tableIndex: 1,
    rowCount: 20,
    columnCount: 8,
    confidence: 0.95,
    boundingRegions: [{ pageNumber: 1, polygon: [0.5, 3.5, 8.0, 3.5, 8.0, 9.5, 0.5, 9.5] }],
    rows: [
      {
        rowIndex: 0,
        cells: [
          { rowIndex: 0, columnIndex: 0, rawValue: 'STT', cellType: 'TEXT', confidence: 0.99 },
          { rowIndex: 0, columnIndex: 1, rawValue: 'Ngày GD', cellType: 'DATE', confidence: 0.99 },
          { rowIndex: 0, columnIndex: 2, rawValue: 'Số chứng từ', cellType: 'TEXT', confidence: 0.99 },
          { rowIndex: 0, columnIndex: 3, rawValue: 'Diễn giải', cellType: 'TEXT', confidence: 0.99 },
          { rowIndex: 0, columnIndex: 4, rawValue: 'Phát sinh nợ', cellType: 'MONEY', confidence: 0.99 },
          { rowIndex: 0, columnIndex: 5, rawValue: 'Phát sinh có', cellType: 'MONEY', confidence: 0.99 },
          { rowIndex: 0, columnIndex: 6, rawValue: 'Số dư', cellType: 'MONEY', confidence: 0.99 },
        ],
      },
      {
        rowIndex: 1,
        cells: [
          { rowIndex: 1, columnIndex: 0, rawValue: '1', cellType: 'NUMBER', confidence: 0.99 },
          { rowIndex: 1, columnIndex: 1, rawValue: '01/05/2024', cellType: 'DATE', confidence: 0.99 },
          { rowIndex: 1, columnIndex: 2, rawValue: 'FT123456', cellType: 'TEXT', confidence: 0.99 },
          { rowIndex: 1, columnIndex: 3, rawValue: 'Chuyển khoản thanh toán', cellType: 'TEXT', confidence: 0.99 },
          { rowIndex: 1, columnIndex: 4, rawValue: '1,500,000', cellType: 'MONEY', confidence: 0.99 },
          { rowIndex: 1, columnIndex: 5, rawValue: '', cellType: 'TEXT', confidence: 0.99 },
          { rowIndex: 1, columnIndex: 6, rawValue: '25,000,000', cellType: 'MONEY', confidence: 0.99 },
        ],
      },
    ],
  };
  assert(
    !MetadataFilterEngine.isHeaderTable(tableC, 11.0),
    '20-row ledger table is classified as TRANSACTION (NOT header)'
  );

  // =====================================================================
  // 3. FIRST MEANINGFUL STATEMENT PAGE DISCOVERY & ISOLATION (Section 41)
  // =====================================================================
  console.log('\n--- Section 4: Primary Page Discovery & Page Isolation ---');

  // Synthetic document: P1 cover, P2 statement header, P3 transactions, P4 signatures
  const pagesSynthetic: OCRPage[] = [
    { pageNumber: 1, lines: [{ content: 'NGÂN HÀNG ABC - BÁO CÁO TÀI LIỆU' }] },
    {
      pageNumber: 2,
      lines: [
        { content: 'SAO KÊ TÀI KHOẢN' },
        { content: 'Từ ngày(from): 01/05/2024 đến ngày(to): 31/10/2024', polygon: [1.0, 1.0, 5.0, 1.0, 5.0, 1.2, 1.0, 1.2] },
      ],
    },
    { pageNumber: 3, lines: [{ content: 'STT Ngày Diễn giải PS Nợ PS Có' }] },
    { pageNumber: 4, lines: [{ content: 'Người lập biểu: Nguyễn Văn X - Kiểm soát: Trần Văn Y' }] },
  ];

  const obsSynthetic: OCRMetadataObservation[] = [
    // P1 cover page: minimal/no account metadata
    { rawLabel: 'Document Code', rawValue: 'DOC-2024', confidence: 0.90, sourcePage: 1 },
    // P2 primary statement header: rich account metadata
    { rawLabel: 'Số tài khoản:', rawValue: '0687041113504', confidence: 0.99, sourcePage: 2 },
    { rawLabel: 'Chủ tài khoản:', rawValue: 'NGUYEN THI TUYET LAN', confidence: 0.99, sourcePage: 2 },
    { rawLabel: 'Mã khách hàng:', rawValue: '00353094', confidence: 0.98, sourcePage: 2 },
    { rawLabel: 'Loại tiền:', rawValue: 'VND', confidence: 0.99, sourcePage: 2 },
    // P4 signature / teller roles
    { rawLabel: 'Prepared by', rawValue: 'NGƯỜI LẬP', confidence: 0.95, sourcePage: 4 },
    { rawLabel: 'Supervisor', rawValue: 'KIỂM SOÁT', confidence: 0.95, sourcePage: 4 },
  ];

  const discoveredPage = MetadataFilterEngine.discoverPrimaryMetadataPage(pagesSynthetic, [], obsSynthetic);
  assert(discoveredPage === 2, `Primary metadata page discovered is P2 (actual: P${discoveredPage})`);

  const resSynthetic = MetadataFilterEngine.processObservations(obsSynthetic, [], pagesSynthetic);
  assert(
    resSynthetic.canonicalMetadata.some((m) => m.semanticType === 'ACCOUNT_NUMBER' && m.value === '0687041113504'),
    'P2 Account Number is extracted'
  );
  assert(
    resSynthetic.canonicalMetadata.some((m) => m.semanticType === 'ACCOUNT_HOLDER' && m.value === 'NGUYEN THI TUYET LAN'),
    'P2 Account Holder is extracted'
  );
  assert(
    !resSynthetic.canonicalMetadata.some((m) => m.rawLabel.includes('Prepared by') || m.rawLabel.includes('Supervisor')),
    'P4 Prepared by and Supervisor sign-off noise are strictly isolated and excluded'
  );

  // =====================================================================
  // 4. TIMESTAMP PARSING TESTS (Section 42)
  // =====================================================================
  console.log('\n--- Section 5: Timestamp Parsing Fix ---');
  const timestampPage: OCRPage[] = [
    {
      pageNumber: 1,
      lines: [
        // Standalone timestamp in header: must NOT be split at ':'
        { content: '01/11/2024 10:17:06', polygon: [1.0, 0.8, 3.0, 0.8, 3.0, 1.0, 1.0, 1.0] },
        // Legitimate Label: Value
        { content: 'Số tài khoản: 0687041113504', polygon: [1.0, 1.2, 4.0, 1.2, 4.0, 1.4, 1.0, 1.4] },
      ],
    },
  ];

  const resTimestamp = MetadataFilterEngine.processObservations([], [], timestampPage);
  const tsItem = resTimestamp.canonicalMetadata.find((m) => m.semanticType === 'STATEMENT_TIMESTAMP');
  assert(
    tsItem !== undefined && tsItem.value === '01/11/2024 10:17:06',
    'Timestamp "01/11/2024 10:17:06" is preserved intact as value and NOT split at colon'
  );

  const accItem = resTimestamp.canonicalMetadata.find((m) => m.semanticType === 'ACCOUNT_NUMBER');
  assert(
    accItem !== undefined && accItem.value === '0687041113504',
    'Legitimate "Số tài khoản: 0687041113504" continues to parse label and value correctly'
  );

  // =====================================================================
  // 5. LOW-VALUE METADATA SUPPRESSION TESTS (Section 43)
  // =====================================================================
  console.log('\n--- Section 6: Low-Value Suppression & Negative Controls ---');

  // Must suppress:
  assert(MetadataFilterEngine.isSuppressedLowValueMetadata('Page 1 of 4', '1 of 4'), 'Suppresses "Page 1 of 4"');
  assert(MetadataFilterEngine.isSuppressedLowValueMetadata('Trang số', '1'), 'Suppresses "Trang số"');
  assert(MetadataFilterEngine.isSuppressedLowValueMetadata('Prepared by', 'Nguyen Van A'), 'Suppresses "Prepared by"');
  assert(MetadataFilterEngine.isSuppressedLowValueMetadata('Supervisor', 'Tran Van B'), 'Suppresses "Supervisor"');
  assert(MetadataFilterEngine.isSuppressedLowValueMetadata('Người lập', 'Lê Thị C'), 'Suppresses "Người lập"');
  assert(MetadataFilterEngine.isSuppressedLowValueMetadata('Kiểm soát', 'Phạm Văn D'), 'Suppresses "Kiểm soát"');
  assert(MetadataFilterEngine.isSuppressedLowValueMetadata('GDV', 'Hoàng Văn E'), 'Suppresses "GDV"');

  // Negative controls: MUST NOT suppress real business metadata:
  assert(
    !MetadataFilterEngine.isSuppressedLowValueMetadata('Account Number', '0687041113504', 'ACCOUNT_NUMBER'),
    'Negative control: Does NOT suppress "Account Number"'
  );
  assert(
    !MetadataFilterEngine.isSuppressedLowValueMetadata('Reference Number', 'REF12345678', 'OTHER'),
    'Negative control: Does NOT suppress "Reference Number"'
  );
  assert(
    !MetadataFilterEngine.isSuppressedLowValueMetadata('Customer Number', 'CIF00353094', 'CUSTOMER_ID'),
    'Negative control: Does NOT suppress "Customer Number"'
  );
  assert(
    !MetadataFilterEngine.isSuppressedLowValueMetadata('Account Holder', 'NGUYEN THI TUYET LAN', 'ACCOUNT_HOLDER'),
    'Negative control: Does NOT suppress "Account Holder"'
  );
  assert(
    !MetadataFilterEngine.isSuppressedLowValueMetadata('Branch', 'Chi nhanh Cho Lon', 'BRANCH'),
    'Negative control: Does NOT suppress "Branch"'
  );

  console.log('\n======================================================================');
  console.log(`ORIENTATION & ISOLATION TEST SUMMARY: ${passedCount}/${totalTests} TESTS PASSED!`);
  console.log('======================================================================\n');

  if (passedCount !== totalTests) {
    throw new Error(`Test suite failed: ${totalTests - passedCount} failures`);
  }
}

runOrientationAndIsolationTests();
