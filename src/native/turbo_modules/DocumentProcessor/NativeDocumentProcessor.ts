import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export interface DocumentResult {
  success: boolean;
  text: string;
  documentType: string;
  pageCount: number;
  charCount: number;
  warnings: string[];
  errorCode?: string;
  errorMessage?: string;
}

export interface Spec extends TurboModule {
  /**
   * Process a document file and extract its text content.
   * @param filePath Absolute path to the document file on device
   * @param optionsJson JSON string with processing options (maxPages, maxChars, etc.)
   * @returns JSON string of DocumentResult
   */
  processDocument(filePath: string, optionsJson: string): Promise<string>;

  /** Cancel any in-flight document processing */
  cancelProcessing(): Promise<boolean>;

  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DocumentProcessor');
