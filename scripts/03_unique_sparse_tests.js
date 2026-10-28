/* Chạy từ gốc repo bằng mongosh; chỉ tạo lại ba collection test_* của phần B. */
"use strict";

async function main() {
  const fs = require("fs");
  const path = require("path");
  const database = db.getSiblingDB("lab03_indexing");
  const directory = path.resolve(process.cwd(), "ketqua");
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, "unique_sparse_results.json");
  const report = { serverVersion: await database.version(), startedAt: new Date(), completed: false, operations: [] };

  function save() {
    fs.writeFileSync(filename, EJSON.stringify(report, null, 2, { relaxed: false }) + "\n", "utf8");
  }
  function check(condition, message) {
    if (!condition) throw new Error(message);
  }
  function errorInfo(error) {
    return {
      code: error.code === undefined ? null : Number(error.code),
      codeName: error.codeName || null,
      errmsg: error.errmsg || error.message || String(error),
      keyPattern: error.keyPattern || null,
      keyValue: error.keyValue || null
    };
  }
  async function snapshot(collection) {
    return {
      count: await collection.countDocuments({}),
      documents: await collection.find({}).sort({ _id: 1 }).toArray(),
      indexes: await collection.getIndexes()
    };
  }
  function same(left, right) {
    return EJSON.stringify(left) === EJSON.stringify(right);
  }
  function expectIds(documents, expected) {
    const actual = documents.map(function (document) { return Number(document._id); }).sort(function (a, b) { return a - b; });
    check(same(actual, expected), "Sai danh sách _id: " + JSON.stringify(actual));
  }

  // Lưu nhật ký cả khi lỗi bất ngờ hoặc kiểm tra hậu điều kiện thất bại.
  async function step(collection, label, input, explanation, action, expectedCode, verify) {
    const entry = { label: label, collection: collection.getName(), input: input, explanation: explanation, expectedCode: expectedCode, before: await snapshot(collection) };
    try {
      entry.result = await action();
      entry.success = true;
      entry.error = null;
    } catch (error) {
      entry.success = false;
      entry.error = errorInfo(error);
    }
    entry.after = await snapshot(collection);
    entry.passed = false;
    report.operations.push(entry);
    save();
    try {
      check(expectedCode === null ? entry.success : !entry.success && entry.error.code === expectedCode, "Kết quả/lỗi không như dự kiến: " + label);
      if (expectedCode !== null) {
        check(same(entry.before.documents, entry.after.documents), "Thao tác bị từ chối nhưng dữ liệu đã đổi: " + label);
        check(same(entry.before.indexes, entry.after.indexes), "Thao tác bị từ chối nhưng index đã đổi: " + label);
      }
      if (verify) await verify(entry);
      entry.passed = true;
    } catch (error) {
      entry.verificationError = errorInfo(error);
      save();
      printjson(entry);
      throw error;
    }
    save();
    print("\n[ĐẠT] " + label + " | số document: " + entry.before.count + " -> " + entry.after.count);
    printjson(entry);
    return entry;
  }

  async function reset(name, documents) {
    const collection = database.getCollection(name);
    const entry = { label: "Tạo lại " + name, collection: name, input: documents, explanation: "Xóa collection thử nghiệm cũ, tạo mới và nạp toàn bộ dữ liệu mẫu." };
    report.operations.push(entry);
    try {
      const exists = (await database.getCollectionInfos({ name: name })).length > 0;
      entry.before = exists ? await snapshot(collection) : { count: 0, documents: [], indexes: [] };
      if (exists) await collection.drop();
      await database.createCollection(name);
      entry.result = await collection.insertMany(documents);
      entry.after = await snapshot(collection);
      check(entry.after.count === documents.length, "Nạp sai số document mẫu.");
      check(same(entry.after.documents, documents), "Dữ liệu mẫu không được sao chép nguyên vẹn.");
      entry.success = true;
      entry.passed = true;
    } catch (error) {
      entry.success = false;
      entry.passed = false;
      entry.error = errorInfo(error);
      save();
      printjson(entry);
      throw error;
    }
    save();
    printjson(entry);
    return collection;
  }

  try {
    // Bài 5: dữ liệu trùng ngăn xây dựng unique index ngay từ đầu.
    const unique = await reset("test_unique", [
      { _id: 1, hoTen: "Nguyễn An", email: "an@example.test" },
      { _id: 2, hoTen: "Trần Bình", email: "an@example.test" },
      { _id: 3, hoTen: "Lê Chi", email: "chi@example.test" }
    ]);
    const emailKey = { email: 1 };
    const emailOptions = { unique: true, name: "idx_email_unique" };
    await step(unique, "B5.1: tạo unique khi còn email trùng", { key: emailKey, options: emailOptions },
      "Hai _id khác nhau có cùng email; dự kiến E11000 và không tạo được index.",
      async function () { return await unique.createIndex(emailKey, emailOptions); }, 11000);
    await step(unique, "B5.2: sửa email trùng", { filter: { _id: 2 }, update: { $set: { email: "binh@example.test" } } },
      "Đổi email của _id=2, giữ nguyên ba hồ sơ.",
      async function () { return await unique.updateOne({ _id: 2 }, { $set: { email: "binh@example.test" } }); }, null,
      async function (entry) {
        check(entry.after.count === 3 && entry.result.modifiedCount === 1, "Không sửa được hồ sơ.");
        check(entry.after.documents[1].email === "binh@example.test", "Email sau sửa không đúng.");
      });
    await step(unique, "B5.3: tạo unique sau khi sửa", { key: emailKey, options: emailOptions },
      "Các email đã khác nhau nên unique index được tạo thành công.",
      async function () { return await unique.createIndex(emailKey, emailOptions); }, null,
      async function (entry) { check(entry.after.indexes.some(function (index) { return index.name === emailOptions.name && index.unique === true; }), "Thiếu unique index."); });
    const newEmail = { _id: 4, hoTen: "Phạm Dũng", email: "dung@example.test" };
    await step(unique, "B5.4: insert email mới", newEmail, "Email mới hợp lệ; số hồ sơ tăng từ 3 lên 4.",
      async function () { return await unique.insertOne(newEmail); }, null,
      async function (entry) { check(entry.after.count === 4 && same(entry.after.documents[3], newEmail), "Thêm email mới không đúng."); });
    const duplicateEmail = { _id: 5, hoTen: "Võ Hà", email: "an@example.test" };
    await step(unique, "B5.5: insert email đã có", duplicateEmail, "Unique từ chối email trùng dù _id mới; dữ liệu giữ nguyên 4 hồ sơ.",
      async function () { return await unique.insertOne(duplicateEmail); }, 11000);
    await step(unique, "B5.6: update thành email của hồ sơ khác", { filter: { _id: 4 }, update: { $set: { email: "chi@example.test" } } },
      "Unique kiểm tra cả UPDATE; email dung@example.test phải được giữ nguyên khi lệnh bị từ chối.",
      async function () { return await unique.updateOne({ _id: 4 }, { $set: { email: "chi@example.test" } }); }, 11000);

    // Bài 6: sparse bỏ qua missing, vẫn lưu các document có giá trị null.
    const original = [
      { _id: 1, hoTen: "Thiếu số 1" },
      { _id: 2, hoTen: "Thiếu số 2" },
      { _id: 3, hoTen: "Null 1", soDienThoai: null },
      { _id: 4, hoTen: "Null 2", soDienThoai: null },
      { _id: 5, hoTen: "Có số 1", soDienThoai: "0900000001" },
      { _id: 6, hoTen: "Có số 2", soDienThoai: "0900000002" }
    ];
    const sparse = await reset("test_sparse", original);
    const phoneKey = { soDienThoai: 1 };
    await step(sparse, "B6.1: tạo sparse không unique", { key: phoneKey, options: { sparse: true, name: "idx_sdt_sparse" } },
      "Null vẫn có entry trong index; vì không unique nên hai null không xung đột.",
      async function () { return await sparse.createIndex(phoneKey, { sparse: true, name: "idx_sdt_sparse" }); }, null);

    async function query(label, filter, hint, expectedIds, explanation) {
      return await step(sparse, label, { filter: filter, hint: hint }, explanation,
        async function () {
          function cursor() {
            const value = sparse.find(filter);
            return hint ? value.hint(hint) : value;
          }
          const documents = await cursor().toArray();
          const explain = await cursor().explain("executionStats");
          return { count: documents.length, documents: documents, explain: explain };
        }, null,
        async function (entry) {
          expectIds(entry.result.documents, expectedIds);
          check(entry.result.count === expectedIds.length, "Sai số kết quả truy vấn sparse.");
          check(Number(entry.result.explain.executionStats.nReturned) === expectedIds.length, "Explain và find khác số kết quả.");
          check(same(entry.before.documents, entry.after.documents), "Truy vấn đọc làm đổi dữ liệu.");
        });
    }
    await query("B6.2: exists true", { soDienThoai: { $exists: true } }, null, [3, 4, 5, 6], "Có trường gồm hai null và hai chuỗi: 4 kết quả; kế hoạch do MongoDB chọn.");
    await query("B6.3: exists false", { soDienThoai: { $exists: false } }, null, [1, 2], "Chỉ hai document missing khớp; sparse không chứa chúng.");
    await query("B6.4: bằng null", { soDienThoai: null }, null, [1, 2, 3, 4], "Phép bằng null khớp cả missing và null: 4 kết quả; không ép sparse index.");
    await query("B6.5: find toàn bộ", {}, null, [1, 2, 3, 4, 5, 6], "Truy vấn bình thường trả đủ 6 document.");
    await query("B6.6: find toàn bộ nhưng hint sparse", {}, "idx_sdt_sparse", [3, 4, 5, 6], "Ép sparse index chỉ trả 4 document: hai null vẫn có, hai missing bị bỏ sót.");

    // Bài 7: sao chép nguyên vẹn dữ liệu gốc, không sửa test_sparse.
    const copiedDocuments = await sparse.find({}).sort({ _id: 1 }).toArray();
    check(same(copiedDocuments, original), "test_sparse không còn nguyên vẹn sáu document gốc.");
    const sparseUnique = await reset("test_sparse_unique", copiedDocuments);
    const sparseUniqueOptions = { unique: true, sparse: true, name: "idx_sdt_unique_sparse" };
    await step(sparseUnique, "B7.1: unique sparse với hai null", { key: phoneKey, options: sparseUniqueOptions },
      "Hai missing không gây lỗi; hai null được index lưu và vi phạm unique: E11000.",
      async function () { return await sparseUnique.createIndex(phoneKey, sparseUniqueOptions); }, 11000);
    await step(sparseUnique, "B7.2: chuyển null thứ hai thành missing", { filter: { _id: 4 }, update: { $unset: { soDienThoai: "" } } },
      "Dùng $unset để giữ đủ 6 hồ sơ nhưng chỉ còn một null được index lưu.",
      async function () { return await sparseUnique.updateOne({ _id: 4 }, { $unset: { soDienThoai: "" } }); }, null,
      async function (entry) {
        check(entry.after.count === 6 && entry.result.modifiedCount === 1, "Không xử lý được null xung đột.");
        check(entry.after.documents.filter(function (document) { return document.soDienThoai === null; }).length === 1, "Không còn đúng một null.");
        check(!Object.prototype.hasOwnProperty.call(entry.after.documents[3], "soDienThoai"), "Trường chưa được unset.");
      });
    await step(sparseUnique, "B7.3: tạo lại unique sparse", { key: phoneKey, options: sparseUniqueOptions },
      "Ba missing bị bỏ qua; một null và hai số khác nhau thỏa unique.",
      async function () { return await sparseUnique.createIndex(phoneKey, sparseUniqueOptions); }, null,
      async function (entry) { check(entry.after.indexes.some(function (index) { return index.name === sparseUniqueOptions.name && index.sparse === true && index.unique === true; }), "Thiếu unique sparse index."); });
    const missing = { _id: 7, hoTen: "Thiếu số mới" };
    await step(sparseUnique, "B7.4: insert missing", missing, "Sparse bỏ qua document không có trường, nên thêm missing tiếp theo thành công.",
      async function () { return await sparseUnique.insertOne(missing); }, null,
      async function (entry) { check(entry.after.count === 7 && same(entry.after.documents[6], missing), "Không thêm đúng hồ sơ missing."); });
    const anotherNull = { _id: 8, hoTen: "Null mới", soDienThoai: null };
    await step(sparseUnique, "B7.5: insert null thứ hai", anotherNull, "Null đã có entry trong unique sparse index nên bị E11000; giữ 7 document.",
      async function () { return await sparseUnique.insertOne(anotherNull); }, 11000);
    const anotherPhone = { _id: 9, hoTen: "Số trùng", soDienThoai: "0900000001" };
    await step(sparseUnique, "B7.6: insert chuỗi số trùng", anotherPhone, "Số điện thoại đã có cũng vi phạm unique; giữ 7 document.",
      async function () { return await sparseUnique.insertOne(anotherPhone); }, 11000);
    report.completed = true;
    report.finishedAt = new Date();
    save();
    print("Hoàn tất Unique/Sparse. Minh chứng: " + filename);
  } catch (error) {
    report.fatalError = errorInfo(error);
    save();
    throw error;
  }
}

main().catch(function (error) {
  console.error(error);
  quit(1);
});
