import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scratch/real_api_response.json', 'utf-8'));
console.log('Success:', data.success);
console.log('Error:', data.error);
console.log('Tables:', data.tables?.length);
console.log('Metadata:', data.documentMetadata?.length);
const u = data.unifiedTransactionTable;
console.log('unifiedTransactionTable exists:', Boolean(u));
if (u) {
  console.log('  columns:', u.columns?.length);
  console.log('  headers:', u.headers?.length);
  console.log('  rows:', u.rows?.length);
  console.log('  summaryRows:', u.summaryRows?.length);
  console.log('  row 0 cells:', u.rows?.[0]?.cells?.length);
  console.log('  row 0 sample cell:', {
    idPresent: Boolean(u.rows?.[0]?.cells?.[0]?.id),
    canColIdx: u.rows?.[0]?.cells?.[0]?.canonicalColumnIndex,
    raw: u.rows?.[0]?.cells?.[0]?.rawValue,
    norm: u.rows?.[0]?.cells?.[0]?.normalizedValue,
    isRev: u.rows?.[0]?.cells?.[0]?.isReviewed
  });
  console.log('  row 1 sample cell:', {
    idPresent: Boolean(u.rows?.[1]?.cells?.[0]?.id),
    canColIdx: u.rows?.[1]?.cells?.[0]?.canonicalColumnIndex,
    raw: u.rows?.[1]?.cells?.[0]?.rawValue,
    norm: u.rows?.[1]?.cells?.[0]?.normalizedValue,
    isRev: u.rows?.[1]?.cells?.[0]?.isReviewed
  });
}
