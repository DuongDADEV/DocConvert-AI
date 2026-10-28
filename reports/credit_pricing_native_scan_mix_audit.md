# Báo Cáo Kiểm Toán Định Giá Credit: Native / Scan / Mix — DocConvert AI
**Audit Codebase: DocConvert AI (Phase 3A / 3B / 3C Production Baseline)**  
**Auditor Roles:** Senior Backend Engineer, Billing Engineer, Pricing Consistency Auditor  
**Mode:** READ-ONLY Verification  
**Audit Target Path:** `reports/credit_pricing_native_scan_mix_audit.md`  

---

## 1. Executive Summary

Hệ thống định giá và hạch toán tín dụng (Credit Pricing & Ledger System) của DocConvert AI đã trải qua quá trình tái cấu trúc sâu rộng qua các giai đoạn Phase 2A/2B (Credit Ledger & Reservation Foundation), Phase 3A (Processing Pricing Engine & Policy Separation), Phase 3B (Atomic Reserve Before Processing Queue), và Phase 3C (Worker Settlement & Idempotent Capture/Release).

Mục tiêu của cuộc kiểm toán này là xác định **chính xác hiện trạng triển khai kỹ thuật** đối với 3 phân loại tài liệu chính: **Native Text (PDF văn bản số)**, **Scanned (PDF ảnh quét)**, và **Mixed (PDF hỗn hợp văn bản và hình ảnh/bảng biểu)**.

### Kết Luận Cốt Lõi
- **Phiên bản định giá chuẩn (Source of Truth):** `processing-pricing-v1` (tách biệt hoàn toàn với catalog thương mại `pricing-v1`).
- **Đơn vị tài chính:** BigInt an toàn (`credit_units`), quy ước $1\text{ Credit} = 1,000\text{ credit\_units}$. Nghiêm cấm lưu trữ Float trong DB và logic tài chính.
- **Mô hình định giá cho Mixed PDF:** Định giá **theo từng trang dựa trên Processing Strategy do Processing Decision Engine (PDE) chỉ định**, kết hợp chính sách **hấp thụ 100% chi phí chuyển tiếp dự phòng (Fallback Absorption)** và **miễn phí kiểm định chất lượng (Free Secondary OCR QA)** trong MVP.
- **Kết luận kiểm toán:** **`IMPLEMENTATION HAS GAPS`**. Mặc dù lõi thanh toán `ProcessingPricingEngine` và hạ tầng DB RPC `reserve_credit_units` / `capture_credit_reservation` / `release_credit_reservation` được thiết kế chặt chẽ và đạt chuẩn tài chính cao (fail-closed, idempotent, safe-integer), hệ thống hiện đang tồn tại **sự đứt gãy nghiêm trọng (disconnect)** giữa ước tính Preflight ban đầu ở Frontend (`1 trang = 1 Credit`) với bảng giá thực tế của Backend (`0.35 Credit/trang Native` vs `1.98 Credit/trang Scan/Mix`), cùng với sự tồn tại song song chưa đồng bộ giữa hạn mức tài liệu cũ (`document_quota`) và hệ thống tín dụng per-page.

---

## 2. Actual Implemented Pricing Matrix

Bảng ma trận định giá thực tế được trích xuất trực tiếp từ mã nguồn triển khai (`server/types/processingPricing.ts`, `server/services/credit/processingPricingEngine.ts`, `server/services/pde/ProcessingDecisionEngine.ts`, `supabase/migrations/`):

| Chiều Đánh Giá (Dimension) | Native Text | Scanned | Mixed | Ghi Chú Kỹ Thuật & Bằng Chứng |
| :--- | :--- | :--- | :--- | :--- |
| **Phân loại trang (Page Classification)** | `NATIVE_TEXT` | `SCANNED` | `MIXED` | `preflightService.ts:405-452`<br>`charCount >= 150`, `imgCoverage <= 0.25` (Native); `hasFullImg` hoặc `imgCoverage >= 0.60` (Scanned); cả hai đồng thời tồn tại (Mixed). |
| **Chiến lược xử lý PDE (Processing Strategy)** | `LOCAL_NATIVE` (Fallback: `AZURE_FALLBACK`) | `AZURE_FULL_PAGE` (Fallback: `undefined`) | `HYBRID` (Fallback: `AZURE_FULL_PAGE`) | `ProcessingDecisionEngine.ts:49-81`<br>UNCERTAIN giải quyết qua `resolveSecondPass`. |
| **Base Credit per page (credit_units)** | **350 units** (0.350 Credit) | **1,980 units** (1.980 Credits) | **1,980 units** (1.980 Credits) | `processingPricing.ts:32-38`<br>`CANONICAL_APPROVED_PRODUCTION_POLICY_V1` |
| **Phụ phí Azure OCR (Azure Surcharge)** | **0 units** (bao gồm trong base hoặc absorbed) | **0 units** (đã gộp trong base 1,980) | **0 units** (đã gộp trong base 1,980) | `processingPricing.ts:50-54`<br>Không tính thêm phí ngoại vi. |
| **Phụ phí Secondary OCR (QA)** | **0 units** | **0 units** | **0 units** | `processingPricing.ts:56`<br>`secondaryOcrPerCell: 0` (miễn phí QA trong MVP). |
| **Phụ phí tái dựng bảng (Table Reconstruction)** | **0 units** | **0 units** | **0 units** | Tích hợp sẵn trong engine bóc tách. |
| **Phụ phí phân tích vùng (Region Analysis)** | **0 units** | **0 units** | **0 units** (gộp trong HYBRID) | `processingPricing.ts:57`<br>`regionAnalysisPerPage: 0`. |
| **Công thức ước tính Preflight (Preflight Formula)** | **1,000 units/trang** (1.000 Credit/trang) *(Heuristic cũ)* | **1,000 units/trang** (1.000 Credit/trang) *(Heuristic cũ)* | **1,000 units/trang** (1.000 Credit/trang) *(Heuristic cũ)* | `preflightService.ts:70, 280`<br>`CREDITS_PER_PAGE: 1`<br>**Lệch với backend pricing!** |
| **Công thức Quoting / Eligibility của Backend** | $\sum (\text{pages} \times 350)$ units | $\sum (\text{pages} \times 1,980)$ units | $\sum_{\text{native}} 350 + \sum_{\text{scanned/mixed}} 1,980$ units | `processingPricingEngine.ts:77-245`<br>Gọi PDE `evaluatePage` cho từng trang. |
| **Công thức Reservation** | `p_estimated_units` (được tính từ Backend Quote) | `p_estimated_units` (được tính từ Backend Quote) | `p_estimated_units` (được tính từ Backend Quote) | `documents.ts:436-447`<br>`confirm_document_processing` RPC. |
| **Công thức Capture khi thành công** | `outstandingReservedUnits` (= `estimated_billable_units`) | `outstandingReservedUnits` (= `estimated_billable_units`) | `outstandingReservedUnits` (= `estimated_billable_units`) | `ocrWorker.ts:544, 563-575`<br>Khóa đúng số lượng đã giữ trước. |
| **Hành vi khi Thất Bại (Failure / Release)** | Release toàn bộ số units đang giữ (LIFO) | Release toàn bộ số units đang giữ (LIFO) | Release toàn bộ số units đang giữ (LIFO) | `ocrWorker.ts:686-698`<br>`release_credit_reservation` RPC. |
| **Phiên bản & Snapshot Định Giá** | `processing-pricing-v1` | `processing-pricing-v1` | `processing-pricing-v1` | Lưu tại `processing_jobs.pricing_version`, `quote_snapshot`, `credit_reservations.metadata`. |

