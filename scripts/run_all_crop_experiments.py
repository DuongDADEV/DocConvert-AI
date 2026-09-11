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

    # 1. Submit with 429 retry
    res = None
    for sub_try in range(6):
        res = requests.post(url, headers=headers, data=data)
        if res.status_code == 429:
            time.sleep(4.0)
            continue
        break

    if not res or res.status_code not in (200, 202):
        return {'error': f'Submit failed: HTTP {res.status_code if res else "None"}', 'body': res.text if res else ''}

    op_loc = res.headers.get('Operation-Location')
    if not op_loc:
        return res.json()

    # 2. Poll with 429 retry
    poll_headers = {'Ocp-Apim-Subscription-Key': KEY}
    for attempt in range(30):
        time.sleep(3.0)
        poll_res = requests.get(op_loc, headers=poll_headers)
        if poll_res.status_code == 429:
            time.sleep(4.0)
            continue
        if poll_res.status_code != 200:
            continue
        body = poll_res.json()
        status = body.get('status')
        if status == 'succeeded':
            return body.get('analyzeResult', {})
        elif status in ('failed', 'canceled'):
            return {'error': f'Operation {status}', 'details': body}

    return {'error': 'Timed out polling Azure operation'}

def extract_ocr_result(analyze_res):
    if 'error' in analyze_res:
        return {'content': 'ERROR', 'confidence': 0.0, 'error': analyze_res['error']}
    content = analyze_res.get('content', '').strip().replace('\n', ' ')
    words = []
    for p in analyze_res.get('pages', []):
        for w in p.get('words', []):
            words.append(w)
    conf = words[0].get('confidence') if words else None
    return {
        'content': content,
        'confidence': conf,
        'word_count': len(words)
    }

def main():
    experiments = {}

    # 1. Repeatability test: Case A tight 300dpi x 3
    print('--- 1. Testing Same-Model Repeatability (Case A x 3) ---')
    repeat_results = []
    case_a_img = 'scratch/crops/case_A_tight_300dpi.png'
    for i in range(3):
        res = analyze_crop_azure(case_a_img, model_id='prebuilt-layout')
        parsed = extract_ocr_result(res)
        print(f'Run {i+1}: {parsed}')
        repeat_results.append(parsed)
        time.sleep(0.5)
    experiments['repeatability_case_a'] = repeat_results

    # 2. DPI & Crop Type Matrix
    print('\n--- 2. Testing DPI & Crop Type Matrix ---')
    cases = [
        {'id': 'A', 'gt': '919ZTRF2429915O0'},
        {'id': 'B', 'gt': '919ZTRF2429915O2'},
        {'id': 'C', 'gt': '9192hv6243011321'}
    ]
    dpis = [150, 200, 300, 400]
    crop_types = ['tight', 'medium']

    matrix_results = []
    for c in cases:
        cid = c['id']
        gt = c['gt']
        for ctype in crop_types:
            for dpi in dpis:
                img_path = f'scratch/crops/case_{cid}_{ctype}_{dpi}dpi.png'
                if not os.path.exists(img_path):
                    continue
                res = analyze_crop_azure(img_path, model_id='prebuilt-layout')
                parsed = extract_ocr_result(res)
                item = {
                    'case': cid,
                    'gt': gt,
                    'dpi': dpi,
                    'crop_type': ctype,
                    'ocr_content': parsed['content'],
                    'confidence': parsed['confidence'],
                    'gt_match': parsed['content'] == gt
                }
                print(f"Case {cid} | {ctype} | {dpi}DPI -> '{parsed['content']}' (conf: {parsed['confidence']}) [Match GT: {item['gt_match']}]")
                matrix_results.append(item)
                time.sleep(0.5)
    experiments['dpi_crop_matrix'] = matrix_results

    # 3. Alternative Model Test: prebuilt-read
    print('\n--- 3. Testing Alternative Model: prebuilt-read ---')
    alt_results = []
    for c in cases:
        cid = c['id']
        gt = c['gt']
        img_path = f'scratch/crops/case_{cid}_tight_300dpi.png'
        res = analyze_crop_azure(img_path, model_id='prebuilt-read')
        parsed = extract_ocr_result(res)
        item = {
            'case': cid,
            'gt': gt,
            'model': 'prebuilt-read',
            'ocr_content': parsed['content'],
            'confidence': parsed['confidence'],
            'gt_match': parsed['content'] == gt
        }
        print(f"Case {cid} (prebuilt-read) -> '{parsed['content']}' (conf: {parsed['confidence']}) [Match GT: {item['gt_match']}]")
        alt_results.append(item)
        time.sleep(0.5)
    experiments['alt_model_read'] = alt_results

    with open('scratch/q2d1_crop_experiments.json', 'w', encoding='utf-8') as f:
        json.dump(experiments, f, indent=2)
    print('\nExperiments complete! Saved to scratch/q2d1_crop_experiments.json')

if __name__ == '__main__':
    main()
