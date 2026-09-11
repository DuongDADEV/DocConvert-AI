import assert from 'node:assert';
import {
  UnifiedTableService,
  normalizeVietnameseText,
} from './unifiedTableService.js';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('Running UnifiedTableService Unit Tests:');

// Test 1: Transaction score with few rows but strong transaction evidence -> still eligible
test('1. should classify table with few rows (e.g. 5 rows) but strong date & money signals as TRANSACTION', () => {
  const table = {
    id: 'table-small-tx',
    pageNumber: 1,
    tableIndex: 1,
    rowCount: 5,
    columnCount: 6,
    headers: ['STT', 'Ngày GD', 'Diễn giải', 'Rút ra', 'Gửi vào', 'Số dư'],
    rows: [
      {
        id: 'r1',
        isHeader: false,
        cells: [
          { rawValue: '1', columnIndex: 0 },
          { rawValue: '01/02/2024', columnIndex: 1 },
          { rawValue: 'Thanh toan tien dien sinh hoat thang 1', columnIndex: 2 },
          { rawValue: '500,000', columnIndex: 3 },
          { rawValue: '', columnIndex: 4 },
          { rawValue: '10,000,000', columnIndex: 5 },
        ],
      },
      {
        id: 'r2',
        isHeader: false,
        cells: [
          { rawValue: '2', columnIndex: 0 },
          { rawValue: '03/02/2024', columnIndex: 1 },
          { rawValue: 'Nhan chuyen khoan luong cong ty', columnIndex: 2 },
          { rawValue: '', columnIndex: 3 },
          { rawValue: '15,000,000', columnIndex: 4 },
          { rawValue: '25,000,000', columnIndex: 5 },
        ],
      },
    ],
  };

  const classification = UnifiedTableService.classifyTable(table, [table]);
  assert.strictEqual(classification.classification, 'TRANSACTION');
  assert.ok(classification.score >= 0.50);
});

// Test 2: Metadata table -> rejected
test('2. should reject metadata key-value table (e.g. customer info)', () => {
  const table = {
    id: 'table-meta',
    pageNumber: 1,
    tableIndex: 0,
    rowCount: 3,
    columnCount: 2,
    headers: ['Thông tin khách hàng', 'Giá trị'],
    rows: [
      {
        id: 'm1',
        isHeader: false,
        cells: [
          { rawValue: 'Tên khách hàng / Client:', columnIndex: 0 },
          { rawValue: 'NGUYEN VAN A', columnIndex: 1 },
        ],
      },
      {
        id: 'm2',
        isHeader: false,
        cells: [
          { rawValue: 'Số tài khoản / Account No:', columnIndex: 0 },
          { rawValue: '190345678901', columnIndex: 1 },
        ],
      },
    ],
  };

  const classification = UnifiedTableService.classifyTable(table, [table]);
  assert.notStrictEqual(classification.classification, 'TRANSACTION');
  assert.ok(classification.score < 0.50);
});

// Test 3: Summary table -> rejected / separated
test('3. should reject small summary balance table', () => {
  const table = {
    id: 'table-summary',
    pageNumber: 1,
    tableIndex: 2,
    rowCount: 4,
    columnCount: 2,
    headers: ['Chỉ tiêu', 'Số tiền'],
    rows: [
      {
        id: 's1',
        isHeader: false,
        cells: [
          { rawValue: 'Số dư đầu kỳ', columnIndex: 0 },
          { rawValue: '10,000,000', columnIndex: 1 },
        ],
      },
      {
        id: 's2',
        isHeader: false,
        cells: [
          { rawValue: 'Số dư cuối kỳ', columnIndex: 0 },
          { rawValue: '25,000,000', columnIndex: 1 },
        ],
      },
    ],
  };

  const classification = UnifiedTableService.classifyTable(table, [table]);
  assert.notStrictEqual(classification.classification, 'TRANSACTION');
});

