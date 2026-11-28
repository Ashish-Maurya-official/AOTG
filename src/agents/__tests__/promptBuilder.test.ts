import {parseActionResponse} from '../promptBuilder';

it.each([
  {type: 'click', target: 4},
  {type: 'click', target: ''},
  {type: 'scroll', target: '0', direction: 'sideways'},
  {type: 'tap_coordinates', x: -1, y: 20},
  {type: 'swipe', startX: 0, startY: 0, endX: null, endY: 100},
  {type: 'wait', durationMs: -1},
  {type: 'wait', durationMs: 6000},
])('rejects malformed or unbounded model action %j', action => {
  expect(parseActionResponse(JSON.stringify(action)).type).toBe('error');
});

it('accepts a valid typed action with its observed target ID', () => {
  expect(parseActionResponse('{"type":"set_text","target":"0","value":"Hello"}'))
    .toMatchObject({type: 'set_text', target: '0', value: 'Hello'});
});
