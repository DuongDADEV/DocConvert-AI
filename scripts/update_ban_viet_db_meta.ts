import 'dotenv/config';
import crypto from 'crypto';
import { db } from '../server/db/db.js';
import { MetadataFilterEngine } from '../server/services/ocr/metadataFilterEngine.js';

async function updateDb() {
  const userId = '30ed6381-0d2f-4d4a-a2f6-d8e0ac07452c';
  const docId = 'ffec64e8-f5d8-4e2d-929b-124882b3e099';
  const ocr = await db.getDocumentOcrResult(userId, docId);
  if (!ocr) {
    console.error('OCR not found');
    return;
  }
  const client = (db as any).getClient();

  // Clean old rows for this document
  const { error: delErr } = await client.from('document_metadata').delete().eq('document_id', docId);
  if (delErr) {
    console.error('Delete error:', delErr);
    return;
  }
  console.log('Cleaned old document_metadata rows');

  const now = new Date().toISOString();
  const newRecords = ocr.documentMetadata.map((m: any) => ({
    id: crypto.randomUUID(),
    document_id: docId,
    label: m.label,
    raw_label: m.rawLabel,
    value: m.value,
    raw_value: m.rawValue,
    normalized_label: MetadataFilterEngine.normalizeLabel(m.rawLabel),
    normalized_value_for_match: MetadataFilterEngine.normalizeValueForMatch(m.rawValue),
    confidence_score: m.confidence,
    source_page: m.sourcePage,
    key_bounding_box: m.keyBoundingPolygon ? { polygon: m.keyBoundingPolygon } : undefined,
    value_bounding_box: m.valueBoundingPolygon ? { polygon: m.valueBoundingPolygon } : undefined,
    occurrence_count: m.occurrenceCount || 1,
    status: m.status || 'AUTO',
    semantic_type: m.semanticType,
    quality_score: m.qualityScore,
    visibility_class: m.visibilityClass,
    alternatives: m.alternatives || [],
    created_at: now,
    updated_at: now,
  }));

  const { error: insErr } = await client.from('document_metadata').insert(newRecords);
  if (insErr) {
    console.error('Insert error:', insErr);
  } else {
    console.log(`Successfully inserted ${newRecords.length} clean metadata records into document_metadata!`);
  }
}

updateDb().catch(console.error);