### Phân Định Cơ Chế Định Giá Cho Mixed PDF
Đối với tài liệu Mixed (chứa cả trang Native và trang Quét/Hỗn hợp):
1. **Định giá theo toàn bộ tài liệu (Pricing by Document):** **KHÔNG SỬ DỤNG**. Hệ thống không áp dụng đơn giá cào bằng cho toàn bộ file PDF (trừ heuristic hiển thị tạm thời của Preflight). Phí cơ sở tài liệu `documentBaseUnits = 0`, phí tối thiểu `minDocumentChargeUnits = 0`.
2. **Định giá theo phân loại trang (Pricing by Page Classification):** **GIÁN TIẾP**. Phân loại Preflight (`NATIVE_TEXT`, `SCANNED`, `MIXED`, `UNCERTAIN`) là đầu vào cho PDE.
3. **Định giá theo chiến lược xử lý thực tế (Pricing by Processing Strategy):** **MÔ HÌNH THỰC TẾ ĐANG ÁP DỤNG (AUTHORITATIVE IMPLEMENTATION)**.
   - Mỗi trang được PDE gán chiến lược: `LOCAL_NATIVE` (350 units), `AZURE_FULL_PAGE` (1,980 units), `HYBRID` (1,980 units).
   - Tổng chi phí ước tính và giữ chỗ là tổng cộng dồn của từng trang:
     $$\text{Total Units} = \sum_{i=1}^{N} \text{Rate}(\text{Strategy}_i)$$
4. **Định giá theo số lượng cuộc gọi OCR bổ sung hoặc Fallback:**
   - **AZURE_FALLBACK:** Khi trang `LOCAL_NATIVE` gặp lỗi cấu trúc bảng và phải chuyển tiếp sang Azure Document Intelligence, phụ phí là **0 units** (DocConvert AI hấp thụ toàn bộ chi phí phát sinh). Trang đó vẫn chỉ bị tính 350 units theo hợp đồng khách hàng (`processingPricingEngine.ts:288-292`, `processingPricing.ts:37`).
   - **SECONDARY_OCR:** Khi hệ thống chạy nhận diện quang học bổ sung cho các ô bảng bị nghi ngờ (Phase 7 Targeted Secondary OCR), phụ phí là **0 units** (`secondaryOcrPerCell = 0`).

---

## 3. Source-of-Truth Pricing Configuration

