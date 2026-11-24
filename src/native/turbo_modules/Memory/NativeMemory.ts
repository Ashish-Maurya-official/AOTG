import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface MemoryInfoResult {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  nativeHeapBytes: number;
  isLowMemory: boolean;
}

export interface Spec extends TurboModule {
  getMemoryInfo(): Promise<MemoryInfoResult>;
}

export default TurboModuleRegistry.get<Spec>('DeviceMemory');
