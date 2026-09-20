import { NativeEventEmitter } from 'react-native';
import NativeDocumentProcessor, { DocumentResult } from '../native/turbo_modules/DocumentProcessor/NativeDocumentProcessor';
import { getRelevantChunks, DocumentChunk } from '../utils/BM25';

export interface DocumentProgressEvent {
  message: string;
  progress: number;
}

export interface ProcessOptions {
  maxPages?: number;
  maxChars?: number;
}

class DocumentServiceImpl {
  private eventEmitter = new NativeEventEmitter(NativeDocumentProcessor as any);

  /**
   * Process a document natively (extract text, OCR, parse OOXML).
   */
  public async processDocument(filePath: string, options?: ProcessOptions): Promise<DocumentResult> {
    const optionsJson = JSON.stringify(options || {});
    const resultString = await NativeDocumentProcessor.processDocument(filePath, optionsJson);
    const result: DocumentResult = JSON.parse(resultString);
    if (!result.success) {
      throw new Error(result.errorMessage || 'Unknown document processing error');
    }
    return result;
  }

  /**
   * Cancel in-flight processing.
   */
  public cancelProcessing(): Promise<boolean> {
    return NativeDocumentProcessor.cancelProcessing();
  }

  /**
   * Listen to progress events.
   */
  public onProgress(callback: (event: DocumentProgressEvent | any) => void): () => void {
    const sub = this.eventEmitter.addListener('onDocumentProgress', callback);
    return () => sub.remove();
  }

  /**
   * Helper to chunk the extracted text by semantic boundaries (like pages or paragraphs).
   */
  public chunkDocumentText(text: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    
    // Split by page markers if they exist (e.g. "[Page 1]")
    const pageRegex = /\[Page \d+\]/g;
    const matches = Array.from(text.matchAll(pageRegex));
    
    if (matches.length > 0) {
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const startIndex = match.index!;
        const endIndex = i < matches.length - 1 ? matches[i + 1].index! : text.length;
        
        const chunkText = text.substring(startIndex, endIndex).trim();
        if (chunkText.length > 0) {
          chunks.push({
            index: i,
            text: chunkText,
            metadata: match[0],
          });
        }
      }
    } else {
      // If no page markers, split by double newlines (paragraphs/sections)
      const paragraphs = text.split(/\n\s*\n/);
      let currentChunk = '';
      let chunkIndex = 0;
      const MAX_CHUNK_LENGTH = 1500; // Roughly 500 tokens
      
      for (const p of paragraphs) {
        if ((currentChunk.length + p.length) > MAX_CHUNK_LENGTH && currentChunk.length > 0) {
          chunks.push({ index: chunkIndex++, text: currentChunk.trim(), metadata: `[Section ${chunkIndex}]` });
          currentChunk = p + '\n\n';
        } else {
          currentChunk += p + '\n\n';
        }
      }
      
      if (currentChunk.trim().length > 0) {
        chunks.push({ index: chunkIndex, text: currentChunk.trim(), metadata: `[Section ${chunkIndex + 1}]` });
      }
    }
    
    return chunks;
  }

  /**
   * Retrieves the most relevant chunks based on the user's query and a token limit.
   */
  public getRelevantContext(query: string, documentText: string, maxTokens: number = 2000): string {
    const chunks = this.chunkDocumentText(documentText);
    
    // Assuming ~3.5 chars per token
    const maxChars = maxTokens * 3.5;
    
    // Sort chunks by relevance
    const topK = Math.max(3, Math.floor(maxChars / 1500)); // Try to get enough chunks to fill the budget
    const relevantChunks = getRelevantChunks(query, chunks, topK);
    
    // Reassemble them in original chronological order for readability
    relevantChunks.sort((a, b) => a.index - b.index);
    
    let context = '';
    for (const chunk of relevantChunks) {
      if (context.length + chunk.text.length > maxChars && context.length > 0) {
        break; // Reached budget limit
      }
      context += chunk.text + '\n\n';
    }
    
    return context.trim();
  }
}

export default new DocumentServiceImpl();
