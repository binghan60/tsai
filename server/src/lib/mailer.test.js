import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAmbiguousMailFailure } from './mailer.js';

describe('isAmbiguousMailFailure', () => {
  it('does not mark errors before sendMail starts as uncertain', () => {
    assert.equal(isAmbiguousMailFailure({ code: 'ETIMEDOUT' }), false);
  });

  it('treats explicit authentication, envelope and SMTP rejection errors as definite failures', () => {
    assert.equal(isAmbiguousMailFailure({ code: 'EAUTH' }, { smtpStarted: true }), false);
    assert.equal(isAmbiguousMailFailure({ code: 'EENVELOPE' }, { smtpStarted: true }), false);
    assert.equal(isAmbiguousMailFailure({ code: 'ETIMEDOUT', responseCode: 451 }, { smtpStarted: true }), false);
  });

  it('treats connection failures before DATA as definite failures', () => {
    assert.equal(
      isAmbiguousMailFailure({ code: 'ETIMEDOUT', command: 'CONN' }, { smtpStarted: true }),
      false
    );
    assert.equal(
      isAmbiguousMailFailure({ code: 'ECONNECTION', command: 'RCPT TO' }, { smtpStarted: true }),
      false
    );
  });

  it('keeps DATA-stage timeouts and result-less disconnects uncertain', () => {
    assert.equal(
      isAmbiguousMailFailure({ code: 'ETIMEDOUT', command: 'DATA' }, { smtpStarted: true }),
      true
    );
    assert.equal(
      isAmbiguousMailFailure({ code: 'ECONNRESET' }, { smtpStarted: true }),
      true
    );
  });
});
