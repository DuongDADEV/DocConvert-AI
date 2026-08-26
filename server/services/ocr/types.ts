import type { Buffer } from 'node:buffer';

export type CellType = 'TEXT' | 'MONEY' | 'DATE' | 'NUMBER';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface BoundingPolygon {
  points: { x: number; y: number }[]; // Normalized or pixel coordinates
  pageNumber: number;
}

export interface OCRExtractedCell {
  id?: string;
  rowIndex: number;
  columnIndex: number;
  rowSpan?: number;
  columnSpan?: number;
  rawValue: string;
  normalizedValue?: string;
  cellType: CellType;
  confidence: number;
  isReviewed?: boolean;
  kind?: 'content' | 'rowHeader' | 'columnHeader';
  boundingPolygon?: number[]; // [x1, y1, x2, y2, x3, y3, x4, y4]
}

export interface OCRExtractedRow {
  id?: string;
  rowIndex: number;
  isHeader?: boolean;
  cells: OCRExtractedCell[];
}

export interface OCRExtractedTable {
  id?: string;
  pageNumber: number;
  tableIndex: number;
  rowCount: number;
  columnCount: number;
  confidence: number;
  boundingRegions?: any[];
  rows: OCRExtractedRow[];
  headers?: string[];
}

export interface OCRPage {
  pageNumber: number;
  width?: number;
  height?: number;
  unit?: string;
  linesCount?: number;
  wordsCount?: number;
  rawText?: string;
  confidence?: number;
}

export interface OCRAnalysisResult {
  provider: string;
  modelId: string;
  overallConfidence: number;
  rawText: string;
  pages: OCRPage[];
  tables: OCRExtractedTable[];
  metadata?: Record<string, any>;
}

export interface DocumentAIProvider {
  readonly providerName: string;
  analyzeDocument(
    fileBuffer: Buffer,
    mimeType: string,
    options?: { modelId?: string; forceSimulation?: boolean }
  ): Promise<OCRAnalysisResult>;
}
