import os, sys, requests, json
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()

url = os.getenv('SUPABASE_URL').rstrip('/')
key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
auth_headers = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}

user_id = '27a10269-da23-4bfd-aa19-5ed66b974eff'
auth_url = f'{url}/auth/v1/admin/users/{user_id}'
r_user = requests.get(auth_url, headers=auth_headers)
user_data = r_user.json()
email = user_data.get('email')

r_link = requests.post(f'{url}/auth/v1/admin/generate_link', headers=auth_headers, json={
    'type': 'magiclink',
    'email': email
})
link_data = r_link.json()
token_hash = link_data.get('hashed_token')

r_session = requests.post(f'{url}/auth/v1/verify', headers={'apikey': key, 'Content-Type': 'application/json'}, json={
    'type': 'magiclink',
    'token_hash': token_hash
})
session_data = r_session.json()
access_token = session_data.get('access_token')

if not access_token:
    print('ERROR: Failed to obtain access token')
    sys.exit(1)

doc_id = '70ec6614-ccdd-4326-b566-971a629e239c'
res = requests.get(f'http://localhost:3000/api/documents/{doc_id}/ocr-result', headers={
    'Authorization': f'Bearer {access_token}'
})

if res.status_code != 200:
    print(f'ERROR: HTTP status {res.status_code}: {res.text}')
    sys.exit(1)

resp_json = res.json()
u_tbl = resp_json.get('unifiedTransactionTable', {})
columns = u_tbl.get('columns', [])
rows = u_tbl.get('rows', [])

print('=== UNIFIED TABLE COLUMNS ===')
for idx, col in enumerate(columns):
    print(f"Col {idx}: header='{col.get('header')}', normalized='{col.get('normalizedHeader')}', semanticType='{col.get('semanticType')}'")

target_cases = {
    '919ZTRF242991500': {'name': 'Case A', 'ground_truth': '919ZTRF2429915O0'},
    '919ZTRF242991502': {'name': 'Case B', 'ground_truth': '919ZTRF2429915O2'},
    '9192hv6243011321': {'name': 'Case C', 'ground_truth': '9192hv6243011321'},
}

found = {}
for r_idx, row in enumerate(rows):
    for c in row.get('cells', []):
        raw = c.get('rawValue')
        if raw in target_cases:
            col_idx = c.get('canonicalColumnIndex')
            col_sem = columns[col_idx].get('semanticType') if col_idx is not None and col_idx < len(columns) else 'UNKNOWN'
            found[raw] = {
                'case': target_cases[raw]['name'],
                'ground_truth': target_cases[raw]['ground_truth'],
                'ocr': raw,
                'col_idx': col_idx,
                'col_header': columns[col_idx].get('header') if col_idx is not None else 'N/A',
                'semanticType': col_sem,
                'confidence': c.get('confidence'),
                'qa': c.get('qualityAssessment'),
                'isReviewed': c.get('isReviewed', False),
            }

print('\n=== LIVE HTTP VALIDATION RESULTS ===')
for raw, info in target_cases.items():
    res_data = found.get(raw)
    if not res_data:
        print(f"NOT FOUND: {raw}")
        continue
    qa = res_data['qa'] or {}
    severity = qa.get('severity', 'PASS')
    reasons = qa.get('reasons', [])
    review_worthy = severity in ('WARNING', 'CRITICAL')
    print(f"\n[{res_data['case']}]")
    print(f"  Ground Truth: {res_data['ground_truth']}")
    print(f"  OCR:          {res_data['ocr']}")
    print(f"  Column:       {res_data['col_idx']} ({res_data['col_header']})")
    print(f"  SemanticType: {res_data['semanticType']}")
    print(f"  Confidence:   {res_data['confidence']}")
    print(f"  Severity:     {severity}")
    print(f"  Reasons:      {reasons}")
    print(f"  isReviewed:   {res_data['isReviewed']}")
    print(f"  Review-worthy:{review_worthy}")
