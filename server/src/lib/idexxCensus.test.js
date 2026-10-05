import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TextDecoder } from 'node:util';
import { XMLParser } from 'fast-xml-parser';
import { encodeBig5 } from './big5.js';
import {
  buildIdexxRequestXml, canRequestLab, idexxDate, idexxDateTime, idexxGender, idexxMessageId, idexxSpecies, inClinic, nextCensusKind, xmlText,
} from './idexxCensus.js';
import { idexxCensusSettings } from '../config/idexxBridge.js';

const pet = {
  _id: '66f0a1b2c3d4e5f601234567', name: '牛奶', species: '貓', sex: 'female', neutered: 'yes',
  birthDate: new Date('2023-04-30T16:00:00Z'), ownerId: 'o1',
};
const owner = { _id: '66f0a1b2c3d4e5f60123aaaa', name: '王小明' };
// 2026-10-04 14:05:09.123 台北時間
const now = new Date('2026-10-04T06:05:09.123Z');
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

describe('idexxCensus', () => {
  it('報到之後、櫃台完成之前而且已建檔，才能送 IDEXX', () => {
    assert.equal(canRequestLab({ petId: 'p', status: 'arrived' }), true);
    assert.equal(canRequestLab({ petId: 'p', status: 'pending_checkout' }), true);
    assert.equal(canRequestLab({ petId: 'p', status: 'completed' }), false);
    assert.equal(canRequestLab({ petId: 'p', status: 'scheduled' }), false);
    assert.equal(canRequestLab({ petId: null, status: 'arrived' }), false);
  });

  it('報到不算：有人按了送 IDEXX、而且還在院內，才該在 IDEXX 主機的清單上', () => {
    const requested = new Date();
    assert.equal(inClinic({ petId: 'p', status: 'arrived' }), false);
    assert.equal(inClinic({ petId: 'p', status: 'arrived', labRequestedAt: requested }), true);
    assert.equal(inClinic({ petId: 'p', status: 'pending_checkout', labRequestedAt: requested }), true);
    assert.equal(inClinic({ petId: 'p', status: 'completed', labRequestedAt: requested }), false);
    assert.equal(inClinic({ petId: 'p', status: 'arrived', labRequestedAt: null }), false);
  });

  it('看上一次送了什麼決定要不要送，同一個狀態不重複送', () => {
    assert.equal(nextCensusKind(null, true), 'in');
    assert.equal(nextCensusKind('out', true), 'in');
    assert.equal(nextCensusKind('in', true), null);
    assert.equal(nextCensusKind('in', false), 'out');
    assert.equal(nextCensusKind(null, false), null);
    assert.equal(nextCensusKind('out', false), null);
  });

  it('物種與性別換成 IDEXX 的代碼', () => {
    assert.equal(idexxSpecies('貓'), 'FELINE');
    assert.equal(idexxSpecies(''), 'FELINE');
    assert.equal(idexxSpecies('狗'), 'CANINE');
    assert.equal(idexxSpecies('兔'), 'OTHER');
    assert.equal(idexxGender('male', 'yes'), 'MALE_NEUTERED');
    assert.equal(idexxGender('male', 'no'), 'MALE_INTACT');
    assert.equal(idexxGender('female', 'yes'), 'FEMALE_SPAYED');
    assert.equal(idexxGender('female', 'no'), 'FEMALE_INTACT');
    assert.equal(idexxGender('female', 'unknown'), null);
    assert.equal(idexxGender('unknown', 'yes'), null);
  });

  it('日期與時間照診所時區、IDEXX 範例的格式', () => {
    assert.equal(idexxDate(pet.birthDate), '05/01/2023');
    assert.equal(idexxDate(null), '');
    assert.equal(idexxDateTime(now), '10/04/2026 02:05:09 PM');
    assert.equal(idexxDateTime(new Date('2026-10-03T16:30:00Z')), '10/04/2026 12:30:00 AM');
    assert.equal(idexxDateTime(new Date('2026-10-04T04:00:00Z')), '10/04/2026 12:00:00 PM');
    assert.equal(idexxMessageId(now, () => 0.0421), '20261004140509123042');
  });

  it('XML 特殊字元與控制字元', () => {
    assert.equal(xmlText(' 豆<豆>&"\'\u0001 '), '豆&lt;豆&gt;&amp;&quot;&apos;');
  });

  it('報到通知（Census）：貓咪編號、物種、性別、生日、體重、飼主', () => {
    const xml = buildIdexxRequestXml({ mode: 'census', kind: 'in', messageId: '1', now, encoding: 'big5', appointmentId: 'a1', pet, owner, weightKg: 4.25 });
    assert.match(xml, /^<\?xml version="1.0" encoding="Big5"\?>\n<!DOCTYPE message SYSTEM "census_20.dtd">/);
    const { message } = parser.parse(xml);
    assert.equal(message.message_type, 'Census_Notice');
    assert.equal(message.message_sub_type, 'in');
    assert.equal(message.message_dt, '10/04/2026 02:05:09 PM');
    const notice = message.body.census_notice;
    assert.equal(notice.census_notice_reason, 'inclinic');
    assert.equal(notice.client.client_id, owner._id);
    assert.equal(notice.client.last_name, '王小明');
    assert.equal(notice.patient.patient_id, pet._id);
    assert.equal(notice.patient.patient_species, 'FELINE');
    assert.equal(notice.patient.patient_gender, 'FEMALE_SPAYED');
    assert.equal(notice.patient.patient_name, '牛奶');
    assert.equal(notice.patient.patient_birth_dt, '05/01/2023');
    assert.equal(notice.patient.patient_weight.weight, 4.25);
    assert.equal(notice.patient.patient_weight.patient_weight_uom, 'kgs');
    // DTD 的順序：client 在 patient 前面；patient 裡 name → birth → weight。
    assert.ok(xml.indexOf('<client') < xml.indexOf('<patient '));
    assert.ok(xml.indexOf('<patient_name>') < xml.indexOf('<patient_birth_dt>'));
  });

  it('離院通知；沒有的欄位不送（不送空的生日、0 體重、不知道的性別）', () => {
    const xml = buildIdexxRequestXml({
      mode: 'census', kind: 'out', messageId: '2', now, encoding: 'utf-8', appointmentId: 'a1',
      pet: { ...pet, birthDate: null, sex: 'unknown' }, owner: null, weightKg: 0,
    });
    assert.match(xml, /encoding="UTF-8"/);
    const { message } = parser.parse(xml);
    assert.equal(message.message_sub_type, 'out');
    assert.equal(message.body.census_notice.client, undefined);
    assert.doesNotMatch(xml, /patient_gender|patient_birth_dt|patient_weight/);
  });

  it('開單（Work Request）：到院 New、離院 Cancel，單號是掛號編號', () => {
    const created = parser.parse(buildIdexxRequestXml({ mode: 'work_request', kind: 'in', messageId: '3', now, encoding: 'big5', appointmentId: 'a1', pet, owner }));
    assert.equal(created.message.message_type, 'Work_Request');
    assert.equal(created.message.message_sub_type, 'New');
    assert.equal(created.message.body.work_request.requisition_number, 'a1');
    assert.ok('service_add' in created.message.body.work_request);
    const cancelled = buildIdexxRequestXml({ mode: 'work_request', kind: 'out', messageId: '4', now, encoding: 'big5', appointmentId: 'a1', pet, owner });
    assert.match(cancelled, /work_request_20\.dtd/);
    assert.match(cancelled, /message_sub_type="Cancel"/);
    assert.doesNotMatch(cancelled, /service_add/);
  });

  it('Big5 編碼：中文解得回來，Big5 沒有的字換成「?」並列出來', () => {
    const { bytes, unmappable } = encodeBig5('牛奶 Milk 王小明 😺');
    assert.equal(new TextDecoder('big5').decode(bytes), '牛奶 Milk 王小明 ?');
    assert.deepEqual(unmappable, ['😺']);
    assert.deepEqual([...encodeBig5('牛').bytes], [0xa4, 0xfb]);
  });

  it('伺服器設定預設關閉，編碼預設 Big5', () => {
    assert.deepEqual(idexxCensusSettings({}), { mode: 'off', encoding: 'big5' });
    assert.deepEqual(idexxCensusSettings({ IDEXX_CENSUS_MODE: 'Census', IDEXX_CENSUS_ENCODING: 'UTF-8' }), { mode: 'census', encoding: 'utf-8' });
    assert.deepEqual(idexxCensusSettings({ IDEXX_CENSUS_MODE: 'yes' }), { mode: 'off', encoding: 'big5' });
    assert.equal(idexxCensusSettings({ IDEXX_CENSUS_MODE: 'work_request' }).mode, 'work_request');
  });
});
