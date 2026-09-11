import json, sys
sys.stdout.reconfigure(encoding='utf-8')

with open('scratch/live_http_ocr_result.json', encoding='utf-8') as f:
    d = json.load(f)

ut = d.get('unifiedTransactionTable')
if not ut:
    print('No unifiedTransactionTable!')
    exit(0)

print('Columns:')
for c in ut['columns']:
    print(f"  [{c['canonicalColumnIndex']}] {c['header']} -> {c['semanticType']}")

r51 = ut['rows'][51]
print(f"\nRow 51 (displayRowIndex: {r51['displayRowIndex']}):")
for c in r51['cells']:
    print(f"  Col {c['canonicalColumnIndex']}: raw='{c['rawValue']}', conf={c['confidence']}, isReviewed={c.get('isReviewed')}")
    print(f"       qualityAssessment: {c.get('qualityAssessment')}")

print(f"\nAll rows where qualityAssessment.severity != 'PASS':")
for r_idx, r in enumerate(ut['rows']):
    for c in r['cells']:
        qa = c.get('qualityAssessment')
        if qa and qa.get('severity') != 'PASS':
            print(f"  Row {r_idx} Col {c['canonicalColumnIndex']}: '{c['rawValue']}' -> {qa.get('severity')} {qa.get('reasons')}")
