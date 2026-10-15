import { AVAILABLE_MODELS, BackendType, ModelInfo } from '../store/slices/llmSlice';

const GENERIC_NOISE_TOKENS = new Set([
    'litertlm', 'litert', 'lm', 'gpu', 'cpu', 'npu', 'opencl', 'vulkan',
    'download', 'community', 'hf', 'resolve', 'main', 'true', 'model', 'file',
    'multi', 'prefill', 'seq', 'int4', 'int8', 'q4', 'q8', 'f16', 'f32', 'ekv',
    'hadamard', 'aot'
]);

/**
 * Strips .litertlm, whitespace, and browser duplicate suffixes like (1), _1, -1.
 */
export function cleanModelFileName(name: string): string {
    if (!name) return '';
    return name
        .trim()
        .replace(/\.litertlm$/i, '')
        .replace(/\s*\(\d+\)$/, '')
        .replace(/[_-]\d+$/, '')
        .trim();
}

/**
 * Normalizes text for matching by lowercasing and stripping punctuation and separators.
 */
export function normalizeTokenKey(text: string): string {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/\.litertlm$/i, '')
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Strips hardware/backend and packaging qualifiers from a model name/filename.
 */
export function stripHardwareSuffixes(text: string): string {
    if (!text) return '';
    return text
        .replace(/\.litertlm$/i, '')
        .replace(/[_-](gpu|cpu|npu|opencl|vulkan|tensor-npu|tensor-g4-npu|g4-npu)$/i, '')
        .replace(/[_-](int4|int8|q4|q8|f16|f32|ekv\d+|seq\d+|multi-prefill-seq|hadamard|aot)$/i, '')
        .replace(/[_-](litertlm|litert-lm|litert|lm)$/i, '')
        .trim();
}

/**
 * Extracts normalized semantic tokens from text, omitting generic noise words.
 */
export function extractIdentityTokens(text: string): string[] {
    if (!text) return [];
    return text
        .toLowerCase()
        .replace(/\.litertlm$/i, '')
        .split(/[^a-z0-9]+/)
        .filter(t => t.length > 0 && !GENERIC_NOISE_TOKENS.has(t));
}

/**
 * Detects whether a token denotes a model parameter scale (e.g. '2b', 'e2b', '7b', '300m', '14b', '26b', 'a4b').
 */
function isParameterScaleToken(token: string): boolean {
    return /^([a-z]?\d+(\.\d+)?[bmk])$/i.test(token) || /^[a-z]\d+[a-z]$/i.test(token);
}

export interface MatchResult {
    model: ModelInfo | null;
    confidence: number;
}

/**
 * Completely data-driven, dynamic catalog matcher.
 * Compares an imported file against all models currently in the catalog WITHOUT any hardcoded model names.
 * When new models are added to AVAILABLE_MODELS, this automatically matches them.
 */
export function findBestCatalogMatch(
    fileNameOrPath: string,
    catalog: ModelInfo[] = AVAILABLE_MODELS
): MatchResult {
    if (!fileNameOrPath || !catalog.length) {
        return { model: null, confidence: 0 };
    }

    const rawFileName = fileNameOrPath.split('/').pop()?.split('\\').pop() || fileNameOrPath;
    const cleanInput = cleanModelFileName(rawFileName);
    const lowerInput = cleanInput.toLowerCase();
    const strippedInput = normalizeTokenKey(stripHardwareSuffixes(cleanInput));
    const inputTokens = extractIdentityTokens(cleanInput);

    if (inputTokens.length === 0) {
        return { model: null, confidence: 0 };
    }

    const inputScaleTokens = inputTokens.filter(isParameterScaleToken);

    let bestModel: ModelInfo | null = null;
    let highestScore = 0;

    for (const model of catalog) {
        const cleanFile = cleanModelFileName(model.fileName);
        const urlBasename = model.url.split('/').pop()?.split('?')[0] || '';
        const cleanUrl = cleanModelFileName(urlBasename);
        const cleanId = cleanModelFileName(model.id);
        const cleanName = cleanModelFileName(model.name);

        // 1. Exact match on fileName, URL basename, ID, or Name
        if (
            cleanFile.toLowerCase() === lowerInput ||
            (cleanUrl && cleanUrl.toLowerCase() === lowerInput) ||
            cleanId.toLowerCase() === lowerInput ||
            cleanName.toLowerCase() === lowerInput
        ) {
            return { model, confidence: 1.0 };
        }

        // 2. Exact match after stripping hardware/packaging suffixes
        const strippedFile = normalizeTokenKey(stripHardwareSuffixes(model.fileName));
        const strippedUrl = normalizeTokenKey(stripHardwareSuffixes(urlBasename));
        const strippedId = normalizeTokenKey(stripHardwareSuffixes(model.id));

        if (
            (strippedFile && strippedFile === strippedInput) ||
            (strippedUrl && strippedUrl === strippedInput) ||
            (strippedId && strippedId === strippedInput)
        ) {
            return { model, confidence: 0.95 };
        }

        // 3. Dynamic Token Overlap Scoring
        const modelTokens = Array.from(new Set([
            ...extractIdentityTokens(model.id),
            ...extractIdentityTokens(model.name),
            ...extractIdentityTokens(model.fileName),
            ...extractIdentityTokens(urlBasename),
        ]));

        if (modelTokens.length === 0) continue;

        const modelScaleTokens = modelTokens.filter(isParameterScaleToken);

        // Parameter Scale Compatibility Check:
        // If the imported filename specifically mentions a model scale (e.g. '26b' or 'e2b' or '7b')
        // that conflicts with the catalog model's scale, disqualify this candidate.
        if (inputScaleTokens.length > 0 && modelScaleTokens.length > 0) {
            const hasCommonScale = inputScaleTokens.some(st => modelScaleTokens.includes(st));
            if (!hasCommonScale) {
                // Scales directly conflict (e.g. user imported '26b' but catalog model is '2b')
                continue;
            }
        }

        // Calculate token overlap
        const modelTokenSet = new Set(modelTokens);
        const matchedTokens = inputTokens.filter(t => modelTokenSet.has(t));
        const matchRatio = matchedTokens.length / inputTokens.length;

        // Give extra weight if all primary non-scale tokens match
        const primaryInputTokens = inputTokens.filter(t => !isParameterScaleToken(t));
        const primaryMatched = primaryInputTokens.filter(t => modelTokenSet.has(t));
        const primaryRatio = primaryInputTokens.length > 0
            ? primaryMatched.length / primaryInputTokens.length
            : matchRatio;

        const combinedScore = (matchRatio * 0.5) + (primaryRatio * 0.5);

        if (combinedScore > highestScore) {
            highestScore = combinedScore;
            bestModel = model;
        }
    }

    if (bestModel && highestScore >= 0.75) {
        return { model: bestModel, confidence: highestScore };
    }

    return { model: null, confidence: highestScore };
}