// Test 4: Identical schema across pages -> merge
test('4. should merge tables with identical schema across pages into unified rows', () => {
  const table1 = {
    id: 't1',
    pageNumber: 1,
    tableIndex: 1,
    rowCount: 2,
    columnCount: 4,
    headers: ['Ngày', 'Nội dung', 'Số tiền', 'Số dư'],
    rows: [
      {
        id: 't1_r1',
        isHeader: false,
        cells: [
          { id: 'c1', columnIndex: 0, rawValue: '10/01/2024', normalizedValue: '10/01/2024', cellType: 'DATE', confidence: 0.95 },
          { id: 'c2', columnIndex: 1, rawValue: 'Chuyen tien mua sach', normalizedValue: 'Chuyen tien mua sach', cellType: 'TEXT', confidence: 0.98 },
          { id: 'c3', columnIndex: 2, rawValue: '100,000', normalizedValue: '100000', cellType: 'MONEY', confidence: 0.99 },
          { id: 'c4', columnIndex: 3, rawValue: '5,000,000', normalizedValue: '5000000', cellType: 'MONEY', confidence: 0.99 },
        ],
      },
    ],
  };

  const table2 = {
    id: 't2',
    pageNumber: 2,
    tableIndex: 1,
    rowCount: 2,
    columnCount: 4,
    headers: ['Ngày', 'Nội dung', 'Số tiền', 'Số dư'],
    rows: [
      {
        id: 't2_r1',
        isHeader: false,
        cells: [
          { id: 'c5', columnIndex: 0, rawValue: '12/01/2024', normalizedValue: '12/01/2024', cellType: 'DATE', confidence: 0.95 },
          { id: 'c6', columnIndex: 1, rawValue: 'Tien thuong tet', normalizedValue: 'Tien thuong tet', cellType: 'TEXT', confidence: 0.98 },
          { id: 'c7', columnIndex: 2, rawValue: '2,000,000', normalizedValue: '2000000', cellType: 'MONEY', confidence: 0.99 },
          { id: 'c8', columnIndex: 3, rawValue: '7,000,000', normalizedValue: '7000000', cellType: 'MONEY', confidence: 0.99 },
        ],
      },
    ],
  };

  const unified = UnifiedTableService.projectDocumentTables('doc-test-1', [table1, table2]);
  assert.ok(unified !== null);
  assert.strictEqual(unified!.rowCount, 2);
  assert.strictEqual(unified!.rows[0].sourcePage, 1);
  assert.strictEqual(unified!.rows[1].sourcePage, 2);
  assert.strictEqual(unified!.rows[0].cells[0].id, 'c1');
  assert.strictEqual(unified!.rows[1].cells[0].id, 'c5');
});

// Test 5: Header typo / accent variation -> align to same logical column
test('5. should align header OCR variants (e.g. TRẢ LẠI vs TRÀ LẠI vs TRÁ LẠI) to same canonical column', () => {
  const t1 = {
    id: 't1',
    pageNumber: 1,
    tableIndex: 1,
    columnCount: 3,
    headers: ['NGÀY GD', 'DIỄN GIÁI', 'TRẢ LẠI'],
    rows: [],
  };
  const t2 = {
    id: 't2',
    pageNumber: 2,
    tableIndex: 1,
    columnCount: 3,
    headers: ['NGÀY GD', 'DIÊN GIÁI', 'TRÀ LẠI'],
    rows: [],
  };

  const canonicalCols = UnifiedTableService.deriveCanonicalColumns(t1, [t1, t2]);
  const mapping = UnifiedTableService.mapSourceColumnsToCanonical(t2, canonicalCols);

  assert.strictEqual(mapping[0], 0); // NGÀY GD -> NGÀY GD
  assert.strictEqual(mapping[1], 1); // DIÊN GIÁI -> DIỄN GIÁI
  assert.strictEqual(mapping[2], 2); // TRÀ LẠI -> TRẢ LẠI
});

