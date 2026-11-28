import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  configure(definitionsJson: string): Promise<boolean>;
  resolveTool(requestId: string, resultJson: string): Promise<boolean>;
  fetchPage(requestId: string, url: string): Promise<string>;
  renderPage(requestId: string, url: string): Promise<string>;
  saveSource(url: string): Promise<string>;
  searchSources(query: string): Promise<string>;
  sourceStatus(): Promise<string>;
  clearSources(): Promise<boolean>;
  cancelFetch(requestId: string): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('AgentTools');