/**
 * Returns matching catalog model if confidence is >= 0.75, or null otherwise.
 * Works dynamically with any catalog model.
 */
export function findMatchingCatalogModel(
    fileNameOrPath: string,
    catalog: ModelInfo[] = AVAILABLE_MODELS
): ModelInfo | null {
    const result = findBestCatalogMatch(fileNameOrPath, catalog);
    return result.confidence >= 0.75 ? result.model : null;
}

/**
 * Generic heuristics to infer initial defaults for custom imported models.
 * Operates on generic keywords (vision, audio, asr, reasoning, coder, etc.).
 */
export function inferModelCapabilities(fileName: string, fileSize?: number | null): Partial<ModelInfo> {
    const lower = (fileName || '').toLowerCase();

    // 1. Generic Vision Keywords (architectural tags, NOT model brand names)
    const isVision =
        lower.includes('vision') ||
        lower.includes('-vl') ||
        lower.includes('_vl') ||
        lower.includes('image') ||
        lower.includes('multimodal') ||
        lower.includes('visual') ||
        lower.includes('ocr');

    // 2. Generic Audio Keywords (architectural tags)
    const isAudio =
        lower.includes('audio') ||
        lower.includes('speech') ||
        lower.includes('whisper') ||
        lower.includes('voice') ||
        lower.includes('sound');

    // 3. Generic Reasoning / Thinking Keywords
    const isThinking =
        lower.includes('reasoning') ||
        lower.includes('thinking') ||
        lower.includes('thought') ||
        lower.includes('reasoner');

    // 4. Function Calling / Agent Tools Keywords
    const isFunctionCalling =
        lower.includes('function') ||
        lower.includes('tool') ||
        lower.includes('action');

    // 5. Code Specialization Keywords
    const isCoder = lower.includes('coder') || lower.includes('code');

    // 6. Embedding Keywords
    const isEmbedding = lower.includes('embedding') || lower.includes('embed');

    // 7. ASR Specialization Keywords
    const isASR = lower.includes('asr') || lower.includes('speech-to-text');

    // 8. Supported Backends
    const supportedBackends: BackendType[] = ['GPU', 'CPU'];
    if (lower.includes('npu')) {
        supportedBackends.unshift('NPU');
    }

    // 9. Context Length: Dynamically extracted via regex (e.g. 8k -> 8192, 32k -> 32768, 128k -> 131072)
    let maxContextLength = 4096;
    const contextMatch = lower.match(/(?:^|[^a-z0-9])(\d{1,4})k(?:$|[^a-z0-9])/);
    if (contextMatch) {
        const kValue = parseInt(contextMatch[1], 10);
        if (!isNaN(kValue) && kValue >= 1 && kValue <= 2048) {
            maxContextLength = kValue * 1024;
        }
    }

    let badge = 'Custom';
    if (isVision && isAudio) {
        badge = 'Multimodal';
    } else if (isVision) {
        badge = 'Vision';
    } else if (isAudio) {
        badge = 'Audio';
    } else if (isThinking) {
        badge = 'Reasoning';
    } else if (isCoder) {
        badge = 'Coder';
    } else if (isEmbedding) {
        badge = 'Embedding';
    }

    return {
        badge,
        supportsVision: isVision,
        supportsAudio: isAudio,
        supportsThinking: isThinking,
        supportsFunctionCalling: isFunctionCalling,
        supportedBackends,
        maxContextLength,
        isCoder,
        isEmbedding,
        isASR,
        isInstruct: !isEmbedding && !isASR,
    };
}