// Test 6: 5-column to 6-column mapping -> empty logical slot inserted correctly
test('6. should insert empty placeholder slot without shifting when mapping 5-col table to 6-col canonical schema', () => {
  const canonicalCols = [
    { canonicalColumnIndex: 0, header: 'Ngày', normalizedHeader: 'ngay', semanticType: 'DATE' as const },
    { canonicalColumnIndex: 1, header: 'Diễn giải', normalizedHeader: 'dien giai', semanticType: 'DESCRIPTION' as const },
    { canonicalColumnIndex: 2, header: 'Số GD', normalizedHeader: 'so gd', semanticType: 'REFERENCE' as const },
    { canonicalColumnIndex: 3, header: 'Rút ra', normalizedHeader: 'rut ra', semanticType: 'DEBIT' as const },
    { canonicalColumnIndex: 4, header: 'Gửi vào', normalizedHeader: 'gui vao', semanticType: 'CREDIT' as const },
    { canonicalColumnIndex: 5, header: 'Số dư', normalizedHeader: 'so du', semanticType: 'BALANCE' as const },
  ];

  const sourceTable = {
    id: 't5col',
    pageNumber: 2,
    tableIndex: 1,
    columnCount: 5,
    headers: ['Ngày', 'Diễn giải', 'Rút ra', 'Gửi vào', 'Số dư'],
    rows: [
      {
        id: 'row-5col',
        isHeader: false,
        cells: [
          { id: 'c-d', columnIndex: 0, rawValue: '05/02/2024' },
          { id: 'c-n', columnIndex: 1, rawValue: 'Mua hang online' },
          { id: 'c-deb', columnIndex: 2, rawValue: '250,000' },
          { id: 'c-crd', columnIndex: 3, rawValue: '' },
          { id: 'c-bal', columnIndex: 4, rawValue: '9,750,000' },
        ],
      },
    ],
  };

  const mapping = UnifiedTableService.mapSourceColumnsToCanonical(sourceTable, canonicalCols);
  assert.deepStrictEqual(mapping, [0, 1, 3, 4, 5]);

  const canonicalTable = {
    id: 't6col',
    pageNumber: 1,
    tableIndex: 1,
    columnCount: 6,
    headers: ['Ngày', 'Diễn giải', 'Số GD', 'Rút ra', 'Gửi vào', 'Số dư'],
    rows: [
      {
        id: 'row-6col',
        isHeader: false,
        cells: [
          { id: 'c6-1', columnIndex: 0, rawValue: '01/02/2024' },
          { id: 'c6-2', columnIndex: 1, rawValue: 'Thanh toan tien dien' },
          { id: 'c6-3', columnIndex: 2, rawValue: 'REF12345' },
          { id: 'c6-4', columnIndex: 3, rawValue: '500,000' },
          { id: 'c6-5', columnIndex: 4, rawValue: '' },
          { id: 'c6-6', columnIndex: 5, rawValue: '10,000,000' },
        ],
      },
    ],
  };

  const unified = UnifiedTableService.projectDocumentTables('doc-test-5v6', [canonicalTable, sourceTable]);
  assert.ok(unified !== null);
  assert.strictEqual(unified!.rows.length, 2);
  const row0 = unified!.rows[0];
  assert.strictEqual(row0.cells.length, 6);
  assert.strictEqual(row0.cells[2].id, 'c6-3');

  const row1 = unified!.rows[1];
  assert.strictEqual(row1.cells.length, 6);
  assert.strictEqual(row1.cells[0].rawValue, '05/02/2024');
  assert.strictEqual(row1.cells[1].rawValue, 'Mua hang online');
  assert.strictEqual(row1.cells[2].isPlaceholder, true);
  assert.strictEqual(row1.cells[2].id, null);
  assert.strictEqual(row1.cells[3].rawValue, '250,000');
  assert.strictEqual(row1.cells[5].rawValue, '9,750,000');
});

// Test 7: Repeated header row -> removed
test('7. should detect and remove repeated header row on page 2', () => {
  const canonicalCols = [
    { canonicalColumnIndex: 0, header: 'Ngày GD', normalizedHeader: 'ngay gd', semanticType: 'DATE' as const },
    { canonicalColumnIndex: 1, header: 'Số GD', normalizedHeader: 'so gd', semanticType: 'REFERENCE' as const },
    { canonicalColumnIndex: 2, header: 'Nội dung', normalizedHeader: 'noi dung', semanticType: 'DESCRIPTION' as const },
    { canonicalColumnIndex: 3, header: 'Số dư', normalizedHeader: 'so du', semanticType: 'BALANCE' as const },
  ];

  const repeatedRowValues = ['Ngày GD', 'Số GD', 'Nội dung', 'Số dư'];
  const isRepeated = UnifiedTableService.isRepeatedHeaderRow(repeatedRowValues, canonicalCols);
  assert.strictEqual(isRepeated, true);

  const dataRowValues = ['15/02/2024', 'FT24046123', 'Thanh toan hoa don', '12,500,000'];
  const isDataRepeated = UnifiedTableService.isRepeatedHeaderRow(dataRowValues, canonicalCols);
  assert.strictEqual(isDataRepeated, false);
});

