import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * ============================================================================
 * PREFLIGHT SERVICE — DOCCONVERT AI
 * ============================================================================
 * Lightweight, deterministic, local inspection of PDFs and Images before
 * expensive Azure AI Document Intelligence or secondary OCR pipelines are called.
 * 
 * CORE PRINCIPLE:
 * UPLOAD != PROCESSING
 * PREFLIGHT != OCR
 * PREFLIGHT != QUOTA CONSUMPTION
 * ============================================================================
 */

export type PageClassification = 'NATIVE_TEXT' | 'SCANNED' | 'MIXED' | 'UNCERTAIN';

export interface DocumentPageAnalysis {
  pageNumber: number;
  classification: PageClassification;
  classificationConfidence: number;
  textCharCount: number;
  textBlockCount: number;
  textCoverage: number;
  imageCount: number;
  imageCoverage: number;
  hasFullPageImage: boolean;
  classificationReason: string;
}

export interface PreflightSummary {
  nativeTextPages: number;
  scannedPages: number;
  mixedPages: number;
  uncertainPages: number;
}

export interface PreflightResult {
  pageCount: number;
  summary: PreflightSummary;
  pages: DocumentPageAnalysis[];
  estimatedCredits: number;
  durationMs: number;
}

/**
 * Centralized heuristic thresholds for Preflight Classification.
 * V1 heuristic — requires calibration against real DocConvert documents.
 */
export const PREFLIGHT_CONFIG = {
  // Rendered single image covers >= 70% of page area, or cumulative images cover >= 75%
  FULL_PAGE_IMAGE_THRESHOLD: 0.70,
  FULL_PAGE_CUMULATIVE_THRESHOLD: 0.75,

  // Native text page thresholds
  NATIVE_MIN_CHAR_COUNT: 150,      // Minimum characters for a standard native text page
  NATIVE_MIN_TEXT_COVERAGE: 0.08,  // Minimum 8% page area covered by text
  NATIVE_MAX_IMAGE_COVERAGE: 0.25, // Logos, stamps or signatures occupying <= 25% area

  // Scanned page thresholds (handles hidden OCR text layers / noise)
  SCANNED_MAX_CHAR_COUNT: 50,      // Under 50 characters (typical OCR noise or page number)
  SCANNED_MIN_IMAGE_COVERAGE: 0.60,// Background scan image occupies >= 60% area

  // Mixed page thresholds (both substantive text and large diagram/image regions)
  MIXED_MIN_CHAR_COUNT: 80,
  MIXED_MIN_IMAGE_COVERAGE: 0.20,

  // Temporary estimation pricing: 1 processed page = 1 estimated Credit
  CREDITS_PER_PAGE: 1,
};

/**
 * Matrix multiplication for 2D affine transforms: [a, b, c, d, e, f]
 */
