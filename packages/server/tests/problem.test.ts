import { expect, test } from 'bun:test';
import { asProblem, problemResponse } from '../src/problem';
import { ProblemSchema } from '../../schema/src/api';

test('problem recovery preserves actionable detail, headers and handler fields', async () => {
  const response = await asProblem(new Response(JSON.stringify({ error: 'Storage is offline', backend: 's3' }), {
    status: 503, headers: { 'content-type': 'application/json', 'retry-after': '5' }
  }));
  expect(response.headers.get('retry-after')).toBe('5');
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(ProblemSchema.parse(await response.json())).toMatchObject({
    detail: 'Storage is offline', error: 'Storage is offline', backend: 's3', hint: expect.stringContaining('/readyz')
  });
  const unauthorized = problemResponse(401, 'A token is required', { 'www-authenticate': 'Bearer' });
  expect(unauthorized.headers.get('www-authenticate')).toBe('Bearer');
  expect((await unauthorized.json()).hint).toContain('/llms.txt');
  const success = new Response('{}', { headers: { 'content-type': 'application/json' } });
  expect(await asProblem(success)).toBe(success);
});
