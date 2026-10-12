import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainAcceptsMail, emailFormatProblem, emailProblem } from './emailCheck.js';
import { bounceReason, parseBounce } from './bounceMessage.js';

const dnsError = (code) => async () => { throw Object.assign(new Error(code), { code }); };
const found = async () => [{ exchange: 'mx.example.com' }];
const empty = async () => [];

test('emailFormatProblem：格式與常見的網域錯字', () => {
  assert.equal(emailFormatProblem('owner@gmail.com'), '');
  assert.match(emailFormatProblem('owner-at-gmail.com'), /格式不正確/);
  assert.match(emailFormatProblem('owner@gmial.com'), /@gmail\.com/);
  assert.match(emailFormatProblem(' Owner@GMAIL.CON '), /@gmail\.com/);
  assert.equal(emailFormatProblem('owner@clinic.example.com.tw'), '');
});

test('domainAcceptsMail：確定查無此網域才擋，查不到的放行', async () => {
  assert.equal(await domainAcceptsMail('a.com', { resolveMx: found, resolve4: empty, resolve6: empty }), true);
  // 沒有 MX 但網域本身解析得到，也收得了信。
  assert.equal(await domainAcceptsMail('a.com', { resolveMx: dnsError('ENODATA'), resolve4: found, resolve6: empty }), true);
  assert.equal(await domainAcceptsMail('a.com', { resolveMx: dnsError('ENOTFOUND'), resolve4: dnsError('ENOTFOUND'), resolve6: dnsError('ENOTFOUND') }), false);
  // DNS 逾時：不能因為網路不穩就寄不出報告。
  assert.equal(await domainAcceptsMail('a.com', { resolveMx: dnsError('ETIMEOUT'), resolve4: dnsError('ETIMEOUT'), resolve6: dnsError('ETIMEOUT') }), true);
});

test('emailProblem：網域不存在時講出是哪個網域', async () => {
  const gone = { resolveMx: dnsError('ENOTFOUND'), resolve4: dnsError('ENOTFOUND'), resolve6: dnsError('ENOTFOUND') };
  assert.match(await emailProblem('owner@no-such-clinic.example', gone), /no-such-clinic\.example.*不存在/);
  assert.equal(await emailProblem('owner@gmail.com', { resolveMx: found, resolve4: empty, resolve6: empty }), '');
});

// Gmail 退信通知的樣子（節錄）：原信的 Message-ID 在 In-Reply-To，機器可讀的部分有 Action／Final-Recipient／Diagnostic-Code。
const GMAIL_BOUNCE = [
  'From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
  'To: clinic@gmail.com',
  'X-Failed-Recipients: nobody12345@gmail.com',
  'Subject: Delivery Status Notification (Failure)',
  'References: <abc-123@gmail.com>',
  'In-Reply-To: <abc-123@gmail.com>',
  'Content-Type: multipart/report; boundary="000"; report-type=delivery-status',
  '',
  '--000',
  'Content-Type: message/delivery-status',
  '',
  'Reporting-MTA: dns; googlemail.com',
  '',
  'Final-Recipient: rfc822; nobody12345@gmail.com',
  'Action: failed',
  'Status: 5.1.1',
  'Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist. Please try',
  ' 550-5.1.1 double-checking the recipient\'s email address for typos',
].join('\r\n');

test('parseBounce：對回原信、收件地址與原因', () => {
  assert.deepEqual(parseBounce(GMAIL_BOUNCE), { messageIds: ['<abc-123@gmail.com>'], recipient: 'nobody12345@gmail.com', reason: '收件地址不存在' });
  // 信封上的 In-Reply-To 也認。
  const withoutHeaders = GMAIL_BOUNCE.replace(/^(References|In-Reply-To):.*\r\n/gm, '');
  assert.equal(parseBounce(withoutHeaders), null);
  assert.deepEqual(parseBounce(withoutHeaders, { inReplyTo: '<abc-123@gmail.com>' }).messageIds, ['<abc-123@gmail.com>']);
});

test('parseBounce：只是延遲、或不是退信的不算', () => {
  assert.equal(parseBounce(GMAIL_BOUNCE.replace('Action: failed', 'Action: delayed')), null);
  assert.equal(parseBounce('From: someone@example.com\r\nIn-Reply-To: <abc-123@gmail.com>\r\n\r\n收到了，謝謝'), null);
});

test('bounceReason：常見原因翻成一句話，其餘原文照列', () => {
  assert.equal(bounceReason('smtp; 552-5.2.2 The email account is over quota'), '對方信箱已滿');
  assert.equal(bounceReason('smtp; DNS Error: Domain name not found'), '收件網域不存在或收不了信');
  assert.equal(bounceReason('smtp; 451 something odd'), '無法送達（451 something odd）');
  assert.equal(bounceReason(''), '無法送達');
});
