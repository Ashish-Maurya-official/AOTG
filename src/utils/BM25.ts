/**
 * A lightweight BM25-style lexical ranker for selecting relevant document chunks.
 */

export interface DocumentChunk {
  index: number;
  text: string;
  metadata: string; // e.g. "[Page 1]" or "[Sheet 1]"
}

// Simple English stop words to ignore during tokenization
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
  'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were', 'will', 'with'
]);

/**
 * Tokenize a string into lowercased terms, ignoring punctuation and common stop words.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(term => term.length > 1 && !STOP_WORDS.has(term));
}

/**
 * Ranks chunks based on a simplified BM25 / TF-IDF scoring algorithm against the query.
 * 
 * @param query The user's search query or prompt
 * @param chunks The array of document chunks to rank
 * @param topK The maximum number of top-scoring chunks to return
 * @returns Sorted array of chunks (most relevant first)
 */
export function getRelevantChunks(
  query: string,
  chunks: DocumentChunk[],
  topK: number = 3
): DocumentChunk[] {
  if (!query.trim() || chunks.length === 0) return chunks.slice(0, topK);

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return chunks.slice(0, topK);

  // 1. Compute Document Frequencies (DF) - how many chunks contain each term
  const df = new Map<string, number>();
  const chunkTokenized = chunks.map(chunk => {
    const terms = tokenize(chunk.text);
    const uniqueTerms = new Set(terms);
    uniqueTerms.forEach(term => {
      df.set(term, (df.get(term) || 0) + 1);
    });
    return { chunk, terms };
  });

  const totalChunks = chunks.length;

  // 2. Score each chunk
  // Simple BM25-like score: Score = Sum(IDF * TF)
  // IDF = log((totalChunks - DF + 0.5) / (DF + 0.5) + 1)
  const scoredChunks = chunkTokenized.map(({ chunk, terms }) => {
    let score = 0;
    
    // Term Frequency (TF) for this chunk
    const tf = new Map<string, number>();
    terms.forEach(term => {
      tf.set(term, (tf.get(term) || 0) + 1);
    });

    queryTerms.forEach(term => {
      const termDf = df.get(term) || 0;
      if (termDf > 0) {
        const idf = Math.log((totalChunks - termDf + 0.5) / (termDf + 0.5) + 1);
        const termTf = tf.get(term) || 0;
        
        // k1 and b are standard BM25 constants. 
        // We simplify by just using a basic dampening for TF.
        const k1 = 1.2;
        const dampenedTf = (termTf * (k1 + 1)) / (termTf + k1);
        
        score += idf * dampenedTf;
      }
    });

    return { chunk, score };
  });

  // 3. Sort by score descending and return top K
  scoredChunks.sort((a, b) => b.score - a.score);
  
  // If scores are all 0 (no keyword match), just return the first few chunks
  if (scoredChunks.length > 0 && scoredChunks[0].score === 0) {
    return chunks.slice(0, topK);
  }

  return scoredChunks.slice(0, topK).map(sc => sc.chunk);
}
