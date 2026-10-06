import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeRedirectPath } from './authRedirect.js';

describe('safeRedirectPath', () => {
  it('keeps in-app paths, including their query string', () => {
    assert.equal(safeRedirectPath('/records?view=failed&page=2'), '/records?view=failed&page=2');
    assert.equal(safeRedirectPath('/records/abc123/edit'), '/records/abc123/edit');
  });

  it('falls back to the dashboard when nothing usable is given', () => {
    for (const value of [undefined, null, '', 'records', 42, {}]) {
      assert.equal(safeRedirectPath(value), '/');
    }
  });

  // 登入頁的連結可以由任何人拼出來寄給使用者；登入成功後不能把人送到站外。
  it('refuses anything a browser would treat as another site', () => {
    for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
      assert.equal(safeRedirectPath(value), '/');
    }
  });

  it('does not bounce back to the login page', () => {
    assert.equal(safeRedirectPath('/login'), '/');
    assert.equal(safeRedirectPath('/login?redirect=/pets'), '/');
    // 只是名字開頭像 login 的其他頁面不受影響。
    assert.equal(safeRedirectPath('/login-history'), '/login-history');
  });

  it('uses the first value when the parameter is repeated', () => {
    assert.equal(safeRedirectPath(['/pets', '//evil.example']), '/pets');
    assert.equal(safeRedirectPath(['//evil.example', '/pets']), '/');
  });
});
