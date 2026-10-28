/* Chạy từ gốc repo bằng mongosh. Chỉ tạo lại ghi_A/ghi_B; không ghi vào hocvien. */
"use strict";

async function main() {
  const fs = require("fs");
  const path = require("path");
  const crypto = require("crypto");
  const performance = require("perf_hooks").performance;
  const database = db.getSiblingDB("lab03_indexing");
  const source = database.getCollection("hocvien");
  const directory = path.resolve(process.cwd(), "ketqua");
  fs.mkdirSync(directory, { recursive: true });
  const batchSize = 1000;
  const repetitions = 5;
  const writeConcern = { w: 1, j: true };
  const report = {
    completed: false, startedAt: new Date().toISOString(), serverVersion: await database.version(),
    batchSize: batchSize, repetitions: repetitions, timer: "perf_hooks.performance.now (milliseconds)",
    writeConcern: writeConcern, warmups: 0, rounds: [], collections: [],
    note: "Thứ tự A/B đảo ở mỗi lượt. Thời gian gồm lệnh mongosh/driver và phản hồi acknowledged; không gồm chuẩn bị, kiểm tra, xóa hoặc tạo index."
  };
  function check(condition, message) {
    if (!condition) throw new Error(message);
  }
  function save() {
    fs.writeFileSync(path.join(directory, "write_cost_summary.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  function median(values) {
    check(values.length === repetitions, "Cần đủ 5 lượt đo để tính trung vị.");
    const sorted = values.slice().sort(function (a, b) { return a - b; });
    return sorted[Math.floor(sorted.length / 2)];
  }
  function csvCell(value) {
    return '"' + String(value === undefined || value === null ? "" : value).replace(/"/g, '""') + '"';
  }
  // Kiểm tra và tạo fingerprint ngoài vùng đo. Sort theo _id để thứ tự ổn định.
  async function fingerprint(collection) {
    const documents = await collection.find({}).sort({ _id: 1 }).toArray();
    return crypto.createHash("sha256").update(EJSON.stringify(documents, null, 0, { relaxed: false })).digest("hex");
  }
  async function checkUnique(field, match) {
    const duplicates = await source.aggregate([
      { $match: match },
      { $group: { _id: "$" + field, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: "duplicateGroups" }
    ]).toArray();
    check(duplicates.length === 0, "Nguồn có giá trị trùng ở " + field);
  }

  try {
    // Xác minh cấu trúc, tính duy nhất, ba nhóm SĐT và điều kiện TP.HCM/Quan7.
    check(await source.countDocuments({}) === 100000, "hocvien phải có đúng 100.000 document; chạy 01 trước.");
    const validExpression = { $and: [
      { $eq: [{ $type: "$maHV" }, "string"] },
      { $eq: [{ $type: "$hoTen" }, "string"] },
      { $eq: [{ $type: "$email" }, "string"] },
      { $eq: [{ $type: "$diaChi" }, "object"] },
      { $eq: [{ $type: "$diaChi.thanhPho" }, "string"] },
      { $eq: [{ $type: "$diaChi.quan" }, "string"] },
      { $in: [{ $type: "$hocBong" }, ["int", "long", "double", "decimal"]] },
      { $gte: ["$hocBong", 0] },
      { $eq: [{ $type: "$ngayDangKy" }, "date"] },
      { $in: [{ $type: "$soDienThoai" }, ["missing", "null", "string"]] }
    ] };
    check(await source.countDocuments({ $expr: validExpression }) === 100000, "Nguồn có document sai kiểu hoặc học bổng âm.");
    check(await source.countDocuments({ maHV: /^HV\d{6}$/, email: /^hv\d{6}@example\.test$/ }) === 100000, "Mã/email nguồn sai định dạng seed.");
    check(await source.countDocuments({ $expr: { $and: [
      { $gte: [{ $toInt: { $substrBytes: ["$maHV", 2, 6] } }, 1] },
      { $lte: [{ $toInt: { $substrBytes: ["$maHV", 2, 6] } }, 100000] },
      { $eq: ["$email", { $concat: [{ $toLower: "$maHV" }, "@example.test"] }] }
    ] } }) === 100000, "Mã phải trong HV000001–HV100000 và email phải tương ứng với mã.");
    await checkUnique("maHV", {});
    await checkUnique("email", {});
    await checkUnique("soDienThoai", { soDienThoai: { $type: "string" } });
    const cityGroups = await source.aggregate([{ $group: { _id: "$diaChi.thanhPho", districts: { $addToSet: "$diaChi.quan" } } }]).toArray();
    check(cityGroups.length >= 5 && cityGroups.every(function (city) { return city.districts.length >= 2; }), "Cần ít nhất năm thành phố, mỗi thành phố nhiều quận.");
    const sourceChecks = {
      missing: await source.countDocuments({ soDienThoai: { $exists: false } }),
      null: await source.countDocuments({ soDienThoai: { $type: "null" } }),
      string: await source.countDocuments({ soDienThoai: { $type: "string" } }),
      hcmQuan7: await source.countDocuments({ "diaChi.thanhPho": "TP.HCM", "diaChi.quan": "Quan7" }),
      hcmQuan7Scholarship: await source.countDocuments({ "diaChi.thanhPho": "TP.HCM", "diaChi.quan": "Quan7", hocBong: { $gte: 1000000 } })
    };
    check(sourceChecks.missing > 0 && sourceChecks.null > 0 && sourceChecks.string > 0, "Thiếu một trong ba nhóm số điện thoại.");
    check(sourceChecks.hcmQuan7 >= 1000 && sourceChecks.hcmQuan7Scholarship >= 100, "Không đạt điều kiện TP.HCM/Quan7.");
    report.sourceChecks = sourceChecks;
    report.baselineSha256 = await fingerprint(source);

    // Chuẩn bị một bộ dữ liệu dùng chung cho cả A/B và cả 5 lượt, trước mọi phép đo.
    const documents = [];
    for (let number = 100001; number <= 101000; number += 1) {
      const suffix = String(number).padStart(6, "0");
      documents.push({
        _id: "lab03_write_HV" + suffix,
        maHV: "HV" + suffix,
        hoTen: "Học viên ghi " + suffix,
        email: "hv" + suffix + "@example.test",
        diaChi: { thanhPho: "TP.HCM", quan: "Quan7" },
        hocBong: 1000000 + (number % 5) * 100000,
        ngayDangKy: new Date(Date.UTC(2026, 0, 1)),
        soDienThoai: "09" + String(number).padStart(8, "0")
      });
    }
    const ids = documents.map(function (document) { return document._id; });
    const emails = documents.map(function (document) { return document.email; });
    const codes = documents.map(function (document) { return document.maHV; });
    const phones = documents.map(function (document) { return document.soDienThoai; });
    const idFilter = { _id: { $in: ids } };
    const update = { $inc: { hocBong: 500000 } };
    const expectedScholarships = new Map();
    documents.forEach(function (document) {
      expectedScholarships.set(document._id, document.hocBong + 500000);
    });
    check(new Set(ids).size === batchSize && new Set(emails).size === batchSize && new Set(phones).size === batchSize, "Batch mới có giá trị trùng.");
    check(await source.countDocuments({ $or: [idFilter, { email: { $in: emails } }, { maHV: { $in: codes } }, { soDienThoai: { $in: phones } }] }) === 0, "Batch mới xung đột với dữ liệu nguồn.");

    // $out ghi toàn bộ dữ liệu; drop đích trước để loại index còn từ lần chạy cũ.
    const targets = [database.getCollection("ghi_A"), database.getCollection("ghi_B")];
    for (const collection of targets) {
      await collection.drop();
      await source.aggregate([{ $out: collection.getName() }]).toArray();
      await collection.dropIndexes();
    }
    await targets[1].createIndex({ email: 1 }, { unique: true, name: "idx_email_unique" });
    await targets[1].createIndex({ "diaChi.thanhPho": 1, "diaChi.quan": 1, hocBong: -1 }, { name: "idx_C3_thanhPho_quan_hocBong" });
    await targets[1].createIndex({ soDienThoai: 1 }, { sparse: true, name: "idx_sdt_sparse" });
    const indexesA = await targets[0].getIndexes();
    const indexesB = await targets[1].getIndexes();
    check(indexesA.length === 1 && indexesA[0].name === "_id_", "ghi_A có index ngoài _id_.");
    check(indexesB.length === 4 && indexesB.some(function (index) { return index.name === "idx_email_unique" && index.unique === true; }) && indexesB.some(function (index) { return index.name === "idx_sdt_sparse" && index.sparse === true && index.unique !== true; }), "ghi_B sai cấu hình chỉ mục.");
    for (const collection of targets) {
      check(await collection.countDocuments({}) === 100000, "Bản sao không đủ 100.000 hồ sơ.");
      check(await fingerprint(collection) === report.baselineSha256, "Bản sao không giống nguồn.");
    }
    report.initialIndexes = { ghi_A: indexesA, ghi_B: indexesB };
    report.batch = { firstCode: codes[0], lastCode: codes[codes.length - 1], ids: ids };
    save();

    async function measure(collection, roundNumber, position) {
      check(await collection.countDocuments({}) === 100000, "Sai số lượng trước lượt đo.");
      check(await collection.countDocuments(idFilter) === 0, "Chưa hoàn nguyên batch trước.");
      const row = { collection: collection.getName(), round: roundNumber, position: position, restored: false };
      report.rounds.push(row);
      try {
        // Chỉ vùng hai mốc thời gian này được tính là thời gian INSERT.
        const insertStart = performance.now();
        const insertResult = await collection.insertMany(documents, { ordered: true, writeConcern: writeConcern });
        row.insertMillis = performance.now() - insertStart;
        check(insertResult.acknowledged && Object.keys(insertResult.insertedIds).length === batchSize, "INSERT không đủ 1.000 document.");
        check(await collection.countDocuments({}) === 101000 && await collection.countDocuments(idFilter) === batchSize, "Dữ liệu sau INSERT sai.");

        // UPDATE đúng các _id vừa thêm; C3 ở B phải cập nhật khóa hocBong.
        const updateStart = performance.now();
        const updateResult = await collection.updateMany(idFilter, update, { writeConcern: writeConcern });
        row.updateMillis = performance.now() - updateStart;
        row.insertedCount = Object.keys(insertResult.insertedIds).length;
        row.matchedCount = Number(updateResult.matchedCount);
        row.modifiedCount = Number(updateResult.modifiedCount);
        check(updateResult.acknowledged && row.matchedCount === batchSize && row.modifiedCount === batchSize, "UPDATE không sửa đúng 1.000 hồ sơ.");
        const updatedDocuments = await collection.find(idFilter).toArray();
        check(updatedDocuments.length === batchSize, "Không đọc lại đủ 1.000 hồ sơ đã UPDATE.");
        updatedDocuments.forEach(function (document) {
          check(Number(document.hocBong) === expectedScholarships.get(document._id), "Giá trị học bổng sau UPDATE sai: " + document._id);
        });
        row.success = true;
      } catch (error) {
        row.success = false;
        row.error = { code: error.code === undefined ? null : Number(error.code), errmsg: error.errmsg || error.message || String(error) };
        throw error;
      } finally {
        // Luôn thử hoàn nguyên ngay cả khi INSERT/UPDATE mới hoàn tất một phần.
        // Chỉ xóa chính xác những _id chuẩn bị trước, không xóa theo khoảng hay toàn bộ.
        try {
          const removed = await collection.deleteMany(idFilter, { writeConcern: writeConcern });
          row.deletedCount = Number(removed.deletedCount);
          row.countAfterRestore = await collection.countDocuments({});
          check(await collection.countDocuments(idFilter) === 0 && row.countAfterRestore === 100000, "Hoàn nguyên thất bại.");
          if (row.success) check(row.deletedCount === batchSize, "Không xóa đúng 1.000 hồ sơ vừa thêm.");
          row.restored = true;
        } catch (error) {
          row.restoreError = error.message || String(error);
          throw error;
        } finally {
          save();
          printjson(row);
        }
      }
    }

    // Chạy tuần tự, đổi A/B ở lượt chẵn để giảm thiên lệch do thứ tự chạy cố định.
    for (let round = 1; round <= repetitions; round += 1) {
      const order = round % 2 === 1 ? targets : targets.slice().reverse();
      for (let position = 0; position < order.length; position += 1) {
        await measure(order[position], round, position + 1);
      }
    }

    // Hai collection phải trở về dữ liệu gốc trước khi lấy dung lượng index.
    for (const collection of targets) {
      check(await collection.countDocuments({}) === 100000, "Sai số lượng cuối cùng.");
      check(await fingerprint(collection) === report.baselineSha256, "Nội dung sau hoàn nguyên không giống nguồn.");
    }
    check(await fingerprint(source) === report.baselineSha256, "hocvien bị tiến trình khác thay đổi trong lúc đo.");
    for (const collection of targets) {
      const stats = await collection.stats({ scale: 1 });
      const rows = report.rounds.filter(function (row) { return row.collection === collection.getName(); });
      check(rows.length === repetitions && rows.every(function (row) { return row.success && row.restored; }), "Có lượt chưa đo/hoàn nguyên thành công.");
      const indexSizes = {};
      Object.keys(stats.indexSizes).forEach(function (name) { indexSizes[name] = Number(stats.indexSizes[name]); });
      report.collections.push({
        collection: collection.getName(), count: Number(stats.count),
        insertMillisSamples: rows.map(function (row) { return row.insertMillis; }),
        updateMillisSamples: rows.map(function (row) { return row.updateMillis; }),
        medianInsertMillis: median(rows.map(function (row) { return row.insertMillis; })),
        medianUpdateMillis: median(rows.map(function (row) { return row.updateMillis; })),
        indexSizes: indexSizes, totalIndexSize: Number(stats.totalIndexSize), indexes: await collection.getIndexes()
      });
    }
    const columns = ["collection", "count", "insertMillisSamples", "updateMillisSamples", "medianInsertMillis", "medianUpdateMillis", "indexSizes", "totalIndexSize"];
    const csvRows = [columns.map(csvCell).join(",")];
    report.collections.forEach(function (row) {
      csvRows.push(columns.map(function (column) {
        return csvCell(typeof row[column] === "object" ? JSON.stringify(row[column]) : row[column]);
      }).join(","));
    });
    fs.writeFileSync(path.join(directory, "write_cost_summary.csv"), "\uFEFF" + csvRows.join("\r\n") + "\r\n", "utf8");
    report.completed = true;
    report.finishedAt = new Date().toISOString();
    save();
    printjson(report.collections);
    print("Hoàn tất đo chi phí ghi. Kết quả: " + directory);
  } catch (error) {
    report.fatalError = { code: error.code === undefined ? null : Number(error.code), errmsg: error.errmsg || error.message || String(error) };
    save();
    throw error;
  }
}

main().catch(function (error) {
  console.error(error);
  quit(1);
});
