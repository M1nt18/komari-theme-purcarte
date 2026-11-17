import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTexts, deepMerge } from './localeUtils.ts';

test('custom text imports can only replace known text leaves and cannot pollute prototypes', () => {
  const base = { node: { title: 'Node' } };
  const result = mergeTexts(base, 'node.title:Machine,__proto__.injected:yes,constructor.prototype.injected:yes,node.extra:unknown');
  assert.deepEqual(result, { node: { title: 'Machine' } });
  assert.equal(({} as any).injected, undefined);
  assert.deepEqual(base, { node: { title: 'Node' } });
});

test('deep merge ignores prototype keys while preserving ordinary nested text', () => {
  const result = deepMerge({ node: { title: 'Node' } }, JSON.parse('{"node":{"hint":"Hint"},"__proto__":{"injected":"yes"}}'));
  assert.deepEqual(result, { node: { title: 'Node', hint: 'Hint' } });
  assert.equal(({} as any).injected, undefined);
});