function multiplyTransforms(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Grid-based coverage calculator to safely avoid overlap explosion.
 * Clamps result strictly to [0.0, 1.0].
 */
export class PageCoverageGrid {
  private readonly pageWidth: number;
  private readonly pageHeight: number;
  private readonly gridSize: number;
  private readonly grid: Uint8Array;

  constructor(pageWidth: number, pageHeight: number, gridSize = 100) {
    this.pageWidth = pageWidth;
    this.pageHeight = pageHeight;
    this.gridSize = gridSize;
    this.grid = new Uint8Array(gridSize * gridSize);
  }

  markBox(x: number, y: number, width: number, height: number): void {
    if (width <= 0 || height <= 0 || this.pageWidth <= 0 || this.pageHeight <= 0) return;

    const x0 = Math.max(0, Math.min(this.gridSize - 1, Math.floor((x / this.pageWidth) * this.gridSize)));
    const y0 = Math.max(0, Math.min(this.gridSize - 1, Math.floor((y / this.pageHeight) * this.gridSize)));
    const x1 = Math.max(0, Math.min(this.gridSize - 1, Math.floor(((x + width) / this.pageWidth) * this.gridSize)));
    const y1 = Math.max(0, Math.min(this.gridSize - 1, Math.floor(((y + height) / this.pageHeight) * this.gridSize)));

    for (let gy = y0; gy <= y1; gy++) {
      const rowOffset = gy * this.gridSize;
      for (let gx = x0; gx <= x1; gx++) {
        this.grid[rowOffset + gx] = 1;
      }
    }
  }

  getCoverage(): number {
    let marked = 0;
    const total = this.gridSize * this.gridSize;
    for (let i = 0; i < total; i++) {
      if (this.grid[i] === 1) marked++;
    }
    return Math.min(1.0, Math.max(0.0, marked / total));
  }
}

export class PreflightService {
  /**
   * Main entry point: Inspects either PDF or Image buffer deterministically.
   */
  async analyzeDocument(
    fileBuffer: Buffer,
    mimeType: string,
    filename = 'document'
  ): Promise<PreflightResult> {
    const startTime = Date.now();
    console.log(`[PREFLIGHT_STARTED] filename: "${filename}", size: ${fileBuffer.length} bytes, mimeType: "${mimeType}"`);

    const isImage =
      mimeType.startsWith('image/') ||
      /\.(jpg|jpeg|png)$/i.test(filename);

    if (isImage) {
      return this.analyzeImageDocument(fileBuffer, mimeType, filename, startTime);
    }

    return await this.analyzePdfDocument(fileBuffer, filename, startTime);
  }

  /**
   * Fast-path for raster images (.jpg, .jpeg, .png).
   * Images are by definition SCANNED with page_count = 1.
   */
  private analyzeImageDocument(
    _buffer: Buffer,
    _mimeType: string,
    filename: string,
    startTime: number
  ): PreflightResult {
    const pageAnalysis: DocumentPageAnalysis = {
      pageNumber: 1,
      classification: 'SCANNED',
      classificationConfidence: 0.99,
      textCharCount: 0,
      textBlockCount: 0,
      textCoverage: 0.0,
      imageCount: 1,
      imageCoverage: 1.0,
      hasFullPageImage: true,
      classificationReason: 'Tập tin hình ảnh (JPG/PNG) được định danh trực tiếp là tài liệu quét.',
    };

    const summary: PreflightSummary = {
      nativeTextPages: 0,
      scannedPages: 1,
      mixedPages: 0,
      uncertainPages: 0,
    };

    const durationMs = Date.now() - startTime;
    console.log(`[PREFLIGHT_COMPLETED] filename: "${filename}", type: IMAGE, pageCount: 1, scanned: 1, duration: ${durationMs}ms`);

    return {
      pageCount: 1,
      summary,
      pages: [pageAnalysis],
      estimatedCredits: PREFLIGHT_CONFIG.CREDITS_PER_PAGE,
      durationMs,
    };
  }

  /**
   * Full page-by-page deterministic PDF structural inspection via pdfjs-dist.
   */
  private async analyzePdfDocument(
    fileBuffer: Buffer,
    filename: string,
    startTime: number
  ): Promise<PreflightResult> {
    let pdfDoc: any = null;

    try {
      const data = new Uint8Array(fileBuffer);
      const loadingTask = (pdfjsLib as any).getDocument({
        data,
        useSystemFonts: true,
        disableFontFace: true,
        isEvalSupported: false,
      });
      pdfDoc = await loadingTask.promise;
    } catch (err: any) {
      console.error(`[PREFLIGHT_FAILED] Could not parse PDF container for "${filename}":`, err.message);
      throw new Error(`Tệp tin PDF không hợp lệ hoặc bị lỗi mã hóa/hỏng: ${err.message}`);
    }

    const pageCount = pdfDoc.numPages;
    if (pageCount <= 0) {
      throw new Error('Tài liệu PDF không chứa bất kỳ trang nào hợp lệ.');
    }

    const pages: DocumentPageAnalysis[] = [];
    const summary: PreflightSummary = {
      nativeTextPages: 0,
      scannedPages: 0,
      mixedPages: 0,
      uncertainPages: 0,
    };

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const analysis = await this.analyzeSinglePdfPage(page, pageNum);
        pages.push(analysis);

        switch (analysis.classification) {
          case 'NATIVE_TEXT':
            summary.nativeTextPages++;
            break;
          case 'SCANNED':
            summary.scannedPages++;
            break;
          case 'MIXED':
            summary.mixedPages++;
            break;
          case 'UNCERTAIN':
          default:
            summary.uncertainPages++;
            break;
        }

        console.log(
          `[PREFLIGHT_PAGE_ANALYZED] doc: "${filename}", page: ${pageNum}/${pageCount}, ` +
          `class: ${analysis.classification}, conf: ${analysis.classificationConfidence}, ` +
          `chars: ${analysis.textCharCount}, imgCov: ${analysis.imageCoverage}, textCov: ${analysis.textCoverage}`
        );
      } catch (pageErr: any) {
        console.warn(`[PREFLIGHT_PAGE_FAILED] Error analyzing page ${pageNum} of "${filename}":`, pageErr.message);
        // Robustness invariant: a single failed page does NOT destroy the entire document analysis
        const fallbackAnalysis: DocumentPageAnalysis = {
          pageNumber: pageNum,
          classification: 'UNCERTAIN',
          classificationConfidence: 0.50,
          textCharCount: 0,
          textBlockCount: 0,
          textCoverage: 0.0,
          imageCount: 0,
          imageCoverage: 0.0,
          hasFullPageImage: false,
          classificationReason: `Lỗi đọc cấu trúc trang: ${pageErr.message || 'Không thể giải mã trang'}`,
        };
        pages.push(fallbackAnalysis);
        summary.uncertainPages++;
      }
    }

    const durationMs = Date.now() - startTime;
    const estimatedCredits = pageCount * PREFLIGHT_CONFIG.CREDITS_PER_PAGE;

    console.log(
      `[PREFLIGHT_COMPLETED] doc: "${filename}", pages: ${pageCount}, ` +
      `native: ${summary.nativeTextPages}, scanned: ${summary.scannedPages}, ` +
      `mixed: ${summary.mixedPages}, uncertain: ${summary.uncertainPages}, ` +
      `credits: ${estimatedCredits}, duration: ${durationMs}ms (avg ${(durationMs / pageCount).toFixed(1)}ms/page)`
    );

    return {
      pageCount,
      summary,
      pages,
      estimatedCredits,
      durationMs,
    };
  }

  /**
   * Analyzes an individual PDF page's geometry, text streams, and image operators.
   */
  private async analyzeSinglePdfPage(page: any, pageNumber: number): Promise<DocumentPageAnalysis> {
    const viewport = page.getViewport({ scale: 1.0 });
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;
    const pageArea = Math.max(1, pageWidth * pageHeight);

    // 1. Text extraction & line cluster analysis
    const textContent = await page.getTextContent();
    let textCharCount = 0;
    let textBlockCount = 0;
    const textGrid = new PageCoverageGrid(pageWidth, pageHeight, 100);

    let lastY: number | null = null;
    for (const item of textContent.items) {
      if (!item.str || item.str.trim().length === 0) continue;
      const str = item.str.trim();
      textCharCount += str.length;

      const tx = item.transform[4];
      const ty = item.transform[5];
      const itemHeight = Math.max(item.height || 0, Math.abs(item.transform[3]) || 10);
      const itemWidth = Math.max(item.width || 0, str.length * (itemHeight * 0.5));

      if (lastY === null || Math.abs(ty - lastY) > itemHeight * 0.6) {
        textBlockCount++;
        lastY = ty;
      }

      textGrid.markBox(tx, ty, itemWidth, itemHeight);
    }

    const textCoverage = Number(textGrid.getCoverage().toFixed(4));

    // 2. Image operator extraction & CTM tracking
    const ops = await page.getOperatorList();
    const imageGrid = new PageCoverageGrid(pageWidth, pageHeight, 100);
    let imageCount = 0;
    let maxSingleImageCoverage = 0;

    const ctmStack = [[1, 0, 0, 1, 0, 0]];
    let currentCtm = [1, 0, 0, 1, 0, 0];

    const fnArray = ops.fnArray;
    const argsArray = ops.argsArray;

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i];

      if (fn === (pdfjsLib as any).OPS.save) {
        ctmStack.push([...currentCtm]);
      } else if (fn === (pdfjsLib as any).OPS.restore) {
        if (ctmStack.length > 1) {
          currentCtm = ctmStack.pop()!;
        }
      } else if (fn === (pdfjsLib as any).OPS.transform) {
        currentCtm = multiplyTransforms(currentCtm, args);
      } else if (
        fn === (pdfjsLib as any).OPS.paintImageXObject ||
        fn === (pdfjsLib as any).OPS.paintInlineImageXObject ||
        fn === (pdfjsLib as any).OPS.paintImageMaskXObject
      ) {
        imageCount++;

        const a = currentCtm[0];
        const b = currentCtm[1];
        const c = currentCtm[2];
        const d = currentCtm[3];
        const e = currentCtm[4];
        const f = currentCtm[5];

        const corners = [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);

        const xs = corners.map((pt) => pt[0]);
        const ys = corners.map((pt) => pt[1]);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        const imgWidth = Math.max(0, maxX - minX);
        const imgHeight = Math.max(0, maxY - minY);
        const imgRenderedArea = Math.abs(a * d - b * c);
        const singleImgCoverage = pageArea > 0 ? Math.min(1.0, imgRenderedArea / pageArea) : 0;

        if (singleImgCoverage > maxSingleImageCoverage) {
          maxSingleImageCoverage = singleImgCoverage;
        }

        imageGrid.markBox(minX, minY, imgWidth, imgHeight);
      }
    }

    const imageCoverage = Number(imageGrid.getCoverage().toFixed(4));
    const hasFullPageImage =
      maxSingleImageCoverage >= PREFLIGHT_CONFIG.FULL_PAGE_IMAGE_THRESHOLD ||
      imageCoverage >= PREFLIGHT_CONFIG.FULL_PAGE_CUMULATIVE_THRESHOLD;

    // 3. Multi-Signal Heuristic Classification
    let classification: PageClassification = 'UNCERTAIN';
    let classificationConfidence = 0.50;
    let classificationReason = '';

    // CASE 1: Full-page scan raster image (e.g. Scanned paper or Scanned paper with tiny OCR text layer)
    if (hasFullPageImage || imageCoverage >= PREFLIGHT_CONFIG.SCANNED_MIN_IMAGE_COVERAGE) {
      if (textCharCount <= PREFLIGHT_CONFIG.SCANNED_MAX_CHAR_COUNT || textCoverage < 0.015) {
        classification = 'SCANNED';
        classificationConfidence = 0.96;
        classificationReason =
          `Hình ảnh quét toàn trang (bao phủ ${(imageCoverage * 100).toFixed(1)}%), ` +
          `văn bản số không đáng kể (${textCharCount} ký tự, độ phủ ${(textCoverage * 100).toFixed(2)}%).`;
      } else if (textCharCount >= PREFLIGHT_CONFIG.MIXED_MIN_CHAR_COUNT) {
        // Has a full page background image but also substantive native text on top
        classification = 'MIXED';
        classificationConfidence = 0.85;
        classificationReason =
          `Ảnh nền lớn (độ phủ ${(imageCoverage * 100).toFixed(1)}%) kết hợp văn bản số thực tế ` +
          `(${textCharCount} ký tự, ${textBlockCount} khối dòng).`;
      } else {
        classification = 'SCANNED';
        classificationConfidence = 0.82;
        classificationReason =
          `Ảnh quét chiếm diện tích lớn (${(imageCoverage * 100).toFixed(1)}%), văn bản có mật độ rất thấp (${textCharCount} ký tự).`;
      }
    }
    // CASE 2: Native Digital Document (High text density, low image coverage)
    else if (
      textCharCount >= PREFLIGHT_CONFIG.NATIVE_MIN_CHAR_COUNT &&
      imageCoverage <= PREFLIGHT_CONFIG.NATIVE_MAX_IMAGE_COVERAGE
    ) {
      classification = 'NATIVE_TEXT';
      classificationConfidence = textCoverage >= PREFLIGHT_CONFIG.NATIVE_MIN_TEXT_COVERAGE ? 0.95 : 0.88;
      classificationReason =
        `Văn bản kỹ thuật số chuẩn (${textCharCount} ký tự, ${textBlockCount} dòng, ` +
        `độ phủ chữ ${(textCoverage * 100).toFixed(1)}%, ảnh phụ trợ ${(imageCoverage * 100).toFixed(1)}%).`;
    }
    // CASE 3: Mixed Document (Substantive digital text + large embedded graphic / chart)
    else if (
      textCharCount >= PREFLIGHT_CONFIG.MIXED_MIN_CHAR_COUNT &&
      imageCoverage >= PREFLIGHT_CONFIG.MIXED_MIN_IMAGE_COVERAGE
    ) {
      classification = 'MIXED';
      classificationConfidence = 0.90;
      classificationReason =
        `Tài liệu hỗn hợp chứa cả văn bản số (${textCharCount} ký tự) và hình ảnh đồ họa biểu mẫu ` +
        `chiếm ${(imageCoverage * 100).toFixed(1)}% diện tích trang.`;
    }
    // CASE 4: Low text and low image (e.g. blank page or minimal watermark)
    else if (textCharCount < PREFLIGHT_CONFIG.SCANNED_MAX_CHAR_COUNT && imageCount === 0) {
      classification = 'UNCERTAIN';
      classificationConfidence = 0.60;
      classificationReason = `Trang có quá ít nội dung (${textCharCount} ký tự) và không có hình ảnh nhận diện.`;
    }
    // CASE 5: Ambiguous / Borderline signals
    else {
      classification = 'UNCERTAIN';
      classificationConfidence = 0.50;
      classificationReason =
        `Tín hiệu không đủ rõ ràng: ${textCharCount} ký tự, độ phủ chữ ${(textCoverage * 100).toFixed(1)}%, ` +
        `${imageCount} ảnh chiếm ${(imageCoverage * 100).toFixed(1)}%.`;
    }

    return {
      pageNumber,
      classification,
      classificationConfidence: Number(classificationConfidence.toFixed(2)),
      textCharCount,
      textBlockCount,
      textCoverage,
      imageCount,
      imageCoverage,
      hasFullPageImage,
      classificationReason,
    };
  }
}

export const preflightService = new PreflightService();
