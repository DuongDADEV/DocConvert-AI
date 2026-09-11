import os, time, json, requests
from dotenv import load_dotenv

load_dotenv()
ENDPOINT = os.getenv('AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', '').rstrip('/')
KEY = os.getenv('AZURE_DOCUMENT_INTELLIGENCE_KEY', '')

def analyze_crop_azure(image_path, model_id='prebuilt-layout', api_version='2024-11-30'):
    url = f"{ENDPOINT}/documentintelligence/documentModels/{model_id}:analyze?api-version={api_version}"
    headers = {
        'Ocp-Apim-Subscription-Key': KEY,
        'Content-Type': 'image/png'
    }
    with open(image_path, 'rb') as f:
        data = f.read()

    # 1. Submit
    res = requests.post(url, headers=headers, data=data)
    if res.status_code not in (200, 202):
        return {'error': f'Submit failed: HTTP {res.status_code}', 'body': res.text}

    op_loc = res.headers.get('Operation-Location')
    if not op_loc:
        # synchronous
        return res.json()

    # 2. Poll
    poll_headers = {'Ocp-Apim-Subscription-Key': KEY}
    for attempt in range(20):
        time.sleep(1.0)
        poll_res = requests.get(op_loc, headers=poll_headers)
        if poll_res.status_code != 200:
            continue
        body = poll_res.json()
        status = body.get('status')
        if status == 'succeeded':
            return body.get('analyzeResult', {})
        elif status in ('failed', 'canceled'):
            return {'error': f'Operation {status}', 'details': body}

    return {'error': 'Timed out polling Azure operation'}

def summarize_result(analyze_result):
    if 'error' in analyze_result:
        return {'error': analyze_result['error']}
    content = analyze_result.get('content', '').strip()
    words = []
    for p in analyze_result.get('pages', []):
        for w in p.get('words', []):
            words.append({
                'content': w.get('content'),
                'confidence': w.get('confidence'),
                'span': w.get('span'),
                'polygon': w.get('polygon')
            })
    return {
        'raw_content': content,
        'word_count': len(words),
        'words': words
    }

if __name__ == '__main__':
    print('Testing Azure Crop OCR Feasibility...')
    test_path = 'scratch/crops/case_A_tight_300dpi.png'
    raw = analyze_crop_azure(test_path, model_id='prebuilt-layout')
    summary = summarize_result(raw)
    print('Test crop output:', summary)
    with open('scratch/test_crop_raw_azure.json', 'w', encoding='utf-8') as f:
        json.dump(raw, f, indent=2)
