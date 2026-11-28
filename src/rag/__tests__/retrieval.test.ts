import { chunkText, lexicalRetriever, retrieveContext } from '../retrieval';

it('retrieves Hindi and mixed-language content without stripping Unicode', () => {
  const text = '[Page 1]\nदिल्ली में मौसम साफ है और तापमान 25 डिग्री है।\n\n[Page 2]\nReact Native uses components.';
  expect(retrieveContext('दिल्ली मौसम', text, 1000)).toContain('25 डिग्री');
  expect(retrieveContext('React components', text, 1000)).toContain('[Page 2]');
});

it('returns no evidence for unrelated questions and stop-word-only matches', () => {
  expect(retrieveContext('quantum entanglement', 'The capital is Delhi.', 1000)).toBe('');
  expect(retrieveContext('What is quantum?', 'The capital is Delhi.', 1000)).toBe('');
});

it('bounds a single huge page and always honors a small context budget', () => {
  const text = '[Page 9]\n' + 'weather '.repeat(10000);
  const chunks = chunkText(text);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every(chunk => chunk.text.length <= 1200 && chunk.metadata === '[Page 9]')).toBe(true);
  expect(retrieveContext('weather', text, 90).length).toBeLessThanOrEqual(90);
  expect(retrieveContext('weather', text, 0)).toBe('');
});

it('explicitly supports overview queries and an interchangeable retriever', () => {
  expect(retrieveContext('Summarize', 'First paragraph.\n\nSecond paragraph.', 1000)).toContain('Second paragraph');
  expect(retrieveContext('सारांश', 'दिल्ली का विवरण।', 1000)).toContain('दिल्ली');
  const retriever = { retrieve: jest.fn(() => [{ index: 4, text: 'Semantic match', metadata: '[Page 5]' }]) };
  expect(retrieveContext('custom query', 'Original content', 1000, retriever)).toContain('Semantic match');
  expect(retriever.retrieve).toHaveBeenCalled();
});

it('ranks a focused match ahead of an oversized weak match', () => {
  const chunks = [{ index: 0, text: 'price ' + 'unrelated '.repeat(100), metadata: '' }, { index: 1, text: 'price 250', metadata: '' }];
  expect(lexicalRetriever.retrieve('price', chunks, 1)[0].index).toBe(1);
});

it('preserves multiple sampled sections under a small summary budget', () => {
  const text = Array.from({ length: 6 }, (_, index) => `[Page ${index + 1}]\nDetail ${index + 1}: ${'content '.repeat(100)}`).join('\n\n');
  const result = retrieveContext('summarize', text, 500);
  expect(result).toContain('Detail 1');
  expect(result).toContain('Detail 6');
  expect(result.length).toBeLessThanOrEqual(500);
});

it('does not split Unicode surrogate pairs at chunk or context boundaries', () => {
  const text = 'x'.repeat(63) + '🌍'.repeat(100);
  const chunks = chunkText(text, 64);
  expect(chunks.map(chunk => chunk.text).join('')).toBe(text);
  expect(chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk.text))).toBe(true);
  expect(retrieveContext('summarize', text, 76)).not.toMatch(/[\uD800-\uDBFF]$/);
});
