import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTruncated, placeTooltip } from './tooltipPlacement.js';

const viewport = { width: 1000, height: 800 };
const rect = (left, top, width, height) => ({ left, top, width, height, bottom: top + height });

describe('placeTooltip', () => {
  it('預設放在元素上方置中', () => {
    assert.deepEqual(placeTooltip(rect(400, 300, 100, 20), { width: 60, height: 30 }, viewport), { left: 420, top: 264, side: 'top' });
  });

  it('上方放不下就改放下方', () => {
    assert.deepEqual(placeTooltip(rect(400, 10, 100, 20), { width: 60, height: 30 }, viewport), { left: 420, top: 36, side: 'bottom' });
  });

  it('左右夾在視窗內', () => {
    assert.equal(placeTooltip(rect(0, 300, 20, 20), { width: 200, height: 30 }, viewport).left, 8);
    assert.equal(placeTooltip(rect(980, 300, 20, 20), { width: 200, height: 30 }, viewport).left, 792);
  });
});

describe('isTruncated', () => {
  it('內容比容器寬或高才算截斷', () => {
    assert.equal(isTruncated({ scrollWidth: 300, clientWidth: 200, scrollHeight: 20, clientHeight: 20 }), true);
    assert.equal(isTruncated({ scrollWidth: 200, clientWidth: 200, scrollHeight: 60, clientHeight: 40 }), true);
    assert.equal(isTruncated({ scrollWidth: 200, clientWidth: 200, scrollHeight: 20, clientHeight: 20 }), false);
  });
});
