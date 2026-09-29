import AsyncStorage from '@react-native-async-storage/async-storage';
import { ModelInfo } from '../store/slices/llmSlice';

const EXTERNAL_PATHS_KEY = '@aotg/external_model_paths';
const CUSTOM_MODELS_KEY = '@aotg/custom_models';

export type ExternalModelPaths = Record<string, string>;

/**
 * Read all persisted external model paths.
 */
export async function loadExternalModelPaths(): Promise<ExternalModelPaths> {
    try {
        const raw = await AsyncStorage.getItem(EXTERNAL_PATHS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

/**
 * Persist an external path for a model.
 */
export async function saveExternalModelPath(
    modelId: string,
    path: string
): Promise<void> {
    const paths = await loadExternalModelPaths();
    paths[modelId] = path;
    await AsyncStorage.setItem(EXTERNAL_PATHS_KEY, JSON.stringify(paths));
}

/**
 * Remove a persisted external path (e.g. after re-downloading internally).
 */
export async function removeExternalModelPath(
    modelId: string
): Promise<void> {
    const paths = await loadExternalModelPaths();
    delete paths[modelId];
    await AsyncStorage.setItem(EXTERNAL_PATHS_KEY, JSON.stringify(paths));
}

/**
 * Load all persisted custom (non-catalog) imported models.
 */
export async function loadCustomModels(): Promise<ModelInfo[]> {
    try {
        const raw = await AsyncStorage.getItem(CUSTOM_MODELS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

/**
 * Persist a custom imported model.
 */
export async function saveCustomModel(model: ModelInfo): Promise<void> {
    const models = await loadCustomModels();
    if (!models.some(m => m.id === model.id)) {
        models.push(model);
    }
    await AsyncStorage.setItem(CUSTOM_MODELS_KEY, JSON.stringify(models));
}

/**
 * Remove a persisted custom model.
 */
export async function removeCustomModelStorage(modelId: string): Promise<void> {
    const models = await loadCustomModels();
    const filtered = models.filter(m => m.id !== modelId);
    await AsyncStorage.setItem(CUSTOM_MODELS_KEY, JSON.stringify(filtered));
}
