import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasIdexxBridgeAccess, idexxBridgeConfigured } from './idexxBridge.js';

const token = 'a'.repeat(40);
const original = process.env.IDEXX_BRIDGE_TOKEN;

const requestWithAuthorization = (value) => ({
  get: (name) => (name.toLowerCase() === 'authorization' ? value : undefined),
});

describe('IDEXX 抓檔程式的密鑰', () => {
  afterEach(() => {
    if (original === undefined) delete process.env.IDEXX_BRIDGE_TOKEN;
    else process.env.IDEXX_BRIDGE_TOKEN = original;
  });

  it('沒設定或少於 32 字元都算關閉，任何密鑰都不收', () => {
    delete process.env.IDEXX_BRIDGE_TOKEN;
    assert.equal(idexxBridgeConfigured(), false);
    assert.equal(hasIdexxBridgeAccess(requestWithAuthorization('Bearer ')), false);

    process.env.IDEXX_BRIDGE_TOKEN = 'short';
    assert.equal(idexxBridgeConfigured(), false);
    assert.equal(hasIdexxBridgeAccess(requestWithAuthorization('Bearer short')), false);
  });

  it('Bearer 標頭帶對密鑰才放行', () => {
    process.env.IDEXX_BRIDGE_TOKEN = token;
    assert.equal(hasIdexxBridgeAccess(requestWithAuthorization(`Bearer ${token}`)), true);
    assert.equal(hasIdexxBridgeAccess(requestWithAuthorization(`bearer ${token}`)), true);
  });

  it('沒帶、帶錯、格式不對都擋', () => {
    process.env.IDEXX_BRIDGE_TOKEN = token;
    assert.equal(hasIdexxBridgeAccess(requestWithAuthorization(undefined)), false);
    assert.equal(hasIdexxBridgeAccess(requestWithAuthorization(`Bearer ${token}x`)), false);
    assert.equal(hasIdexxBridgeAccess(requestWithAuthorization(`Bearer ${'b'.repeat(40)}`)), false);
    assert.equal(hasIdexxBridgeAccess(requestWithAuthorization(token)), false);
  });
});
