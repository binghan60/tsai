import mongoose from 'mongoose';

function transactionsRequiredError(cause) {
  const error = new Error('這項操作需要支援 transaction 的 MongoDB replica set；MongoDB Atlas 已預設支援，本機請以 replica set 模式啟動');
  error.status = 503;
  error.code = 'MONGODB_TRANSACTIONS_REQUIRED';
  error.cause = cause;
  return error;
}

function isTransactionUnsupported(err) {
  return err?.code === 20
    || err?.codeName === 'IllegalOperation'
    || /Transaction numbers are only allowed|replica set member or mongos/i.test(err?.message ?? '');
}

// 所有跨 collection、不能只成功一半的寫入共用這個入口。
// callback 可能被 MongoDB driver 自動重試，因此裡面只能放資料庫操作，不能寄信或產 PDF。
export async function withTransaction(callback) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(
      () => callback(session),
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      }
    );
  } catch (err) {
    if (isTransactionUnsupported(err)) throw transactionsRequiredError(err);
    throw err;
  } finally {
    await session.endSession();
  }
}
