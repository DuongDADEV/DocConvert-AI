import os, sys, requests, json
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()
url = os.getenv('SUPABASE_URL').rstrip('/')
key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
headers = {'apikey': key, 'Authorization': f'Bearer {key}'}

# Get profile
user_id = '27a10269-da23-4bfd-aa19-5ed66b974eff'
r = requests.get(f'{url}/rest/v1/profiles?id=eq.{user_id}', headers=headers)
profile = r.json()[0] if r.json() else None
print('Profile:', profile)

# Can we create a session for this user or generate a session token?
# Let's check auth admin API
auth_headers = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}
auth_url = f'{url}/auth/v1/admin/users/{user_id}'
r_user = requests.get(auth_url, headers=auth_headers)
user_data = r_user.json()
print('Auth user email:', user_data.get('email'))

# We can generate a token or sign in or update password to test123456
email = user_data.get('email')
# Update password for this test or generate link
r_link = requests.post(f'{url}/auth/v1/admin/generate_link', headers=auth_headers, json={
    'type': 'magiclink',
    'email': email
})
link_data = r_link.json()
print('Generate link data:', link_data.keys())

# Or we can simply sign in via verify otp with token_hash
token_hash = link_data.get('hashed_token')
if token_hash:
    r_session = requests.post(f'{url}/auth/v1/verify', headers={'apikey': key, 'Content-Type': 'application/json'}, json={
        'type': 'magiclink',
        'token_hash': token_hash
    })
    session_data = r_session.json()
    access_token = session_data.get('access_token')
    print('Got real Supabase access_token:', bool(access_token), access_token[:20] if access_token else '')

    if access_token:
        # Now call local Express server!
        doc_id = '70ec6614-ccdd-4326-b566-971a629e239c'
        res = requests.get(f'http://localhost:3000/api/documents/{doc_id}/ocr-result', headers={
            'Authorization': f'Bearer {access_token}'
        })
        print('HTTP GET /ocr-result status code:', res.status_code)
        resp_json = res.json()
        print('HTTP Response success:', resp_json.get('success'))
        u_tbl = resp_json.get('unifiedTransactionTable')
        print('HTTP Response unifiedTransactionTable:', bool(u_tbl))
        if u_tbl:
            print('Unified rows count:', len(u_tbl.get('rows', [])))
            # Find Case A, B, C in the HTTP JSON response!
            for r_idx, row in enumerate(u_tbl.get('rows', [])):
                for c in row.get('cells', []):
                    raw = c.get('rawValue')
                    if raw in ('919ZTRF242991500', '919ZTRF242991502', '9192hv6243011321'):
                        print(f"HTTP Cell in row {r_idx}: raw='{raw}', isReviewed={c.get('isReviewed')}, qa={c.get('qualityAssessment')}")
        with open('scratch/live_http_ocr_result.json', 'w', encoding='utf-8') as f:
            json.dump(resp_json, f, indent=2)
