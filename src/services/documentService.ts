import { NativeEventEmitter, Platform } from 'react-native';
import NativeDocumentProcessor, { DocumentResult } from '../native/turbo_modules/DocumentProcessor/NativeDocumentProcessor';
import type { DocumentChunk } from '../utils/BM25';
import { chunkText, retrieveContext } from '../rag/retrieval';

export interface DocumentProgressEvent {
  message: string;
  progress: number;
}

export interface ProcessOptions {
  maxPages?: number;
  maxChars?: number;
}

class DocumentServiceImpl {
  private eventEmitter: NativeEventEmitter | null = null;

  constructor() {
    if (Platform.OS === 'android') {
      try {
        this.eventEmitter = new NativeEventEmitter(NativeDocumentProcessor as any);
      } catch (err) {
        console.warn('[DocumentService] Could not initialize NativeEventEmitter:', err);
      }
    }
  }

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
    if (!this.eventEmitter) {
      return () => {};
    }
    const sub = this.eventEmitter.addListener('onDocumentProgress', callback);
    return () => sub.remove();
  }

  /**
   * Helper to chunk the extracted text by semantic boundaries (like pages or paragraphs).
   */
  public chunkDocumentText(text: string): DocumentChunk[] {
    return chunkText(text);
  }

  /**
   * Retrieves the most relevant chunks based on the user's query and a token limit.
   */
  public getRelevantContext(query: string, documentText: string, maxTokens: number = 2000): string {
    // Conservative fallback until the selected model exposes its tokenizer.
    const charsPerToken = /\P{ASCII}/u.test(documentText) ? 0.75 : 2;
    return retrieveContext(query, documentText, Math.floor(Math.max(0, maxTokens) * charsPerToken));
  }
}

export default new DocumentServiceImpl();
