import type {CodegenTypes, TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export interface Spec extends TurboModule {
  initialize(modelPath: string, backend: string): Promise<boolean>;

  startGeneration(prompt: string): void;

  stopGeneration(): void;

  readonly onToken: CodegenTypes.EventEmitter<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('LLM');