### 3.1. Hằng Số và Cấu Hình Chính Sách
Nguồn chân lý duy nhất (Single Source of Truth) về giá xử lý tài liệu nằm tại:
- **File:** [server/types/processingPricing.ts](file:///e:/App%20Scan%20PDF/docconvert-ai/server/types/processingPricing.ts#L16-L61)
- **File:** [server/services/credit/processingPricingPolicyProvider.ts](file:///e:/App%20Scan%20PDF/docconvert-ai/server/services/credit/processingPricingPolicyProvider.ts#L43-L105)

Các giá trị cấu hình chính thức:
```typescript
export const CANONICAL_PROCESSING_PRICING_VERSION = 'processing-pricing-v1';
export const CREDIT_UNIT_SCALE = 1000; // 1 credit = 1000 credit_units

export const PRODUCTION_PROCESSING_RATES = {
  LOCAL_NATIVE: 350,       // 0.35 credit / page
  AZURE_FULL_PAGE: 1980,   // 1.98 credit / page
  HYBRID: 1980,            // 1.98 credit / page
  LOCAL_RECHECK: 0,        // included / no incremental charge
  AZURE_FALLBACK: 0,       // absorbed by DocConvert AI in MVP
} as const;

export const CANONICAL_APPROVED_PRODUCTION_POLICY_V1: ProcessingPricingPolicy = Object.freeze({
  processingPricingVersion: 'processing-pricing-v1',
  unitScale: 1000,
  currency: 'CREDIT',
  isApprovedProductionPolicy: true,
  strategyRates: {
    LOCAL_NATIVE: 350,
    AZURE_FULL_PAGE: 1980,
    HYBRID: 1980,
    LOCAL_RECHECK: 0,
    AZURE_FALLBACK: 0,
  },
  additionalRates: {
    secondaryOcrPerCell: 0,   // included QA cost in MVP
    regionAnalysisPerPage: 0, // included in HYBRID
    documentBaseUnits: 0,
  },
  minDocumentChargeUnits: 0,  // NONE in MVP
});
```

### 3.2. Không Gian Tên (Namespace Isolation)
- Hệ thống áp dụng kiểm tra nghiêm ngặt ngăn chặn nhầm lẫn namespace:
  - Catalog bảng giá thương mại (Subscription plans, Credit packs): `pricing-v1` ([server/types/billing.ts](file:///e:/App%20Scan%20PDF/docconvert-ai/server/types/billing.ts)).
  - Bảng giá xử lý OCR (Processing pricing): `processing-pricing-v1` ([server/types/processingPricing.ts:16](file:///e:/App%20Scan%20PDF/docconvert-ai/server/types/processingPricing.ts#L16)).
  - Nếu bất kỳ cấu hình nào sử dụng nhãn `pricing-v1` cho xử lý, hàm `validateProcessingPricingPolicy` lập tức ném lỗi `PRICING_NAMESPACE_COLLISION` ([server/services/credit/processingPricingPolicyProvider.ts:35-43](file:///e:/App%20Scan%20PDF/docconvert-ai/server/services/credit/processingPricingPolicyProvider.ts#L35-L43)).

### 3.3. Cơ Chế Fail-Closed
Nếu chính sách sản xuất chưa được kích hoạt (`isApprovedProductionPolicy: false` hoặc `null`), engine từ chối tính giá và trả về mã lỗi `PROCESSING_PRICING_NOT_CONFIGURED` ([server/services/credit/processingPricingPolicyProvider.ts:127-134](file:///e:/App%20Scan%20PDF/docconvert-ai/server/services/credit/processingPricingPolicyProvider.ts#L127-L134)). Trong runtime hiện tại, `processingPricingPolicyProvider` được khởi tạo với tham số `autoActivateApproved = true` ([server/services/credit/processingPricingPolicyProvider.ts:234](file:///e:/App%20Scan%20PDF/docconvert-ai/server/services/credit/processingPricingPolicyProvider.ts#L234)), do đó `CANONICAL_APPROVED_PRODUCTION_POLICY_V1` đang kích hoạt mặc định.

---

## 4. Preflight → PDE → Reservation → Capture/Release Flow

Dưới đây là luồng thực thi end-to-end từ lúc người dùng tải file lên cho tới khi quyết toán tài chính:

```
+----------------------------------------------------------------------------------------------------+
| 1. UPLOAD (POST /api/documents/upload)                                                             |
|    - Lưu file vào Supabase Storage (bucket: documents)                                             |
|    - Chạy PreflightService.analyzeDocument (pdfjs-dist local inspection)                          |
|    - Phân loại trang: NATIVE_TEXT, SCANNED, MIXED, UNCERTAIN                                       |
|    - Tạo document_pages records (lưu text_char_count, coverage, has_full_page_image)               |
|    - [GAP]: Trả về preflight.estimatedCredits = pageCount * 1 (Heuristic CREDITS_PER_PAGE: 1)     |
|    - Document status = 'WAITING_CONFIRMATION'. Quota/Credits CHƯA BỊ TRỪ.                          |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
| 2. ELIGIBILITY / QUOTE (POST /api/documents/:id/processing-eligibility)                            |
|    - processingEligibilityService.evaluateProcessingEligibility(userId, docId)                     |
|    - Đọc document_pages từ DB -> dựng ProcessingPricingInput                                       |
|    - Gọi processingPricingEngine.estimateProcessingCost                                            |
|        -> Với mỗi trang, gọi PDE evaluatePage (tính preferredStrategy & baseRate)                  |
|        -> sumPageUnits = SUM(strategyRates)                                                        |
|        -> estimatedUnits (BigInt safe integer), estimatedCredits = units / 1000                    |
|    - Kiểm tra số dư: totalAvailableUnits >= estimatedUnits                                         |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
| 3. CONFIRM & ATOMIC RESERVE (POST /api/documents/:id/process)                                      |
|    - Backend tái tính toán Quote có thẩm quyền (Server-side authoritative quote)                    |
|    - Gọi PostgreSQL RPC: confirm_document_processing (Atomic Transaction)                          |
|        -> Khóa bản ghi documents (FOR UPDATE), kiểm tra trạng thái WAITING_CONFIRMATION            |
|        -> Khóa profiles, kiểm tra & tăng used_documents (+1 document quota)                        |
|        -> Sinh jobId UUID                                                                          |
|        -> Gọi reserve_credit_units(p_user_id, p_estimated_units, idempotencyKey)                   |
|             * Khóa credit_accounts, kiểm tra trạng thái (ACTIVE)                                  |
|             * Duyệt credit_grants theo thứ tự ưu tiên (expires_at ASC NULLS LAST, granted_at ASC)   |
|             * Tăng grant.reserved_units, tạo credit_reservations & allocations                     |
|        -> Tạo processing_jobs (status: QUEUED, ghi quote_snapshot & reservation_id)                |
|        -> Cập nhật documents (status: QUEUED)                                                      |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
| 4. WORKER PROCESSING (ocrWorker.ts & ProcessingExecutor.ts)                                        |
|    - Kiểm tra tính hợp lệ của reservation (getActiveReservationForJob)                             |
|    - Chạy PDE buildProcessingPlan -> xác định danh sách trang cục bộ vs Azure                      |
|    - Thực thi:                                                                                     |
|        * Trang LOCAL_NATIVE: bóc tách bằng pdfjs-dist. Nếu lỗi bảng -> kích hoạt AZURE_FALLBACK    |
|        * Trang SCANNED / HYBRID / FALLBACK: cắt sub-PDF gửi Azure Document Intelligence            |
|    - Kiểm định cấu trúc ValidationEngine -> Nếu cần, chạy Secondary OCR (0 extra charge)           |
|    - Đạt điểm kiểm soát tài chính: lưu job.status = 'VALIDATING_RESULT'                            |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
| 5. SETTLEMENT (Capture hoặc Release)                                                               |
|    [TRƯỜNG HỢP THÀNH CÔNG (READY / REVIEW_REQUIRED)]                                               |
|    - Kiểm tra invariant: released_units == 0 && outstanding == expectedUnits                       |
|    - Gọi captureReservation(captureUnits = outstandingReservedUnits)                               |
|        -> Gọi RPC capture_credit_reservation:                                                      |
|             * Trừ grant.remaining_units, trừ grant.reserved_units                                  |
|             * Ghi credit_ledger (entry_type: 'CAPTURE', delta_units: -captureUnits)                |
|             * Chuyển reservation.status = 'CAPTURED'                                               |
|    - Cập nhật job.status = READY / REVIEW_REQUIRED, document.status = finalStatus                  |
|                                                                                                    |
|    [TRƯỜNG HỢP THẤT BẠI HOÀN TOÀN (Terminal Failure sau 3 lần retry)]                              |
|    - Gọi releaseReservation(releaseUnits = outstandingReservedUnits)                               |
|        -> Gọi RPC release_credit_reservation:                                                      |
|             * Trừ grant.reserved_units theo thứ tự LIFO (trả lại hạn mức khả dụng cho user)         |
|             * Chuyển reservation.status = 'RELEASED'                                               |
|             * KHÔNG ghi debit vào credit_ledger                                                    |
|    - [GAP]: used_documents (document quota) KHÔNG ĐƯỢC HOÀN LẠI!                                    |
|    - Cập nhật job.status = 'FAILED', document.status = 'FAILED'                                     |
+----------------------------------------------------------------------------------------------------+
```

---

## 5. Trace Representative Examples

Dưới đây là bảng tính chi tiết 6 kịch bản đại diện dựa trên các công thức triển khai thực tế trong mã nguồn:

### Ví Dụ 1: 10-page Native Text PDF
- **Cấu trúc trang:** 10 trang được phân loại `NATIVE_TEXT`.
- **Preflight UI Estimate (`preflightService.ts`):**
  $$\text{Credits} = 10 \times 1 = 10.000\text{ Credits}$$
- **Authoritative Backend Quote (`ProcessingPricingEngine`):**
  - Chiến lược PDE: 10 trang `LOCAL_NATIVE`.
  - Đơn giá: 350 credit_units/trang.
  - Tổng units: $10 \times 350 = 3,500\text{ credit\_units} = 3.500\text{ Credits}$.
  - Độ tin cậy: `HIGH`.
- **Reservation (`confirm_document_processing`):**
  - Giữ chỗ: $3,500\text{ credit\_units}$.
  - Trừ hạn mức gói: 1 document quota.
- **Thực thi:** 10 trang bóc tách thành công qua `LocalPdfExtractor`.
- **Quyết toán (Capture):**
  - Capture: $3,500\text{ credit\_units}$.
  - Release: $0\text{ units}$.
  - Trạng thái cuối: Trừ $3.500\text{ Credits}$, trừ 1 document quota.

---

### Ví Dụ 2: 10-page Scanned PDF
- **Cấu trúc trang:** 10 trang được phân loại `SCANNED`.
- **Preflight UI Estimate (`preflightService.ts`):**
  $$\text{Credits} = 10 \times 1 = 10.000\text{ Credits}$$
- **Authoritative Backend Quote (`ProcessingPricingEngine`):**
  - Chiến lược PDE: 10 trang `AZURE_FULL_PAGE`.
  - Đơn giá: 1,980 credit_units/trang.
  - Tổng units: $10 \times 1,980 = 19,800\text{ credit\_units} = 19.800\text{ Credits}$.
  - Độ tin cậy: `HIGH`.
- **Reservation:**
  - Giữ chỗ: $19,800\text{ credit\_units}$.
  - Trừ hạn mức gói: 1 document quota.
- **Thực thi:** 10 trang gửi tới Azure AI Document Intelligence (`prebuilt-layout`).
- **Quyết toán (Capture):**
  - Capture: $19,800\text{ credit\_units}$.
  - Release: $0\text{ units}$.
  - Trạng thái cuối: Trừ $19.800\text{ Credits}$, trừ 1 document quota.

---

### Ví Dụ 3: 10-page Mixed PDF (6 Native + 4 Scanned)
- **Cấu trúc trang:** 6 trang `NATIVE_TEXT`, 4 trang `SCANNED`.
- **Preflight UI Estimate (`preflightService.ts`):**
  $$\text{Credits} = 10 \times 1 = 10.000\text{ Credits}$$
- **Authoritative Backend Quote (`ProcessingPricingEngine`):**
  - Chiến lược PDE: 6 trang `LOCAL_NATIVE`, 4 trang `AZURE_FULL_PAGE`.
  - Chi phí 6 trang Native: $6 \times 350 = 2,100\text{ units}$.
  - Chi phí 4 trang Scanned: $4 \times 1,980 = 7,920\text{ units}$.
  - Tổng units: $2,100 + 7,920 = 10,020\text{ credit\_units} = 10.020\text{ Credits}$.
  - Độ tin cậy: `HIGH`.
- **Reservation:**
  - Giữ chỗ: $10,020\text{ credit\_units}$.
  - Trừ hạn mức gói: 1 document quota.
- **Thực thi:** 6 trang bóc tách cục bộ, 4 trang tạo sub-PDF gửi Azure Document Intelligence.
- **Quyết toán (Capture):**
  - Capture: $10,020\text{ credit\_units}$.
  - Release: $0\text{ units}$.
  - Trạng thái cuối: Trừ $10.020\text{ Credits}$, trừ 1 document quota.

---

### Ví Dụ 4: Mixed PDF với Kích Hoạt OCR Fallback & Secondary OCR
- **Cấu hình:** File 10 trang (6 Native, 4 Scanned) như Ví dụ 3.
- **Báo giá & Giữ chỗ:**
  - Reserved: $10,020\text{ credit\_units}$ (10.020 Credits).
- **Diễn biến lúc chạy (Runtime):**
  - Trang 2 (ban đầu là `LOCAL_NATIVE`) bị lỗi cấu trúc bảng (số cột < 2) -> Kích hoạt `AZURE_FALLBACK`.
  - Worker cắt sub-PDF gồm 5 trang (trang 2, 7, 8, 9, 10) gửi Azure AI.
  - Khâu Validation phát hiện 12 ô nghi ngờ -> Kích hoạt Secondary OCR (Phase 7).
- **Hạch toán chi phí billable khách hàng (`calculateBillableUsage`):**
  - Trang 2: Chiến lược billable vẫn giữ nguyên là `LOCAL_NATIVE` (350 units).
  - Phụ phí `AZURE_FALLBACK`: **0 units** (DocConvert AI hấp thụ).
  - Phụ phí Secondary OCR 12 ô: **0 units** (`secondaryOcrPerCell: 0`).
  - Total Billable Units: $10,020\text{ units}$.
  - Technical Telemetry ghi nhận: `azureExecutedPageCount = 5`, `fallbackPageCount = 1`, `secondaryOcrCellCount = 12`.
- **Quyết toán (Capture):**
  - Capture: $10,020\text{ credit\_units}$.
  - Khách hàng không bị phụ thu bất kỳ khoản nào.
  - Trạng thái cuối: Trừ đúng $10.020\text{ Credits}$ đã cam kết.

---

### Ví Dụ 5: Tài Liệu Có Sự Khác Biệt Giữa Preflight và Chiến Lược PDE Thực Tế
- **Trường hợp A: Trang `UNCERTAIN` ở Preflight**
  - Trang 1 phân tích Preflight chưa rõ ràng -> phân loại `UNCERTAIN`.
  - Khi tính Quote, PDE `evaluatePage` gọi `resolveSecondPass(page)`:
    - Nếu tín hiệu: `charCount = 120`, `imageCoverage = 0.15` -> Phân giải thành `LOCAL_NATIVE` (350 units).
    - Confidence: `CONDITIONAL_ESTIMATE`.
  - Báo giá & Reservation: Giữ $350\text{ units}$.
  - Khi worker chạy, `buildProcessingPlan` chạy cùng hàm logic `evaluatePage` với cùng tín hiệu -> Phân giải ra `LOCAL_NATIVE`.
  - Quyết toán: Capture đúng $350\text{ units}$.
- **Trường hợp B: File lịch sử không có bản ghi `document_pages`**
  - Quote: Backend coi toàn bộ trang là `UNCERTAIN` với tín hiệu rỗng -> `resolveSecondPass` chọn phương án an toàn leo thang `AZURE_FULL_PAGE` (1,980 units/trang).
  - Worker: Phát hiện không có `document_pages` -> Chạy legacy whole-document Azure path.
  - Quyết toán: Khóa $1,980\text{ units/trang}$ đã giữ.

---

### Ví Dụ 6: Job Xử Lý Thất Bại Sau Khi Đã Giữ Chỗ (Failed Processing Job)
- **Tình huống:** Tài liệu 10 trang Mixed (đã giữ $10,020\text{ credit\_units}$, trừ 1 document quota).
- **Diễn biến:**
  - Lần thử 1: Azure API timeout / 503. Job chuyển QUEUED, retry sau 2s.
  - Lần thử 2: Lỗi mạng. Job chuyển QUEUED, retry sau 4s.
  - Lần thử 3: Azure API tiếp tục lỗi. Vượt quá `maxRetries = 3` -> Chuyển sang Terminal Failure.
- **Quyết toán hoàn tiền (Release):**
  - Worker phát hiện job có `reservation_id` và số units chưa quyết toán là $10,020\text{ units}$.
  - Worker gọi `creditService.releaseReservation({ releaseUnits: 10020, idempotencyKey: 'processing-release:${jobId}' })`.
  - RPC `release_credit_reservation` thực thi:
    - Giải phóng $10,020\text{ units}$ khỏi `reserved_units` của các grant theo LIFO.
    - Cập nhật trạng thái reservation = `'RELEASED'`.
    - Không ghi phát sinh giảm số dư vào `credit_ledger`.
  - Job chuyển trạng thái `FAILED` (`OCR_PROCESSING_FAILED`).
  - Document chuyển trạng thái `FAILED`.
- **Kết quả tài chính:**
  - Credit: Hoàn trả đủ 100% ($10,020\text{ units}$ quay về số dư khả dụng). Khách hàng không mất credit.
  - Document Quota: **BỊ MẤT** (Hạn mức tài liệu đã tăng lên 1 lúc confirm và không có logic hoàn lại trong code!).

---

## 6. Verify Credit-Unit Semantics

Dựa trên việc kiểm tra chi tiết các file:
- `server/types/credit.ts`
- `server/services/credit/creditService.ts`
- `supabase/migrations/20261001000000_credit_ledger_foundation.sql`
- `supabase/migrations/20261002010000_credit_reservation_foundation.sql`
- `supabase/migrations/20261004010000_atomic_credit_reserve_before_processing_queue.sql`

| Câu Hỏi Kiểm Định | Kết Quả Thực Tế | Bằng Chứng Mã Nguồn & Cơ Chế |
| :--- | :--- | :--- |
| **1 Credit có bằng 1,000 credit_units không?** | **VERIFIED** (CHÍNH XÁC) | `UNITS_PER_CREDIT = 1000` (`creditService.ts:22`), `CREDIT_UNIT_SCALE = 1000` (`processingPricing.ts:17`). Các migration SQL định nghĩa: `1 credit = 1000 credit_units (BIGINT)`. |
| **Giá là số nguyên hay số thực?** | **VERIFIED** (SỐ NGUYÊN AN TOÀN) | Tất cả các giá và số dư lưu trữ là `BIGINT` (PostgreSQL) và `Number.isSafeInteger` (Node.js). Cấm hoàn toàn `FLOAT`, `NaN`, `Infinity`, số âm. Số float chỉ xuất hiện ở tầng giao diện hiển thị thông qua hàm `unitsToCredits(units)` (`creditService.ts:25-27`). |
| **Làm tròn diễn ra ở đâu (trang, strategy hay document)?** | **VERIFIED** (KHÔNG CẦN LÀM TRÒN) | Tất cả đơn giá cấu hình (`strategyRates`) đều là số nguyên (350, 1980). Phép cộng dồn hoàn toàn là số học nguyên (`sumPageUnits += pb.estimatedUnits`). Do đó **không có sai số làm tròn (No rounding error)** trong toàn bộ chuỗi tính toán. |
| **Giá báo có được bảo đảm hay có thể thay đổi sau xác nhận?** | **VERIFIED** (ĐƯỢC BẢO ĐẢM - FIXED) | Giá báo tại thời điểm xác nhận được ghim bất biến vào `processing_jobs.estimated_billable_units` và `quote_snapshot`. Worker khi quyết toán thành công chỉ capture đúng số lượng `outstandingReservedUnits` (bằng đúng số đã giữ). |
| **Chiến lược xử lý thay đổi có làm tăng phí cuối cùng không?** | **VERIFIED** (KHÔNG TĂNG PHÍ) | Theo chính sách `processing-pricing-v1`, `AZURE_FALLBACK = 0 incremental units`. Nếu trang Native phải leo thang lên Azure, khách hàng vẫn chỉ trả 350 units. Hệ thống cấm tự động trừ thêm tiền vượt quá số đã giữ chỗ. |
| **Người dùng có phải chấp thuận việc tăng giá không?** | **VERIFIED** (HỆ THỐNG KHÔNG TĂNG GIÁ SAU XÁC NHẬN) | Trong trường hợp chi phí thực tế vượt quá ước tính (nếu có chính sách mới), cờ `reconciliationRequired = true` sẽ được kích hoạt; hệ thống cấm auto-debit tài khoản khách hàng. |
| **Pricing snapshots có lưu giữ giá trị giao dịch lịch sử không?** | **VERIFIED** (LƯU TRỮ ĐẦY ĐỦ) | Lưu tại: `processing_jobs.quote_snapshot` (JSONB), `processing_jobs.pricing_version` (VARCHAR), `credit_reservations.metadata` (JSONB), và bản ghi bất biến trong `credit_ledger`. |

---

## 7. Audit Inconsistencies and Risks

### RỦI RO 1: Bất Nhất Giữa Ước Tính Preflight và Báo Giá Backend (CRITICAL UX & TRUST GAP)
- **Vị trí:**
  - Frontend: [src/components/upload/UploadModal.tsx:516-520](file:///e:/App%20Scan%20PDF/docconvert-ai/src/components/upload/UploadModal.tsx#L516-L520)
  - Preflight: [server/services/preflightService.ts:70, 280](file:///e:/App%20Scan%20PDF/docconvert-ai/server/services/preflightService.ts#L70)
  - Pricing Engine: [server/services/credit/processingPricingEngine.ts:32-38](file:///e:/App%20Scan%20PDF/docconvert-ai/server/services/credit/processingPricingEngine.ts#L32-L38)
- **Hiện tượng:**
  - `preflightService.ts` cài đặt cứng: `CREDITS_PER_PAGE: 1` và tính `estimatedCredits = pageCount * 1`.
  - `UploadModal.tsx` hiển thị cho người dùng: `{preflightData.estimatedCredits} Credits` cùng dòng chữ phụ: `<p>1 trang = 1 Credit</p>`.
  - Nhưng khi người dùng nhấn nút xác nhận xử lý (`POST /documents/:id/process`), Backend kích hoạt `processingEligibilityService` và tính theo `ProcessingPricingEngine`:
    * Với file Scanned 10 trang: Frontend thông báo **10 Credits**, nhưng Backend yêu cầu **19.8 Credits** (19,800 units). Nếu người dùng chỉ có 15 Credits, hệ thống sẽ đột ngột chặn lại với lỗi `INSUFFICIENT_CREDIT` ("Tài liệu này dự kiến cần 19.8 credits...").
    * Với file Native 10 trang: Frontend thông báo **10 Credits**, nhưng Backend chỉ trừ **3.5 Credits** (3,500 units).
- **Đánh giá rủi ro:** Gây hiểu lầm nghiêm trọng về chi phí, tạo cảm giác thiếu minh bạch hoặc lỗi hệ thống đối với người dùng.

---

### RỦI RO 2: Xung Đột Giữa Hệ Thống Quota Cũ và Hệ Thống Credit Mới (DUAL BILLING RUNTIME CONFLICT)
- **Vị trí:**
  - [supabase/migrations/20261004010000_atomic_credit_reserve_before_processing_queue.sql:303-307, 326-335](file:///e:/App%20Scan%20PDF/docconvert-ai/supabase/migrations/20261004010000_atomic_credit_reserve_before_processing_queue.sql#L303-L307)
  - [server/routes/documents.ts:202-210](file:///e:/App%20Scan%20PDF/docconvert-ai/server/routes/documents.ts#L202-L210)
- **Hiện tượng:**
  - Hệ thống đang vận hành **song song 2 cơ chế giới hạn**:
    1. Cơ chế hạn ngạch tài liệu cũ: `profiles.used_documents` vs `plans.document_quota` (ví dụ gói Free chỉ cho 3 tài liệu).
    2. Cơ chế tín dụng chi tiết: `credit_accounts`, `credit_grants`, `credit_reservations` (tính phí theo credit_units từng trang).
  - Khi xác nhận xử lý, RPC `confirm_document_processing` vừa kiểm tra `used_quota >= total_quota` và tăng `used_documents = used_documents + 1`, vừa gọi `reserve_credit_units`.
  - Người dùng dù có nhiều Credit nhưng nếu đã dùng hết 3 document quota của gói Free vẫn bị chặn với lỗi `INSUFFICIENT_QUOTA`.

---

### RỦI RO 3: Thất Thoát Quota Tài Liệu Khi Xử Lý Thất Bại (ASYMMETRIC QUOTA LEAK ON FAILURE)
- **Vị trí:**
  - [server/services/ocrWorker.ts:686-698](file:///e:/App%20Scan%20PDF/docconvert-ai/server/services/ocrWorker.ts#L686-L698)
  - [supabase/migrations/20261004010000_atomic_credit_reserve_before_processing_queue.sql:382-386](file:///e:/App%20Scan%20PDF/docconvert-ai/supabase/migrations/20261004010000_atomic_credit_reserve_before_processing_queue.sql#L382-L386)
- **Hiện tượng:**
  - Khi một tài liệu bị lỗi xử lý hoàn toàn (Terminal Failure sau 3 lần retry), worker gọi `creditService.releaseReservation` để hoàn trả 100% credit_units cho khách hàng.
  - Tuy nhiên, biến đếm `used_documents` trong bảng `profiles` **không được giảm trở lại (-1)**!
  - Khách hàng bị mất một lượt xử lý tài liệu trong tháng dù hệ thống không thể xử lý thành công file của họ.

---

### RỦI RO 4: `calculateBillableUsage` Chưa Được Đấu Nối Vào Worker Settlement (WORKER SETTLEMENT SHORTCUT)
- **Vị trí:**
  - [server/services/ocrWorker.ts:540-575](file:///e:/App%20Scan%20PDF/docconvert-ai/server/services/ocrWorker.ts#L540-L575)
- **Hiện tượng:**
  - Hàm `processingPricingEngine.calculateBillableUsage` được viết rất hoàn chỉnh và kiểm thử kỹ lưỡng trong `phase3a2_pricing_policy_and_lifecycle.test.ts`.
  - Tuy nhiên, trong `ocrWorker.ts` ở thời điểm quyết toán (Settlement), worker lấy thẳng `outstandingReservedUnits` từ reservation để capture mà không gọi qua `calculateBillableUsage`.
  - **Hệ quả thực tế hiện tại:** Trong chính sách MVP hiện hành, điều này không gây sai lệch số tiền vì mọi fallback và secondary OCR đều có phụ phí bằng 0 (nên `billableUsage` luôn đúng bằng `estimatedUnits`). Tuy nhiên, nếu trong tương lai chính sách giá có thêm phụ phí cho secondary OCR hoặc chiết khấu khi xử lý ít trang hơn dự kiến, worker sẽ không thể tự động điều chỉnh số tiền capture nếu không tích hợp hàm này.

---

### RỦI RO 5: Quy Định Tính Phí Xuất Tệp (Export / Download Process)
- **Vị trí:**
  - [server/routes/documents.ts:892-919, 945-988](file:///e:/App%20Scan%20PDF/docconvert-ai/server/routes/documents.ts#L892-L919)
- **Hiện trạng:**
  - Endpoint `POST /documents/:id/export/excel`: **HOÀN TOÀN MIỄN PHÍ**. Không kiểm tra credit, không giữ chỗ, không trừ tiền.
  - Endpoint `GET /documents/:id/exports/:exportId/download`: **HOÀN TOÀN MIỄN PHÍ**.
  - Endpoint Word Export: Bị chặn hoàn toàn với lỗi `400 UNSUPPORTED_OUTPUT_TYPE` ("Chức năng chuyển đổi sang Word đang được phát triển").

---

## 8. Evidence Requirements

Bảng tổng hợp chứng cứ kỹ thuật đã được kiểm chứng trực tiếp:

| Nội Dung Kiểm Toán | File Path | Ký Hiệu / Function / Config | Dòng Mã (Line Range) | Trạng Thái Kiểm Chứng | Kết Quả / Bằng Chứng Thực Tế |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Quy đổi Credit Unit** | `server/services/credit/creditService.ts` | `UNITS_PER_CREDIT`, `unitsToCredits` | L22-32 | **VERIFIED** | $1\text{ Credit} = 1,000\text{ units}$. Hàm `unitsToCredits` chuyển đổi bằng `(units / 1000).toFixed(3)`. |
| **Bảng giá chuẩn Phase 3A** | `server/types/processingPricing.ts` | `CANONICAL_APPROVED_PRODUCTION_POLICY_V1` | L43-61 | **VERIFIED** | `LOCAL_NATIVE: 350`, `AZURE_FULL_PAGE: 1980`, `HYBRID: 1980`, `AZURE_FALLBACK: 0`, `secondaryOcrPerCell: 0`. |
| **Phân loại trang Preflight** | `server/services/preflightService.ts` | `analyzeSinglePdfPage` | L405-466 | **VERIFIED** | Phân loại ra `NATIVE_TEXT`, `SCANNED`, `MIXED`, `UNCERTAIN`. |
| **Ước tính Preflight cũ** | `server/services/preflightService.ts` | `PREFLIGHT_CONFIG.CREDITS_PER_PAGE` | L70, L280 | **VERIFIED** | Cố định `CREDITS_PER_PAGE = 1`. Tính `estimatedCredits = pageCount * 1`. |
| **Hiển thị giá trên Frontend** | `src/components/upload/UploadModal.tsx` | UI Render Card | L516-520 | **VERIFIED** | Hiển thị: `{preflightData.estimatedCredits} Credits` và `1 trang = 1 Credit`. |
| **Định giá PDE** | `server/services/pde/ProcessingDecisionEngine.ts` | `evaluatePage`, `resolveSecondPass` | L49-98, L119-170 | **VERIFIED** | `NATIVE_TEXT` -> `LOCAL_NATIVE`; `SCANNED` -> `AZURE_FULL_PAGE`; `MIXED` -> `HYBRID`. |
| **Báo giá Server Authoritative** | `server/services/credit/processingPricingEngine.ts` | `estimateProcessingCost` | L142-245 | **VERIFIED** | Tính theo `pageBreakdown`, cộng tổng safe integer. |
| **Khóa và Giữ Chỗ DB** | `supabase/migrations/20261004010000_atomic_credit_reserve_before_processing_queue.sql` | `confirm_document_processing` | L326-340 | **VERIFIED** | Gọi `reserve_credit_units` trong PostgreSQL transaction, rollback nếu thiếu tiền. |
| **Thu Tiền (Capture)** | `server/services/ocrWorker.ts` | `processJob` (Settlement) | L563-575 | **VERIFIED** | Gọi `captureReservation` với `outstandingReservedUnits`. |
| **Hoàn Tiền (Release)** | `server/services/ocrWorker.ts` | `processJob` (Terminal Failure) | L686-698 | **VERIFIED** | Gọi `releaseReservation` khi thử lại quá 3 lần thất bại. |
| **Không hoàn Document Quota** | `server/services/ocrWorker.ts` | Error catch handler | L668-710 | **VERIFIED** | Chỉ release credit reservation, không có thao tác trừ `used_documents`. |
| **Tính phí Xuất File** | `server/routes/documents.ts` | `export/excel`, `download` | L892-919, L945-988 | **VERIFIED** | Không thu phí, không kiểm tra credit. |

---

## 9. Recommended Changes (Khuyến Nghị Kỹ Thuật)

*(Các khuyến nghị được tách bạch hoàn toàn khỏi hành vi hiện tại của hệ thống)*

1. **Đồng Bộ Hoá Preflight và Frontend với ProcessingPricingEngine (Priority 1):**
   - Thay vì hardcode `1 trang = 1 Credit` trong `preflightService.ts` và `UploadModal.tsx`, endpoint `POST /documents/upload` hoặc `UploadModal` nên gọi hàm báo giá của `ProcessingPricingEngine` để hiển thị con số chính xác ngay sau khi Preflight phân tích xong cấu trúc các trang.
   - Hiển thị bảng chi tiết: *X trang Native (0.35 Cr) + Y trang Quét (1.98 Cr) = Tổng Credits dự kiến*.
2. **Hợp Nhất Quota và Credit (Unified Billing Horizon) (Priority 2):**
   - Loại bỏ dần cơ chế đếm số tài liệu cứng (`used_documents`) trong `profiles`, chuyển toàn bộ sang hệ thống Credit.
   - Gói Free nên cấp ví dụ 10 Credits (hoặc 10,000 credit_units) hàng tháng thay vì giới hạn 3 tài liệu bất kể số trang.
3. **Bổ Sung Bù Hoàn Quota Khi Thất Bại (Compensating Quota Rollback) (Priority 2):**
   - Trong khối xử lý lỗi terminal failure của `ocrWorker.ts`, nếu hệ thống vẫn duy trì `used_documents`, cần thực hiện giảm `used_documents = GREATEST(0, used_documents - 1)` khi job bị đánh dấu `FAILED`.
4. **Đấu Nối `calculateBillableUsage` Vào Worker Settlement (Priority 3):**
   - Trong `ocrWorker.ts`, trước khi gọi `captureReservation`, nên chuyển kết quả thực tế qua `processingPricingEngine.calculateBillableUsage` để sinh ra bản ghi `ProcessingBillableUsage` chính thức, sau đó đối chiếu với `estimated_billable_units` nhằm tăng cường khả năng kiểm toán tài chính (auditability) trong tương lai.

---

## 10. Conclusion

# `IMPLEMENTATION HAS GAPS`

Mặc dù tầng kiến trúc tài chính cốt lõi (Core Financial Ledger & Reservation RPCs) cùng bộ quy tắc phân loại của `ProcessingDecisionEngine` và `ProcessingPricingEngine` được xây dựng rất bài bản, chặt chẽ và an toàn về mặt số học nguyên (Safe Integer Math, Zero Fallback Cost, Idempotent Settlement), hệ thống hiện tại **đang có khoảng trống lớn về tính nhất quán giữa trải nghiệm người dùng (Frontend Preflight) và cơ chế thu phí thực tế (Backend Quoting/Reservation)**, kèm theo sự xung đột giữa cơ chế quản lý quota tài liệu truyền thống và hạn ngạch credit theo trang.
