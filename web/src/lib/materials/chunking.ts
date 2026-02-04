import type { MaterialSegment } from "@/lib/materials/extract-text";

export type MaterialChunk = {
  text: string;
  sourceType: MaterialSegment["sourceType"];
  sourceIndex: number;
  sectionTitle?: string;
  extractionMethod: MaterialSegment["extractionMethod"];
  qualityScore?: number;
  tokenCount: number;
};

const DEFAULT_CHUNK_TOKENS = Number(process.env.CHUNK_TOKENS ?? 1000);
const DEFAULT_CHUNK_OVERLAP = Number(process.env.CHUNK_OVERLAP ?? 100);

export function estimateTokenCount(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function chunkSegments(segments: MaterialSegment[]) {
  const chunks: MaterialChunk[] = [];

  for (const segment of segments) {
    if (!segment.text.trim()) {
      continue;
    }

    const tokenCount = estimateTokenCount(segment.text);
    if (tokenCount <= DEFAULT_CHUNK_TOKENS) {
      chunks.push({
        text: segment.text,
        sourceType: segment.sourceType,
        sourceIndex: segment.sourceIndex,
        sectionTitle: segment.sectionTitle,
        extractionMethod: segment.extractionMethod,
        qualityScore: segment.qualityScore,
        tokenCount,
      });
      continue;
    }

    const words = segment.text.split(/\s+/g);
    let start = 0;
    while (start < words.length) {
      let end = start;
      let current = "";
      while (end < words.length) {
        const next = current ? `${current} ${words[end]}` : words[end];
        if (estimateTokenCount(next) > DEFAULT_CHUNK_TOKENS) {
          break;
        }
        current = next;
        end += 1;
      }

      if (current) {
        chunks.push({
          text: current,
          sourceType: segment.sourceType,
          sourceIndex: segment.sourceIndex,
          sectionTitle: segment.sectionTitle,
          extractionMethod: segment.extractionMethod,
          qualityScore: segment.qualityScore,
          tokenCount: estimateTokenCount(current),
        });
      }

      if (end >= words.length) {
        break;
      }

      start = Math.max(0, end - DEFAULT_CHUNK_OVERLAP);
    }
  }

  return chunks;
}
