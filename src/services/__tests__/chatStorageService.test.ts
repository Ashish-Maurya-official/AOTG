import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    loadSessions,
    saveSession,
    deleteSession,
    loadActiveSessionId,
    saveActiveSessionId,
    createSession,
    resetMemoryStoreForTesting,
    ChatSession,
} from '../chatStorageService';

jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
}));

describe('chatStorageService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetMemoryStoreForTesting();
    });

    it('creates a session with trimmed auto-title', () => {
        const session = createSession({
            id: '1',
            role: 'user',
            text: 'How do I optimize React Native performance on low memory devices?',
        });
        expect(session.id).toBeDefined();
        expect(session.title.length).toBeLessThanOrEqual(35); // 32 chars + '...'
        expect(session.messages).toHaveLength(1);
    });

    it('creates a session with attachment name as fallback title', () => {
        const session = createSession({
            id: '2',
            role: 'user',
            text: '',
            attachment: {
                uri: 'file://path',
                name: 'document.pdf',
                type: 'application/pdf',
            },
        });
        expect(session.title).toBe('document.pdf');
    });

    it('loads sessions sorted by updatedAt descending', async () => {
        const mockSessions: ChatSession[] = [
            { id: '1', title: 'Older', createdAt: 100, updatedAt: 200, messages: [] },
            { id: '2', title: 'Newer', createdAt: 100, updatedAt: 500, messages: [] },
        ];
        (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockSessions));

        const result = await loadSessions();
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('2');
        expect(result[1].id).toBe('1');
    });

    it('saves a session and caps sessions at 50', async () => {
        const existing: ChatSession[] = Array.from({ length: 50 }, (_, i) => ({
            id: `session-${i}`,
            title: `Session ${i}`,
            createdAt: 1000 + i,
            updatedAt: 1000 + i,
            messages: [],
        }));
        (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(existing));

        const newSession: ChatSession = {
            id: 'session-new',
            title: 'Brand New Session',
            createdAt: 9999,
            updatedAt: 9999,
            messages: [],
        };

        await saveSession(newSession);

        expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
        const savedData: ChatSession[] = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
        expect(savedData).toHaveLength(50);
        expect(savedData[0].id).toBe('session-new');
    });

    it('deletes session and clears activeSessionId if matching', async () => {
        const existing: ChatSession[] = [
            { id: 'session-1', title: 'Session 1', createdAt: 100, updatedAt: 100, messages: [] },
            { id: 'session-2', title: 'Session 2', createdAt: 200, updatedAt: 200, messages: [] },
        ];
        (AsyncStorage.getItem as jest.Mock)
            .mockResolvedValueOnce(JSON.stringify(existing)) // for loadSessions
            .mockResolvedValueOnce('session-1'); // for loadActiveSessionId

        await deleteSession('session-1');

        expect(AsyncStorage.setItem).toHaveBeenCalledWith(
            '@aotg/chat_sessions',
            JSON.stringify([{ id: 'session-2', title: 'Session 2', createdAt: 200, updatedAt: 200, messages: [] }])
        );
        expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@aotg/active_session_id');
    });

    it('saves and loads activeSessionId correctly', async () => {
        (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('test-session-id');
        const activeId = await loadActiveSessionId();
        expect(activeId).toBe('test-session-id');

        await saveActiveSessionId('test-session-id');
        expect(AsyncStorage.setItem).toHaveBeenCalledWith('@aotg/active_session_id', 'test-session-id');

        await saveActiveSessionId(null);
        expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@aotg/active_session_id');
    });

    it('gracefully handles null native AsyncStorage module without throwing, falling back to in-memory storage', async () => {
        const nativeNullError = new Error('AsyncStorageError: Native module is null, cannot access legacy storage');
        (AsyncStorage.getItem as jest.Mock).mockRejectedValue(nativeNullError);
        (AsyncStorage.setItem as jest.Mock).mockRejectedValue(nativeNullError);
        (AsyncStorage.removeItem as jest.Mock).mockRejectedValue(nativeNullError);

        // 1. Initial load should return empty array without throwing
        const initial = await loadSessions();
        expect(initial).toEqual([]);

        // 2. Saving a session should succeed into in-memory store
        const sessionA: ChatSession = {
            id: 'session-a',
            title: 'In Memory Session',
            createdAt: 1000,
            updatedAt: 1000,
            messages: [{ id: 'm1', role: 'user', text: 'Hello' }],
        };
        await saveSession(sessionA);

        // 3. Loading sessions should retrieve the in-memory session
        const loaded = await loadSessions();
        expect(loaded).toHaveLength(1);
        expect(loaded[0].id).toBe('session-a');
        expect(loaded[0].title).toBe('In Memory Session');

        // 4. Saving and loading active session ID in memory
        await saveActiveSessionId('session-a');
        const activeId = await loadActiveSessionId();
        expect(activeId).toBe('session-a');

        // 5. Deleting session in memory
        await deleteSession('session-a');
        const afterDelete = await loadSessions();
        expect(afterDelete).toHaveLength(0);

        const activeAfterDelete = await loadActiveSessionId();
        expect(activeAfterDelete).toBeNull();
    });
});
