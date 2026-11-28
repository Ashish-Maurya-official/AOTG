export interface EvidenceChunk {
  index: number;
  text: string;
  metadata: string;
}

export interface Retriever {
  retrieve(query: string, chunks: EvidenceChunk[], limit: number): EvidenceChunk[];
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'what', 'which', 'of', 'for', 'to', 'in', 'and', 'है', 'हैं', 'का', 'की', 'के', 'में', 'क्या']);

function terms(text: string): string[] {
  return (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || []).filter(term => !STOP_WORDS.has(term));
}

function truncateText(text: string, limit: number): string {
  let end = Math.min(text.length, Math.max(0, Math.floor(limit)));
  if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
  return text.slice(0, end);
}

export function chunkText(text: string, maxChars = 1200): EvidenceChunk[] {
  const limit = Number.isFinite(maxChars) ? Math.max(64, Math.min(4000, Math.floor(maxChars))) : 1200;
  const chunks: EvidenceChunk[] = [];
  let location = '';
  const sections = text.replace(/\r\n/g, '\n').split(/(?=\[Page \d+\])|\n\s*\n/);
  for (const section of sections) {
    const page = section.match(/^\[Page \d+\]/)?.[0];
    if (page) location = page;
    // Work on bounded string slices; a huge page must not allocate an array per character.
    for (let offset = 0; offset < section.length;) {
      const chunk = truncateText(section.slice(offset, offset + limit + 1), limit);
      offset += chunk.length;
      if (chunk.trim()) chunks.push({ index: chunks.length, text: chunk.trim(), metadata: location || `[Section ${chunks.length + 1}]` });
    }
  }
  return chunks;
}

export const lexicalRetriever: Retriever = {
  retrieve(query, chunks, limit) {
    const queryTerms = [...new Set(terms(query))];
    if (!queryTerms.length) return [];
    const vocabulary = new Set(queryTerms);
    const documents = chunks.map(chunk => {
      const tokens = terms(chunk.text);
      const frequencies = new Map<string, number>();
      tokens.forEach(token => { if (vocabulary.has(token)) frequencies.set(token, (frequencies.get(token) || 0) + 1); });
      return { chunk, frequencies, length: tokens.length };
    });
    const average = documents.reduce((sum, document) => sum + document.length, 0) / Math.max(1, documents.length) || 1;
    const df = new Map(queryTerms.map(term => [term, documents.filter(document => document.frequencies.has(term)).length]));
    return documents.map(document => ({
      chunk: document.chunk,
      score: queryTerms.reduce((score, term) => {
        const frequency = document.frequencies.get(term) || 0;
        const idf = Math.log(1 + (documents.length - (df.get(term) || 0) + 0.5) / ((df.get(term) || 0) + 0.5));
        return score + idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * document.length / average));
      }, 0),
    })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index)
      .slice(0, Math.max(0, limit)).map(item => item.chunk);
  },
};

export function retrieveContext(query: string, text: string, maxChars: number, retriever: Retriever = lexicalRetriever): string {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return '';
  const chunks = chunkText(text);
  const overview = !query.trim() || /\b(summari[sz]e|summary|overview)\b|सारांश|संक्षेप/iu.test(query);
  // Summaries explicitly sample sections; a failed relevance match never falls back to the opening page.
  const selected = overview ? chunks.filter((_, index) => index % Math.max(1, Math.ceil(chunks.length / 6)) === 0).slice(0, 6)
    : retriever.retrieve(query, chunks, 6);
  const sectionBudget = Math.max(0, Math.floor((maxChars - Math.max(0, selected.length - 1) * 2) / Math.max(1, selected.length)));
  const context = selected.map(chunk => {
    const evidence = `${chunk.metadata}\n${chunk.text}`;
    return overview ? truncateText(evidence, sectionBudget) : evidence;
  }).join('\n\n');
  return truncateText(context, maxChars);
}
