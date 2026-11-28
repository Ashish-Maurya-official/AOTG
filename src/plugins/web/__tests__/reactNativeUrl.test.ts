import { publicHttpsUrl } from '../index';
import { validateSearchEndpoint } from '../settings';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('../../../native/turbo_modules/AgentTools/NativeAgentTools', () => null);

// Jest otherwise uses Node's URL implementation, which differs from the phone runtime.
// eslint-disable-next-line @react-native/no-deep-imports
const ReactNativeURL = require('react-native/Libraries/Blob/URL').URL;
const originalURL = globalThis.URL;
beforeAll(() => { globalThis.URL = ReactNativeURL; });
afterAll(() => { globalThis.URL = originalURL; });

it('validates and encodes requests using React Native URL semantics', () => {
  expect(publicHttpsUrl('https://example.com/news#section')).toBe('https://example.com/news');
  expect(() => publicHttpsUrl('https://user:password@example.com/news')).toThrow();
  expect(() => publicHttpsUrl('https://example.com:8443/news')).toThrow();
  expect(() => validateSearchEndpoint('https://example.com/search?token=secret')).toThrow();
  const endpoint = new URL(validateSearchEndpoint('https://example.com/search'));
  endpoint.searchParams.set('q', 'दिल्ली news & weather');
  endpoint.searchParams.set('format', 'json');
  expect(new originalURL(endpoint.toString()).searchParams.get('q')).toBe('दिल्ली news & weather');
  expect(new originalURL(endpoint.toString()).searchParams.get('format')).toBe('json');
});
