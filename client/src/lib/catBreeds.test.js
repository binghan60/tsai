import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CAT_BREED_ERROR, CAT_BREED_FALLBACKS, CAT_BREEDS, catBreedLabel, checkCatBreed, filterCatBreeds, findCatBreed, isCatBreed } from '../../../shared/catBreeds.js';

const labels = (query) => filterCatBreeds(query).map((breed) => breed.label);

describe('CAT_BREEDS', () => {
  it('IDEXX 的 55 種，中文名稱與英文名稱都不重複', () => {
    assert.equal(CAT_BREEDS.length, 55);
    assert.equal(new Set(CAT_BREEDS.map((breed) => breed.label)).size, 55);
    assert.equal(new Set(CAT_BREEDS.map((breed) => breed.idexx)).size, 55);
  });

  it('找不到品種時的退路都在清單上，「其他」排最後', () => {
    for (const name of CAT_BREED_FALLBACKS) assert.equal(isCatBreed(name), true);
    assert.equal(CAT_BREEDS.at(-1).idexx, 'Other');
  });
});

describe('findCatBreed／catBreedLabel', () => {
  it('存的是 IDEXX 英文名稱，顯示轉成中文', () => {
    assert.equal(catBreedLabel('British Shorthair'), '英國短毛貓');
    assert.equal(catBreedLabel('Mixed'), '米克斯');
    assert.equal(catBreedLabel('Norwegian Forest Cat'), '挪威森林貓');
  });

  it('舊資料的大小寫、空白不一也認得；中文名稱也認得', () => {
    assert.equal(findCatBreed('mixed').idexx, 'Mixed');
    assert.equal(findCatBreed(' british  shorthair ').idexx, 'British Shorthair');
    assert.equal(findCatBreed('米克斯').idexx, 'Mixed');
    assert.equal(catBreedLabel('ragamuffin'), '襤褸貓');
  });

  it('清單以外的舊值照原文顯示；空值是空字串', () => {
    assert.equal(catBreedLabel('Poodle'), 'Poodle');
    assert.equal(catBreedLabel(' Chinchilla '), 'Chinchilla');
    assert.equal(catBreedLabel('金吉拉'), '金吉拉');
    assert.equal(catBreedLabel(''), '');
    assert.equal(catBreedLabel(undefined), '');
    assert.equal(findCatBreed('英短'), null, '俗稱只用來篩選，不算清單上的名稱');
  });
});

describe('checkCatBreed', () => {
  it('清單上的整理成 IDEXX 英文名稱，空值不算錯', () => {
    assert.deepEqual(checkCatBreed('Mixed'), { breed: 'Mixed', error: '' });
    assert.deepEqual(checkCatBreed(' mixed '), { breed: 'Mixed', error: '' });
    assert.deepEqual(checkCatBreed('米克斯'), { breed: 'Mixed', error: '' });
    assert.deepEqual(checkCatBreed(''), { breed: '', error: '' });
    assert.deepEqual(checkCatBreed(undefined), { breed: '', error: '' });
  });

  it('清單以外的報錯，除非跟原本存的值一樣（舊系統匯入的狗、Chinchilla…）', () => {
    assert.deepEqual(checkCatBreed('Poodle'), { breed: 'Poodle', error: CAT_BREED_ERROR });
    assert.deepEqual(checkCatBreed('Poodle', 'Poodle'), { breed: 'Poodle', error: '' });
    assert.deepEqual(checkCatBreed('Maltese', 'Poodle'), { breed: 'Maltese', error: CAT_BREED_ERROR });
    assert.equal(checkCatBreed('英短').error, CAT_BREED_ERROR);
    assert.equal(checkCatBreed('虎斑').error, CAT_BREED_ERROR);
  });
});

describe('filterCatBreeds', () => {
  it('沒有關鍵字回整份清單', () => {
    assert.equal(filterCatBreeds('').length, 55);
    assert.equal(filterCatBreeds('  ').length, 55);
  });

  it('中文名稱的一部分、俗稱、英文名稱都找得到', () => {
    assert.deepEqual(labels('布偶'), ['布偶貓']);
    assert.deepEqual(labels('英短'), ['英國短毛貓']);
    assert.deepEqual(labels('加菲'), ['異國短毛貓']);
    assert.deepEqual(labels('金吉拉'), ['波斯貓']);
    assert.deepEqual(labels('ragdoll'), ['布偶貓']);
    assert.deepEqual(labels('Maine Coon'), ['緬因貓']);
    assert.deepEqual(labels('mix'), ['米克斯']);
    assert.deepEqual(labels('緬'), ['緬因貓', '緬甸貓', '歐洲緬甸貓']);
  });

  it('關鍵字比名稱長也找得到（飼主常連花色、「貓」一起打）', () => {
    assert.deepEqual(labels('虎斑米克斯'), ['米克斯']);
    assert.deepEqual(labels('金吉拉貓'), ['波斯貓']);
    assert.deepEqual(labels('無毛貓'), ['斯芬克斯貓']);
  });

  it('不確定品種時打「不確定」「不知道」會出現「其他」', () => {
    assert.deepEqual(labels('不確定'), ['其他']);
    assert.deepEqual(labels('不知道'), ['其他']);
  });

  it('花色不是品種，找不到', () => {
    assert.deepEqual(labels('虎斑'), []);
    assert.deepEqual(labels('橘貓'), []);
  });
});
