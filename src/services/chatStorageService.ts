import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSIONS_STORAGE_KEY = '@aotg/chat_sessions';
const ACTIVE_SESSION_STORAGE_KEY = '@aotg/active_session_id';
const MAX_SESSIONS = 50;

export interface Attachment {
    uri: string;
    name: string;
    type: string;
    size?: number;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    attachment?: Attachment;
    modelName?: string;
    backend?: string;
}

export interface ChatSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: ChatMessage[];
    modelName?: string;
    backend?: string;
}

// In-memory fallback stores to guarantee zero-crash operation even if native AsyncStorage module is unavailable
let memorySessions: ChatSession[] = [];
let memoryActiveSessionId: string | null = null;
let hasLoggedStorageWarning = false;

/**
 * Reset in-memory storage (used for unit tests).
 */
export function resetMemoryStoreForTesting(): void {
    memorySessions = [];
    memoryActiveSessionId = null;
    hasLoggedStorageWarning = false;
    storageQueue = Promise.resolve();
}

/**
 * Load all persisted chat sessions, sorted with newest first.
 * Falls back to in-memory store if native AsyncStorage is unavailable.
 */
export async function loadSessions(): Promise<ChatSession[]> {
    try {
        const raw = await AsyncStorage.getItem(SESSIONS_STORAGE_KEY);
        if (!raw) return memorySessions;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return memorySessions;
        const sorted = parsed.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        memorySessions = sorted;
        return sorted;
    } catch {
        return memorySessions;
    }
}

let storageQueue: Promise<void> = Promise.resolve();

/**
 * Persist or update a chat session. Capped at MAX_SESSIONS (50), pruning oldest.
 * Serialized via storageQueue to prevent race conditions during rapid message saving.
 * Seamlessly falls back to in-memory store if native AsyncStorage module is null/unlinked.
 */
export function saveSession(session: ChatSession): Promise<void> {
    storageQueue = storageQueue.then(async () => {
        try {
            const sessions = await loadSessions();
            const existingIndex = sessions.findIndex((s) => s.id === session.id);
            if (existingIndex >= 0) {
                sessions[existingIndex] = session;
            } else {
                sessions.unshift(session);
            }
            // Keep sorted by updatedAt descending
            sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            const capped = sessions.slice(0, MAX_SESSIONS);
            memorySessions = capped;
            await AsyncStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(capped));
        } catch (err) {
            if (!hasLoggedStorageWarning) {
                hasLoggedStorageWarning = true;
                console.warn('[chatStorageService] Native AsyncStorage module is unavailable. Using in-memory fallback store:', err);
            }
        }
    }).catch(() => {
        // Prevent unhandled promise rejection in queue
    });
    return storageQueue;
}

/**
 * Delete a specific chat session by ID.
 * Serialized via storageQueue to prevent race conditions.
 */
export function deleteSession(sessionId: string): Promise<void> {
    storageQueue = storageQueue.then(async () => {
        try {
            const sessions = await loadSessions();
            const filtered = sessions.filter((s) => s.id !== sessionId);
            memorySessions = filtered;
            await AsyncStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(filtered));
        } catch (err) {
            if (!hasLoggedStorageWarning) {
                hasLoggedStorageWarning = true;
                console.warn('[chatStorageService] Native AsyncStorage module is unavailable. Using in-memory fallback store:', err);
            }
        }

        try {
            const activeId = await loadActiveSessionId();
            if (activeId === sessionId) {
                await saveActiveSessionId(null);
            }
        } catch {
            // In-memory fallback
            if (memoryActiveSessionId === sessionId) {
                memoryActiveSessionId = null;
            }
        }
    }).catch(() => {
        // Prevent unhandled promise rejection in queue
    });
    return storageQueue;
}

/**
 * Read the ID of the last active chat session.
 */
export async function loadActiveSessionId(): Promise<string | null> {
    try {
        const stored = await AsyncStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
        if (stored) {
            memoryActiveSessionId = stored;
            return stored;
        }
        return memoryActiveSessionId;
    } catch {
        return memoryActiveSessionId;
    }
}

/**
 * Save the ID of the active chat session (or clear it if null).
 */
export async function saveActiveSessionId(sessionId: string | null): Promise<void> {
    memoryActiveSessionId = sessionId;
    try {
        if (sessionId) {
            await AsyncStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
        } else {
            await AsyncStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
        }
    } catch (err) {
        if (!hasLoggedStorageWarning) {
            hasLoggedStorageWarning = true;
            console.warn('[chatStorageService] Native AsyncStorage module is unavailable. Using in-memory fallback store:', err);
        }
    }
}

/**
 * Generate a new ChatSession with an optional initial user message.
 */
export function createSession(
    initialMessage?: ChatMessage,
    modelName?: string,
    backend?: string
): ChatSession {
    const now = Date.now();
    let title = 'New Chat';
    if (initialMessage?.text && initialMessage.text.trim().length > 0) {
        const trimmed = initialMessage.text.trim();
        title = trimmed.length > 32 ? `${trimmed.substring(0, 32)}...` : trimmed;
    } else if (initialMessage?.attachment?.name) {
        title = initialMessage.attachment.name;
    }

    return {
        id: `${now}-${Math.random().toString(36).substring(2, 9)}`,
        title,
        createdAt: now,
        updatedAt: now,
        messages: initialMessage ? [initialMessage] : [],
        modelName,
        backend,
    };
}
