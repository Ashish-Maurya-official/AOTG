import NativeAgentTools from '../../../native/turbo_modules/AgentTools/NativeAgentTools';
import webPlugin, { publicHttpsUrl } from '../index';
import { ToolRegistry } from '../../../agentCore/registry';
import { getSearchEndpoint } from '../settings';

jest.mock('../../../native/turbo_modules/AgentTools/NativeAgentTools', () => ({ fetchPage: jest.fn(), cancelFetch: jest.fn(async () => true) }));
jest.mock('../settings', () => ({ __esModule: true, default: () => null, getSearchEndpoint: jest.fn(), validateSearchEndpoint: (value: string) => value }));

const native = jest.mocked(NativeAgentTools!);
const page = { url: 'https://example.com/news', title: 'News', fetchedAt: '2026-11-28T10:00:00Z', mimeType: 'text/html',
  text: 'Delhi weather is sunny with temperature 25 degrees. This is the latest weather report published by the station.', links: [], truncated: false };
const context = () => ({ requestId: 'request', generationId: 'turn', signal: new AbortController().signal, maxResultBytes: 3000 });
let registry: ToolRegistry;
beforeEach(() => {
  jest.clearAllMocks();
  registry = new ToolRegistry(); registry.register(webPlugin);
  native.fetchPage.mockResolvedValue(JSON.stringify(page));
});

it('reads actual page evidence and preserves its final URL and observation time', async () => {
  const result = await registry.execute('web_read', { url: page.url, question: 'Delhi weather' }, context());
  expect(result.status).toBe('ok');
  expect(result.content).toContain('25 degrees');
  expect(result.sources?.[0]).toMatchObject({ url: page.url, fetchedAt: page.fetchedAt });
});

it('does not manufacture evidence when a source is irrelevant or blocked', async () => {
  await expect(registry.execute('web_read', { url: page.url, question: 'quantum' }, context())).resolves.toMatchObject({ status: 'no_evidence' });
  native.fetchPage.mockResolvedValue(JSON.stringify({ ...page, title: 'Just a moment...' }));
  await expect(registry.execute('web_read', { url: page.url }, context())).resolves.toMatchObject({ status: 'unavailable' });
});

it('keeps direct browsing available without a search provider', async () => {
  jest.mocked(getSearchEndpoint).mockResolvedValue(null);
  await expect(registry.execute('web_search', { query: 'latest news' }, context())).resolves.toMatchObject({ status: 'unavailable' });
  expect(native.fetchPage).not.toHaveBeenCalled();
  await expect(registry.execute('web_read', { url: page.url }, context())).resolves.toMatchObject({ status: 'ok' });
});

it('returns discovery URLs without treating search snippets as verified evidence', async () => {
  jest.mocked(getSearchEndpoint).mockResolvedValue('https://search.example.com/search');
  native.fetchPage.mockResolvedValue(JSON.stringify({ ...page, text: JSON.stringify({ results: [{ url: page.url, title: 'News', content: 'Unverified snippet' }, { url: 'file:///secret' }] }) }));
  const result = await registry.execute('web_search', { query: 'news & weather' }, context());
  expect(native.fetchPage.mock.calls[0][1]).toContain('q=news');
  expect(result.content).toContain(page.url);
  expect(result.content).not.toContain('Unverified snippet');
  expect(result.sources).toBeUndefined();
});

it('cancels the native request and discards late output', async () => {
  let finish!: (value: string) => void;
  native.fetchPage.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const pending = registry.execute('web_read', { url: page.url }, { ...context(), signal: controller.signal });
  controller.abort();
  finish(JSON.stringify(page));
  await expect(pending).rejects.toThrow('cancelled');
  expect(native.cancelFetch).toHaveBeenCalledWith('request');
});

it('rejects unsafe URL schemes, embedded credentials and custom ports', () => {
  for (const url of ['http://example.com', 'file:///secret', 'https://user:pass@example.com', 'https://example.com:8443']) {
    expect(() => publicHttpsUrl(url)).toThrow();
  }
});