// Test 8: Summary footer -> summaryRows
test('8. should separate summary/footer row into summaryRows instead of transaction rows', () => {
  const canonicalCols = [
    { canonicalColumnIndex: 0, header: 'Ngày GD', normalizedHeader: 'ngay gd', semanticType: 'DATE' as const },
    { canonicalColumnIndex: 1, header: 'Nội dung', normalizedHeader: 'noi dung', semanticType: 'DESCRIPTION' as const },
    { canonicalColumnIndex: 2, header: 'Số dư', normalizedHeader: 'so du', semanticType: 'BALANCE' as const },
  ];

  const summaryValues = ['', 'TỔNG PHÁT SINH (Total)', '50,000,000'];
  const check = UnifiedTableService.detectSummaryRow(summaryValues, canonicalCols);
  assert.strictEqual(check.isSummary, true);

  const normalValues = ['15/02/2024', 'Tong cong ty dien luc thanh toan', '1,000,000'];
  const checkNormal = UnifiedTableService.detectSummaryRow(normalValues, canonicalCols);
  assert.strictEqual(checkNormal.isSummary, false);
});

// Test 9: Missing canonical cell -> placeholder/null, no fake ID
test('9. should ensure placeholder cells have id: null and isPlaceholder: true without fake DB IDs', () => {
  const canonicalTable = {
    id: 't-canon',
    pageNumber: 1,
    tableIndex: 1,
    columnCount: 5,
    headers: ['Ngày', 'Diễn giải', 'Số GD', 'Số tiền', 'Số dư'],
    rows: [
      {
        id: 'row-canon',
        isHeader: false,
        cells: [
          { id: 'c-c1', columnIndex: 0, rawValue: '01/01/2024' },
          { id: 'c-c2', columnIndex: 1, rawValue: 'Mo so tiet kiem' },
          { id: 'c-c3', columnIndex: 2, rawValue: 'REF999' },
          { id: 'c-c4', columnIndex: 3, rawValue: '5,000,000' },
          { id: 'c-c5', columnIndex: 4, rawValue: '10,000,000' },
        ],
      },
    ],
  };
  const sparseTable = {
    id: 't-sparse',
    pageNumber: 2,
    tableIndex: 1,
    columnCount: 4,
    headers: ['Ngày', 'Diễn giải', 'Số tiền', 'Số dư'],
    rows: [
      {
        id: 'row-sparse',
        isHeader: false,
        cells: [
          { id: 'c-real-1', columnIndex: 0, rawValue: '02/01/2024' },
          { id: 'c-real-2', columnIndex: 1, rawValue: 'Nap tien dien thoai' },
          { id: 'c-real-3', columnIndex: 2, rawValue: '50,000' },
          { id: 'c-real-4', columnIndex: 3, rawValue: '9,950,000' },
        ],
      },
    ],
  };

  const unified = UnifiedTableService.projectDocumentTables('doc-test-sparse', [canonicalTable, sparseTable]);
  assert.ok(unified !== null);
  const cells = unified!.rows[1].cells;
  assert.strictEqual(cells[0].id, 'c-real-1');
  assert.strictEqual(cells[1].id, 'c-real-2');
  assert.strictEqual(cells[2].id, null);
  assert.strictEqual(cells[2].isPlaceholder, true);
  assert.strictEqual(cells[3].id, 'c-real-3');
});

// Test 10 & 11: Source lineage & sourcePage preserved
test('10 & 11. should preserve exact physical cell IDs, row IDs, table IDs, and sourcePage', () => {
  const table = {
    id: 'table-uuid-123',
    pageNumber: 3,
    tableIndex: 2,
    columnCount: 4,
    headers: ['Ngày GD', 'Nội dung', 'Số tiền', 'Số dư'],
    rows: [
      {
        id: 'row-uuid-456',
        isHeader: false,
        cells: [
          { id: 'cell-uuid-789', columnIndex: 0, rawValue: '20/03/2024', confidence: 0.97 },
          { id: 'cell-uuid-888', columnIndex: 1, rawValue: 'Nhan tien chuyen khoan tu NGUYEN VAN B', confidence: 0.95 },
          { id: 'cell-uuid-990', columnIndex: 2, rawValue: '1,500,000', confidence: 0.96 },
          { id: 'cell-uuid-999', columnIndex: 3, rawValue: '12,000,000', confidence: 0.92 },
        ],
      },
    ],
  };

  const unified = UnifiedTableService.projectDocumentTables('doc-lineage', [table]);
  assert.ok(unified !== null);
  const row = unified!.rows[0];
  assert.strictEqual(row.sourceRowId, 'row-uuid-456');
  assert.strictEqual(row.sourceTableId, 'table-uuid-123');
  assert.strictEqual(row.sourcePage, 3);
  assert.strictEqual(row.cells[0].id, 'cell-uuid-789');
  assert.strictEqual(row.cells[0].rowId, 'row-uuid-456');
  assert.strictEqual(row.cells[0].tableId, 'table-uuid-123');
  assert.strictEqual(row.cells[0].sourcePage, 3);
  assert.strictEqual(row.cells[0].confidence, 0.97);
});

