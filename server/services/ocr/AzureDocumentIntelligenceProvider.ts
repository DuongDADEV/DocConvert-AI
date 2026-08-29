import process from 'node:process';
import { Buffer } from 'node:buffer';
import { PDFDocument } from 'pdf-lib';
import {
  DocumentAIProvider,
  OCRAnalysisResult,
  OCRExtractedTable,
  OCRExtractedRow,
  OCRExtractedCell,
  OCRPage,
} from './types.js';
import { DataNormalizer } from './normalizer.js';

export class AzureDocumentIntelligenceProvider implements DocumentAIProvider {
  readonly providerName = 'Azure AI Document Intelligence';

  private getEndpoint(): string {
    return (process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || '').trim();
  }

  private getKey(): string {
    return (process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '').trim();
  }

  /**
   * Reads configured MAX_PAGES_PER_CHUNK from environment variable or defaults to 2 (Azure Free F0 limit)
   */
  private getMaxPagesPerChunk(): number {
    const envVal = process.env.AZURE_MAX_PAGES_PER_CHUNK;
    if (envVal) {
      const parsed = parseInt(envVal, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return 2; // Default F0 limit
  }

  async analyzeDocument(
    fileBuffer: Buffer,
    mimeType: string,
    options?: { modelId?: string; forceSimulation?: boolean }
  ): Promise<OCRAnalysisResult> {
    const endpoint = this.getEndpoint();
    const key = this.getKey();
    const modelId = options?.modelId || 'prebuilt-layout';
    const isSimulationForced = process.env.USE_SIMULATED_OCR === 'true' || Boolean(options?.forceSimulation);

    // 1. If Azure credentials do not exist or simulation is forced, return simulated result
    if (!endpoint || !key || isSimulationForced) {
      if (process.env.NODE_ENV === 'production' && !isSimulationForced) {
        throw new Error('AZURE_DOCUMENT_INTELLIGENCE_CREDENTIALS_MISSING: Cannot process document in production without valid Azure AI credentials.');
      }
      return this.generateSimulatedBankingOCR(fileBuffer, modelId);
    }

    // 2. Determine actual PDF Page Count via pdf-lib
    const isPdf = mimeType === 'application/pdf' || fileBuffer.subarray(0, 4).toString() === '%PDF';
    let totalPageCount = 1;
    let pdfDoc: PDFDocument | null = null;

    if (isPdf) {
      try {
        pdfDoc = await PDFDocument.load(fileBuffer);
        totalPageCount = pdfDoc.getPageCount();
      } catch (pdfErr: any) {
        console.warn('[AzureProvider] Could not parse PDF with pdf-lib, falling back to single request:', pdfErr.message);
      }
    }

    const maxPagesPerChunk = this.getMaxPagesPerChunk();

    // 3. Single-chunk execution path: PDF <= maxPagesPerChunk or non-PDF image file
    if (!pdfDoc || totalPageCount <= maxPagesPerChunk) {
      const singleResult = await this.callAzureAPI(fileBuffer, mimeType, endpoint, key, modelId);
      if (singleResult.metadata) {
        singleResult.metadata.pageCount = Math.max(singleResult.pages.length, totalPageCount);
      }
      return singleResult;
    }

    // 4. Multi-chunk execution path: PDF > maxPagesPerChunk
    const chunkCount = Math.ceil(totalPageCount / maxPagesPerChunk);
    console.log(`[AzureProvider] Splitting ${totalPageCount}-page PDF into ${chunkCount} chunks (limit: ${maxPagesPerChunk} pages/chunk)`);

    const chunkResults: OCRAnalysisResult[] = [];

    for (let chunkIdx = 0; chunkIdx < chunkCount; chunkIdx++) {
      const startPage = chunkIdx * maxPagesPerChunk;
      const endPage = Math.min((chunkIdx + 1) * maxPagesPerChunk - 1, totalPageCount - 1);
      const pageRangeStr = `${startPage + 1}-${endPage + 1}`;

      console.log(`[AzureProvider] Processing chunk ${chunkIdx + 1}/${chunkCount} (pages ${pageRangeStr})...`);

      let chunkBuffer: Buffer;
      try {
        const subPdf = await PDFDocument.create();
        const pageIndices = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
        const copiedPages = await subPdf.copyPages(pdfDoc, pageIndices);
        copiedPages.forEach((page) => subPdf.addPage(page));
        const chunkBytes = await subPdf.save();
        chunkBuffer = Buffer.from(chunkBytes);
      } catch (splitErr: any) {
        console.error(`[AzureProvider] Failed to create PDF chunk ${chunkIdx + 1}/${chunkCount}:`, splitErr.message);
        throw new Error(`PDF Chunking Error (chunk ${chunkIdx + 1}): ${splitErr.message}`);
      }

      try {
        const chunkResult = await this.callAzureAPI(chunkBuffer, 'application/pdf', endpoint, key, modelId);
        console.log(`[AzureProvider] Chunk ${chunkIdx + 1}/${chunkCount} (pages ${pageRangeStr}) succeeded: ${chunkResult.pages.length} pages, ${chunkResult.tables.length} tables.`);
        chunkResults.push(chunkResult);
      } catch (azureErr: any) {
        console.error(`[AzureProvider] Chunk ${chunkIdx + 1}/${chunkCount} (pages ${pageRangeStr}) failed:`, azureErr.message);
        throw new Error(`Azure OCR processing failed on chunk ${chunkIdx + 1}/${chunkCount} (pages ${pageRangeStr}): ${this.sanitizeErrorMessage(azureErr.message)}`);
      }
    }

    // 5. Merge all chunk results into a single OCRAnalysisResult
    return this.mergeChunkResults(chunkResults, totalPageCount, maxPagesPerChunk, modelId);
  }

  /**
   * Merges multiple chunk OCR results into a single unified OCRAnalysisResult.
   * Remaps local page numbers to global page numbers and avoids tableIndex collisions.
   */
  private mergeChunkResults(
    chunkResults: OCRAnalysisResult[],
    totalPageCount: number,
    maxPagesPerChunk: number,
    modelId: string
  ): OCRAnalysisResult {
    const mergedPages: OCRPage[] = [];
    const mergedTables: OCRExtractedTable[] = [];
    const rawTextParts: string[] = [];
    let globalTableIdx = 0;
    let totalConfidenceSum = 0;
    let confidenceCount = 0;

    chunkResults.forEach((chunkRes, chunkIdx) => {
      const pageOffset = chunkIdx * maxPagesPerChunk;

      // 1. Merge Pages & Remap Page Numbers
      chunkRes.pages.forEach((p) => {
        const globalPageNum = pageOffset + p.pageNumber;
        mergedPages.push({
          ...p,
          pageNumber: globalPageNum,
        });
        if (typeof p.confidence === 'number') {
          totalConfidenceSum += p.confidence;
          confidenceCount++;
        }
      });

      if (chunkRes.rawText) {
        rawTextParts.push(`--- Trang ${pageOffset + 1} đến ${pageOffset + chunkRes.pages.length} ---\n${chunkRes.rawText}`);
      }

      // 2. Merge Tables & Remap Page Numbers & Table Index
      chunkRes.tables.forEach((t) => {
        const globalTablePageNum = pageOffset + t.pageNumber;

        // Remap bounding regions page numbers
        const remappedBoundingRegions = t.boundingRegions?.map((b: any) => ({
          ...b,
          pageNumber: pageOffset + (b.pageNumber || 1),
        }));

        mergedTables.push({
          ...t,
          pageNumber: globalTablePageNum,
          tableIndex: globalTableIdx++,
          boundingRegions: remappedBoundingRegions,
        });

        totalConfidenceSum += t.confidence;
        confidenceCount++;
      });
    });

    mergedPages.sort((a, b) => a.pageNumber - b.pageNumber);
    mergedTables.sort((a, b) => a.pageNumber - b.pageNumber || a.tableIndex - b.tableIndex);

    const overallConfidence = confidenceCount > 0
      ? Number((totalConfidenceSum / confidenceCount).toFixed(4))
      : 0.95;

    return {
      provider: this.providerName,
      modelId,
      overallConfidence,
      rawText: rawTextParts.join('\n\n'),
      pages: mergedPages,
      tables: mergedTables,
      metadata: {
        model: modelId,
        pageCount: totalPageCount,
        tableCount: mergedTables.length,
        chunkCount: chunkResults.length,
        maxPagesPerChunk,
      },
    };
  }

  private async callAzureAPI(
    fileBuffer: Buffer,
    mimeType: string,
    endpoint: string,
    key: string,
    modelId: string
  ): Promise<OCRAnalysisResult> {
    const cleanEndpoint = endpoint.replace(/\/+$/, '');
    // GA Microsoft Document Intelligence v4.0 REST API
    const apiVersion = '2024-11-30';
    const analyzeUrl = `${cleanEndpoint}/documentintelligence/documentModels/${modelId}:analyze?api-version=${apiVersion}`;

    const headers: Record<string, string> = {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': mimeType || 'application/pdf',
    };

    // 1. Submit analyze job with retry on 429 / 503
    let submitRes: Response | globalThis.Response | null = null;
    let submitAttempts = 0;
    const maxSubmitRetries = 3;

    while (submitAttempts < maxSubmitRetries) {
      submitAttempts++;
      try {
        submitRes = await fetch(analyzeUrl, {
          method: 'POST',
          headers,
          body: new Uint8Array(fileBuffer),
        });

        if (submitRes.status === 429 || submitRes.status >= 500) {
          const retryAfterSec = parseInt(submitRes.headers.get('Retry-After') || '2', 10);
          const backoffMs = (isNaN(retryAfterSec) ? Math.pow(2, submitAttempts) : retryAfterSec) * 1000;
          if (submitAttempts < maxSubmitRetries) {
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
        }
        break;
      } catch (networkErr: any) {
        if (submitAttempts >= maxSubmitRetries) {
          throw new Error(`Azure OCR network error: ${this.sanitizeErrorMessage(networkErr.message)}`);
        }
        await new Promise((r) => setTimeout(r, Math.pow(2, submitAttempts) * 1000));
      }
    }

    if (!submitRes || !submitRes.ok) {
      const status = submitRes ? submitRes.status : 500;
      let errText = '';
      try {
        errText = submitRes ? await submitRes.text() : 'No response from Azure';
      } catch {
        errText = 'Failed to read response body';
      }
      throw new Error(`Azure OCR submission failed (HTTP ${status}): ${this.sanitizeErrorMessage(errText)}`);
    }

    const operationLocation = submitRes.headers.get('operation-location') || submitRes.headers.get('Operation-Location');
    if (!operationLocation) {
      throw new Error('Azure response did not include Operation-Location header');
    }

    // 2. Poll for completion (up to 90 seconds with 1.5s interval + backoff on 429)
    let attempts = 0;
    const maxAttempts = 60; // 60 * 1.5s = 90s
    let resultData: any = null;

    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1500));
      attempts++;

      let pollRes: Response | globalThis.Response;
      try {
        pollRes = await fetch(operationLocation, {
          method: 'GET',
          headers: {
            'Ocp-Apim-Subscription-Key': key,
          },
        });
      } catch (pollErr: any) {
        if (attempts >= maxAttempts) {
          throw new Error(`Polling Azure OCR status network error: ${this.sanitizeErrorMessage(pollErr.message)}`);
        }
        continue;
      }

      if (pollRes.status === 429) {
        // Azure rate limit during polling - wait and retry
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      if (!pollRes.ok) {
        throw new Error(`Polling Azure OCR status failed (HTTP ${pollRes.status})`);
      }

      const pollData: any = await pollRes.json();
      const status = pollData.status;

      if (status === 'succeeded') {
        resultData = pollData.analyzeResult;
        break;
      } else if (status === 'failed' || status === 'canceled') {
        const msg = pollData.error?.message || `Azure analysis status: ${status}`;
        throw new Error(`Azure OCR processing failed: ${this.sanitizeErrorMessage(msg)}`);
      }
    }

    if (!resultData) {
      throw new Error('Azure OCR request timed out after 90 seconds');
    }

    return this.parseAzureAnalyzeResult(resultData, modelId);
  }

  /**
   * Sanitizes error messages to strictly prevent credential or private key leaks
   */
  private sanitizeErrorMessage(msg: string): string {
    const key = this.getKey();
    let sanitized = msg || '';
    if (key && key.length > 5) {
      sanitized = sanitized.split(key).join('[REDACTED_AZURE_KEY]');
    }
    return sanitized.replace(/Ocp-Apim-Subscription-Key[:=]\s*[^\s,;&]+/gi, 'Ocp-Apim-Subscription-Key=[REDACTED]');
  }

  private parseAzureAnalyzeResult(analyzeResult: any, modelId: string): OCRAnalysisResult {
    const rawText = analyzeResult.content || '';
    const pages: OCRPage[] = [];
    const tables: OCRExtractedTable[] = [];

    // Parse Pages
    if (Array.isArray(analyzeResult.pages)) {
      for (const p of analyzeResult.pages) {
        pages.push({
          pageNumber: p.pageNumber,
          width: p.width,
          height: p.height,
          unit: p.unit,
          linesCount: p.lines?.length || 0,
          wordsCount: p.words?.length || 0,
          rawText: p.lines?.map((l: any) => l.content).join('\n') || '',
        });
      }
    }

    // Parse Tables
    if (Array.isArray(analyzeResult.tables)) {
      analyzeResult.tables.forEach((t: any, tableIdx: number) => {
        const pageNum = t.boundingRegions?.[0]?.pageNumber || 1;
        const rowCount = t.rowCount || 0;
        const columnCount = t.columnCount || 0;

        // Group cells by rowIndex
        const rowMap = new Map<number, OCRExtractedCell[]>();
        let totalConfidence = 0;
        let cellCount = 0;

        if (Array.isArray(t.cells)) {
          for (const c of t.cells) {
            const raw = c.content || '';
            const normalized = DataNormalizer.normalizeCell(raw);
            const conf = typeof c.confidence === 'number' ? c.confidence : 0.95;
            totalConfidence += conf;
            cellCount++;

            const extractedCell: OCRExtractedCell = {
              rowIndex: c.rowIndex,
              columnIndex: c.columnIndex,
              rowSpan: c.rowSpan || 1,
              columnSpan: c.columnSpan || 1,
              rawValue: raw,
              normalizedValue: normalized.normalizedValue,
              cellType: normalized.cellType,
              confidence: conf,
              kind: c.kind || (c.rowIndex === 0 ? 'columnHeader' : 'content'),
              boundingPolygon: c.boundingRegions?.[0]?.polygon,
            };

            const existingRow = rowMap.get(c.rowIndex) || [];
            existingRow.push(extractedCell);
            rowMap.set(c.rowIndex, existingRow);
          }
        }

        const rows: OCRExtractedRow[] = [];
        for (let r = 0; r < rowCount; r++) {
          const cells = rowMap.get(r) || [];
          cells.sort((a, b) => a.columnIndex - b.columnIndex);
          rows.push({
            rowIndex: r,
            isHeader: r === 0,
            cells,
          });
        }

        const headers = rows[0]?.cells.map((c) => c.rawValue) || [];
        const avgConfidence = cellCount > 0 ? totalConfidence / cellCount : 0.95;

        tables.push({
          pageNumber: pageNum,
          tableIndex: tableIdx,
          rowCount,
          columnCount,
          confidence: Number(avgConfidence.toFixed(4)),
          boundingRegions: t.boundingRegions,
          rows,
          headers,
        });
      });
    }

    return {
      provider: this.providerName,
      modelId,
      overallConfidence: tables[0]?.confidence ?? (pages[0]?.confidence ?? 0.95),
      rawText,
      pages,
      tables,
      metadata: {
        model: modelId,
        pageCount: pages.length,
        tableCount: tables.length,
      },
    };
  }

  /**
   * High-fidelity Realistic Banking Statement Simulation
   * Generates realistic bank statements (Techcombank / Vietcombank / BIDV) with
   * actual Vietnamese banking fields, dates, amounts, varying confidence scores
   * (to test low confidence detection), and bounding polygons.
   */
  private generateSimulatedBankingOCR(_fileBuffer?: Buffer, modelId: string = 'prebuilt-layout'): OCRAnalysisResult {
    const rawContent = `NGÂN HÀNG THƯƠNG MẠI CỔ PHẦN NGOẠI THƯƠNG VIỆT NAM (VIETCOMBANK)
BẢNG SAO KÊ TÀI KHOẢN TIỀN GỬI THANH TOÁN
Chủ tài khoản: CÔNG TY TNHH ĐẦU TƯ & THƯƠNG MẠI VIỆT Á
Số tài khoản: 0011004567890
Kỳ sao kê: 01/08/2026 - 31/08/2026
Loại tiền tệ: VND (Việt Nam Đồng)

BẢNG GIAO DỊCH CHI TIẾT:
Ngày GD | Số chứng từ | Diễn giải | Số tiền ghi nợ | Số tiền ghi có | Số dư cuối
01/08/2026 | FT260801001 | Số dư đầu kỳ chuyển sang | 0 | 0 | 125.450.000
03/08/2026 | FT260803882 | Cty ABC thanh toán HĐ 1042/2026 | 0 | 45.000.000 | 170.450.000
07/08/2026 | FT260807119 | Thanh toán tiền thuê văn phòng T8/2026 | 18.500.000 | 0 | 151.950.000
12/08/2026 | FT260812450 | Thu hồi công nợ chi nhánh Đà Nẵng | 0 | 62.800.000 | 214.750.000
15/08/2026 | FT260815993 | Chi trả lương nhân viên đợt 1 | 35.200.000 | 0 | 179.550.000
20/08/2026 | FT260820114 | Chuyển khoản mua VPP & trang thiết bị | 4.650.000 | 0 | 174.900.000
28/08/2026 | FT260828771 | Thu tiền bán lẻ showroom Hà Nội | 0 | 28.500.000 | 203.400.000
31/08/2026 | FT260831902 | Lãi tiền gửi không kỳ hạn tháng 08/2026 | 0 | 148.500 | 203.548.500

Tổng phát sinh Nợ: 58.350.000 VND
Tổng phát sinh Có: 136.448.500 VND
Số dư cuối kỳ: 203.548.500 VND`;

    const sampleTableData = [
      // Row 0: Headers
      [
        { text: 'Ngày GD', conf: 0.99, kind: 'columnHeader' as const },
        { text: 'Số chứng từ', conf: 0.98, kind: 'columnHeader' as const },
        { text: 'Nội dung diễn giải', conf: 0.97, kind: 'columnHeader' as const },
        { text: 'Số tiền Nợ (VND)', conf: 0.99, kind: 'columnHeader' as const },
        { text: 'Số tiền Có (VND)', conf: 0.99, kind: 'columnHeader' as const },
        { text: 'Số dư (VND)', conf: 0.98, kind: 'columnHeader' as const },
      ],
      // Row 1: Số dư đầu kỳ
      [
        { text: '01/08/2026', conf: 0.98, kind: 'content' as const },
        { text: 'FT260801001', conf: 0.96, kind: 'content' as const },
        { text: 'Số dư đầu kỳ chuyển sang', conf: 0.97, kind: 'content' as const },
        { text: '0', conf: 0.99, kind: 'content' as const },
        { text: '0', conf: 0.99, kind: 'content' as const },
        { text: '125.450.000', conf: 0.98, kind: 'content' as const },
      ],
      // Row 2: Thanh toán
      [
        { text: '03/08/2026', conf: 0.96, kind: 'content' as const },
        { text: 'FT260803882', conf: 0.95, kind: 'content' as const },
        { text: 'Cty ABC thanh toán HĐ 1042/2026', conf: 0.92, kind: 'content' as const },
        { text: '0', conf: 0.99, kind: 'content' as const },
        { text: '45.000.000', conf: 0.98, kind: 'content' as const },
        { text: '170.450.000', conf: 0.97, kind: 'content' as const },
      ],
      // Row 3: Chi phí thuê (chứa ô low confidence 0.65 để test tính năng cảnh báo kiểm tra)
      [
        { text: '07/08/2026', conf: 0.95, kind: 'content' as const },
        { text: 'FT260807119', conf: 0.65, kind: 'content' as const }, // Low confidence for review testing!
        { text: 'Thanh toán tiền thuê văn phòng T8/2026', conf: 0.94, kind: 'content' as const },
        { text: '18.500.000', conf: 0.98, kind: 'content' as const },
        { text: '0', conf: 0.99, kind: 'content' as const },
        { text: '151.950.000', conf: 0.96, kind: 'content' as const },
      ],
      // Row 4: Thu hồi công nợ
      [
        { text: '12/08/2026', conf: 0.97, kind: 'content' as const },
        { text: 'FT260812450', conf: 0.94, kind: 'content' as const },
        { text: 'Thu hồi công nợ chi nhánh Đà Nẵng', conf: 0.91, kind: 'content' as const },
        { text: '0', conf: 0.99, kind: 'content' as const },
        { text: '62.800.000', conf: 0.97, kind: 'content' as const },
        { text: '214.750.000', conf: 0.96, kind: 'content' as const },
      ],
      // Row 5: Chi lương
      [
        { text: '15/08/2026', conf: 0.96, kind: 'content' as const },
        { text: 'FT260815993', conf: 0.95, kind: 'content' as const },
        { text: 'Chi trả lương nhân viên đợt 1', conf: 0.93, kind: 'content' as const },
        { text: '35.200.000', conf: 0.98, kind: 'content' as const },
        { text: '0', conf: 0.99, kind: 'content' as const },
        { text: '179.550.000', conf: 0.97, kind: 'content' as const },
      ],
      // Row 6: Mua VPP (chứa ô medium confidence 0.78)
      [
        { text: '20/08/2026', conf: 0.94, kind: 'content' as const },
        { text: 'FT260820114', conf: 0.78, kind: 'content' as const },
        { text: 'Chuyển khoản mua VPP & trang thiết bị', conf: 0.88, kind: 'content' as const },
        { text: '4.650.000', conf: 0.97, kind: 'content' as const },
        { text: '0', conf: 0.99, kind: 'content' as const },
        { text: '174.900.000', conf: 0.95, kind: 'content' as const },
      ],
      // Row 7: Thu tiền bán lẻ
      [
        { text: '28/08/2026', conf: 0.98, kind: 'content' as const },
        { text: 'FT260828771', conf: 0.96, kind: 'content' as const },
        { text: 'Thu tiền bán lẻ showroom Hà Nội', conf: 0.95, kind: 'content' as const },
        { text: '0', conf: 0.99, kind: 'content' as const },
        { text: '28.500.000', conf: 0.98, kind: 'content' as const },
        { text: '203.400.000', conf: 0.97, kind: 'content' as const },
      ],
      // Row 8: Lãi tiền gửi
      [
        { text: '31/08/2026', conf: 0.99, kind: 'content' as const },
        { text: 'FT260831902', conf: 0.97, kind: 'content' as const },
        { text: 'Lãi tiền gửi không kỳ hạn tháng 08/2026', conf: 0.96, kind: 'content' as const },
        { text: '0', conf: 0.99, kind: 'content' as const },
        { text: '148.500', conf: 0.98, kind: 'content' as const },
        { text: '203.548.500', conf: 0.98, kind: 'content' as const },
      ],
    ];

    const rows: OCRExtractedRow[] = [];
    let totalConf = 0;
    let cellTotal = 0;

    sampleTableData.forEach((rowCells, rIdx) => {
      const cells: OCRExtractedCell[] = [];
      const rowY = 0.28 + rIdx * 0.06; // Normalized top coordinate on page

      rowCells.forEach((cData, cIdx) => {
        const norm = DataNormalizer.normalizeCell(cData.text);
        totalConf += cData.conf;
        cellTotal++;

        // Simulated polygon [x1, y1, x2, y2, x3, y3, x4, y4] in page normalized bounds (0 to 1)
        const colWidths = [0.12, 0.14, 0.32, 0.14, 0.14, 0.14];
        const colX = 0.05 + colWidths.slice(0, cIdx).reduce((a, b) => a + b, 0);
        const colW = colWidths[cIdx] || 0.12;

        const polygon = [
          Number(colX.toFixed(3)),
          Number(rowY.toFixed(3)),
          Number((colX + colW).toFixed(3)),
          Number(rowY.toFixed(3)),
          Number((colX + colW).toFixed(3)),
          Number((rowY + 0.05).toFixed(3)),
          Number(colX.toFixed(3)),
          Number((rowY + 0.05).toFixed(3)),
        ];

        cells.push({
          rowIndex: rIdx,
          columnIndex: cIdx,
          rowSpan: 1,
          columnSpan: 1,
          rawValue: cData.text,
          normalizedValue: norm.normalizedValue,
          cellType: norm.cellType,
          confidence: cData.conf,
          kind: cData.kind,
          boundingPolygon: polygon,
        });
      });

      rows.push({
        rowIndex: rIdx,
        isHeader: rIdx === 0,
        cells,
      });
    });

    const avgConf = cellTotal > 0 ? totalConf / cellTotal : 0.95;

    const table: OCRExtractedTable = {
      pageNumber: 1,
      tableIndex: 0,
      rowCount: rows.length,
      columnCount: 6,
      confidence: Number(avgConf.toFixed(4)),
      boundingRegions: [{ pageNumber: 1, polygon: [0.05, 0.28, 0.95, 0.28, 0.95, 0.85, 0.05, 0.85] }],
      rows,
      headers: rows[0]?.cells?.map((c) => c.rawValue) || [],
    };

    return {
      provider: this.providerName,
      modelId,
      overallConfidence: Number(avgConf.toFixed(4)),
      rawText: rawContent,
      pages: [
        {
          pageNumber: 1,
          width: 8.5,
          height: 11,
          unit: 'inch',
          linesCount: 24,
          wordsCount: 168,
          rawText: rawContent,
          confidence: Number(avgConf.toFixed(4)),
        },
      ],
      tables: [table],
      metadata: {
        model: modelId,
        source: 'Azure AI Document Intelligence (prebuilt-layout)',
        simulated: true,
      },
    };
  }
}

export const azureOcrProvider = new AzureDocumentIntelligenceProvider();