// Test 12: Multiple schema clusters -> detect multiple groups, do not force unsafe merge
test('12. should group separate transaction schemas into distinct clusters without unsafe mixing', () => {
  const depositTable = {
    id: 't-dep',
    pageNumber: 1,
    tableIndex: 1,
    rowCount: 10,
    columnCount: 8,
    headers: ['STT', 'Ngày GD', 'Diễn giải', 'Rút ra', 'Gửi vào', 'Số dư', 'Chi nhánh', 'Ký hiệu'],
    rows: Array(10).fill({ id: 'r', cells: [{ rawValue: '01/01/2024' }, { rawValue: '100,000' }] }),
  };

  const feeTable = {
    id: 't-fee',
    pageNumber: 2,
    tableIndex: 2,
    rowCount: 3,
    columnCount: 3,
    headers: ['Loại phí', 'Số tiền', 'VAT'],
    rows: Array(3).fill({ id: 'rf', cells: [{ rawValue: 'Phi duy tri' }, { rawValue: '11,000' }] }),
  };

  const groups = UnifiedTableService.groupCompatibleTables([depositTable, feeTable]);
  assert.ok(groups.length >= 1);
  assert.strictEqual(groups[0].tables[0].id, 't-dep');
});

// Test 13: Semantic column classification for REFERENCE headers (Positive and Negative cases)
test('13. should classify generic Vietnamese and English reference headers as REFERENCE without overmatching non-reference headers', () => {
  const positiveHeaders = [
    'SỐ GIAO DỊCH Transaction No',
    'Số giao dịch',
    'Mã giao dịch',
    'Transaction No',
    'Transaction Number',
    'Reference',
    'Reference No',
    'Reference Number',
    'Số tham chiếu',
    'Mã GD',
  ];

  for (const h of positiveHeaders) {
    const semanticType = UnifiedTableService.inferSemanticType(h, 1, 5, {});
    assert.strictEqual(
      semanticType,
      'REFERENCE',
      `Header "${h}" must be classified as REFERENCE, but got "${semanticType}"`
    );
  }

  const negativeHeaders = [
    { header: 'Nội dung giao dịch', notExpected: 'REFERENCE' },
    { header: 'Diễn giải', notExpected: 'REFERENCE' },
    { header: 'Transaction Description', notExpected: 'REFERENCE' },
    { header: 'Ngày giao dịch', notExpected: 'REFERENCE' },
    { header: 'Transaction Date', notExpected: 'REFERENCE' },
    { header: 'Số tiền giao dịch', notExpected: 'REFERENCE' },
    { header: 'Transaction Amount', notExpected: 'REFERENCE' },
    { header: 'Số dư', notExpected: 'REFERENCE' },
    { header: 'Balance', notExpected: 'REFERENCE' },
    { header: 'Teller Code', notExpected: 'REFERENCE' },
    { header: 'Người tạo', notExpected: 'REFERENCE' },
    { header: 'Account No', notExpected: 'REFERENCE' },
    { header: 'Số tài khoản', notExpected: 'REFERENCE' },
  ];

  for (const item of negativeHeaders) {
    const semanticType = UnifiedTableService.inferSemanticType(item.header, 1, 5, {});
    assert.notStrictEqual(
      semanticType,
      item.notExpected,
      `Header "${item.header}" must NOT be classified as ${item.notExpected}, but got "${semanticType}"`
    );
  }
});

console.log('All UnifiedTableService Unit Tests Passed Successfully!');

