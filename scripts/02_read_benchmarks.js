/* Chạy từ thư mục gốc: mongosh <URI> --file scripts/02_read_benchmarks.js */
"use strict";

async function main() {
  const fs = require("fs");
  const path = require("path");
  const database = db.getSiblingDB("lab03_indexing");
  const collection = database.getCollection("hocvien");
  const outputDirectory = path.resolve(process.cwd(), "ketqua");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const summary = [];
  // Kết quả gốc khi collection chỉ có index _id_.
  const baselineResults = new Map();

  // Minh chứng kiểm tra nội dung của từng bài đo.
  const contentChecks = [];
  const repetitions = 5;
  const c3 = { "diaChi.thanhPho": 1, "diaChi.quan": 1, hocBong: -1 };
  const filterQ1 = { email: "hv000001@example.test" };
  const filterQ2 = { "diaChi.thanhPho": "TP.HCM", "diaChi.quan": "Quan7", hocBong: { $gte: 1000000 } };
  const filterQ3 = { "diaChi.quan": "Quan7" };
  const projectionQ4 = { _id: 0, "diaChi.thanhPho": 1, "diaChi.quan": 1, hocBong: 1 };

  // Mỗi hàm tạo cursor mới; không dùng limit, hint hay giữ lại cursor đã chạy.
  function Q1() { return collection.find(filterQ1); }
  function Q2() { return collection.find(filterQ2).sort({ hocBong: -1 }); }
  function Q3() { return collection.find(filterQ3); }
  function Q4() { return collection.find(filterQ2, projectionQ4).sort({ hocBong: -1 }); }
  function Q4_hoTen() {
    return collection.find(filterQ2, { ...projectionQ4, hoTen: 1 }).sort({ hocBong: -1 });
  }
  function requireCondition(condition, message) {
    if (!condition) throw new Error(message);
  }
  function writeJson(filename, value) {
    // Extended JSON giữ được các kiểu BSON của explain khi đọc lại.
    fs.writeFileSync(path.join(outputDirectory, filename), EJSON.stringify(value, null, 2, { relaxed: false }) + "\n", "utf8");
  }

  // Sắp xếp tên trường để hai object có cùng dữ liệu nhưng khác
// thứ tự các trường vẫn được xem là giống nhau.
// Thứ tự phần tử bên trong một trường dạng mảng vẫn được giữ nguyên.
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    const result = {};

    Object.keys(value)
      .sort()
      .forEach(function (key) {
        result[key] = canonicalize(value[key]);
      });

    return result;
  }

  return value;
}

// Chuẩn hóa toàn bộ tập kết quả.
// Không phụ thuộc thứ tự các document, nhưng vẫn giữ số lần xuất hiện.
function normalizeResults(documents) {
  return documents
    .map(function (document) {
      const extendedJson = EJSON.stringify(
        document,
        null,
        0,
        { relaxed: false }
      );

      const plainObject = JSON.parse(extendedJson);

      return JSON.stringify(canonicalize(plainObject));
    })
    .sort();
}

async function verifyQueryResults(testName, queryFn) {
  requireCondition(
    baselineResults.has(queryFn),
    "Chưa có kết quả cơ sở cho " + testName
  );

  const expected = baselineResults.get(queryFn);
  const documents = await queryFn().toArray();
  const actual = normalizeResults(documents);

  const sameCount = actual.length === expected.length;
  const sameContent =
    JSON.stringify(actual) === JSON.stringify(expected);

  // Q2, Q4 và Q4_hoTen phải trả học bổng giảm dần.
  // Các document cùng mức học bổng được phép đổi vị trí.
  const needsScholarshipSort =
    queryFn === Q2 ||
    queryFn === Q4 ||
    queryFn === Q4_hoTen;

  let sortValid = true;

  if (needsScholarshipSort) {
    for (let index = 1; index < documents.length; index += 1) {
      if (
        Number(documents[index - 1].hocBong) <
        Number(documents[index].hocBong)
      ) {
        sortValid = false;
        break;
      }
    }
  }

  const checkResult = {
    testName: testName,
    expectedCount: expected.length,
    actualCount: actual.length,
    sameCount: sameCount,
    sameContent: sameContent,
    sortChecked: needsScholarshipSort,
    sortValid: sortValid,
    passed: sameCount && sameContent && sortValid
  };

  contentChecks.push(checkResult);

  // Lưu cả trường hợp kiểm tra thất bại để có minh chứng.
  writeJson("read_content_checks.json", contentChecks);
  printjson(checkResult);

  requireCondition(
    checkResult.passed,
    "Kết quả hoặc thứ tự sắp xếp không đúng: " + testName
  );
}
  // Duyệt riêng winningPlan, không lấy nhầm rejectedPlans hay executionStages.
  // Với SBE, cây logic nằm trong winningPlan.queryPlan.
  function extractPlan(winningPlan) {
    const stages = [];
    const indexNames = new Set();
    function visit(node) {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (typeof node.stage === "string") stages.push(node.stage);
      if (typeof node.indexName === "string") indexNames.add(node.indexName);
      Object.keys(node).forEach(function (key) {
        if (key !== "slotBasedPlan" && key !== "rejectedPlans") visit(node[key]);
      });
    }
    visit(winningPlan.queryPlan || winningPlan);
    return { stages: stages, indexNames: Array.from(indexNames) };
  }

  function csvCell(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function saveSummary() {
    // Lưu sau từng bài để vẫn có các bài đã hoàn tất nếu bài sau gặp lỗi.
    fs.writeFileSync(path.join(outputDirectory, "read_summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
    const columns = ["testName", "medianExecutionTimeMillis", "executionTimeMillisSamples", "nReturned", "totalKeysExamined", "totalDocsExamined", "indexNames", "winningPlanStages", "covered", "serverVersion", "measuredAt"];
    const rows = [columns.map(csvCell).join(",")];
    summary.forEach(function (row) {
      rows.push(columns.map(function (column) {
        const value = row[column];
        return csvCell(Array.isArray(value) ? value.join(" | ") : value);
      }).join(","));
    });
    fs.writeFileSync(path.join(outputDirectory, "read_summary.csv"), "\uFEFF" + rows.join("\r\n") + "\r\n", "utf8");
  }

  async function runBenchmark(testName, queryFn) {
    print("Đang đo: " + testName);
    await queryFn().explain("executionStats"); // Một lần làm nóng, không tính vào mẫu.
    const explains = [];
    for (let run = 0; run < repetitions; run += 1) {
      const explain = await queryFn().explain("executionStats");
      requireCondition(explain.executionStats && explain.executionStats.executionSuccess === true, "Truy vấn thất bại: " + testName);
      explains.push(explain);
    }
    const samples = explains.map(function (explain) { return Number(explain.executionStats.executionTimeMillis); });
    const sortedTimes = samples.slice().sort(function (left, right) { return left - right; });
    const median = sortedTimes[Math.floor(sortedTimes.length / 2)];
    // Các chỉ số và explain gốc cùng thuộc một lần chạy có thời gian bằng trung vị.
    const representativeRun = samples.indexOf(median);
    const representative = explains[representativeRun];
    const stats = representative.executionStats;
    const plan = extractPlan(representative.queryPlanner.winningPlan);
    const row = {
      testName: testName,
      medianExecutionTimeMillis: median,
      executionTimeMillisSamples: samples,
      representativeRun: representativeRun + 1,
      nReturned: Number(stats.nReturned),
      totalKeysExamined: Number(stats.totalKeysExamined),
      totalDocsExamined: Number(stats.totalDocsExamined),
      indexNames: plan.indexNames,
      winningPlanStages: plan.stages.join(" -> "),
      covered: Number(stats.nReturned) > 0 && Number(stats.totalDocsExamined) === 0 && plan.indexNames.length > 0,
      serverVersion: representative.serverInfo.version,
      measuredAt: new Date().toISOString(),
      indexes: await collection.getIndexes()
    };
    explains.forEach(function (explain) {
      requireCondition(Number(explain.executionStats.nReturned) === row.nReturned, "Số kết quả thay đổi giữa các lần đo: " + testName);
    });
    writeJson(testName + "_explain.json", representative);
    writeJson(testName + "_runs.json", explains);
    summary.push(row);
    saveSummary();
    printjson(row);

    // Truy vấn và so sánh nội dung nằm ngoài phần đo explain.
    await verifyQueryResults(testName, queryFn);

    return row;
  }

  async function useOnlyIndex(key, name) {
    // Mỗi cấu hình được cô lập, luôn chỉ còn _id_ và index đang thử.
    await collection.dropIndexes();
    if (key) await collection.createIndex(key, { name: name });
    const indexes = await collection.getIndexes();
    requireCondition(indexes.length === (key ? 2 : 1), "Sai số lượng chỉ mục.");
    requireCondition(indexes.some(function (index) { return index.name === "_id_"; }), "Thiếu _id_.");
    if (key) requireCondition(indexes.some(function (index) { return index.name === name; }), "Thiếu " + name);
    printjson(indexes);
  }

  requireCondition(await collection.countDocuments({}) === 100000, "Hãy chạy scripts/01_seed.js trước; cần đúng 100.000 document.");
  // Các phép count nằm ngoài phần đo; không để tiến trình khác sửa dữ liệu khi chạy.
  await useOnlyIndex(null, null);
  const baselineCounts = {
    Q1: await collection.countDocuments(filterQ1),
    Q2: await collection.countDocuments(filterQ2),
    Q3: await collection.countDocuments(filterQ3)
  };
  requireCondition(baselineCounts.Q1 === 1 && baselineCounts.Q2 >= 100 && baselineCounts.Q3 >= 1000, "Dữ liệu không đạt điều kiện thí nghiệm.");
  writeJson("read_metadata.json", { database: database.getName(), collection: "hocvien", warmups: 1, repetitions: repetitions, baselineCounts: baselineCounts, startedAt: new Date().toISOString() });

  // Tại thời điểm này collection chỉ có _id_.
// Lấy kết quả gốc cho từng dạng truy vấn.
for (const queryFn of [Q1, Q2, Q3, Q4, Q4_hoTen]) {
  const documents = await queryFn().toArray();

  baselineResults.set(
    queryFn,
    normalizeResults(documents)
  );
}

// Khởi tạo file minh chứng cho lần chạy hiện tại.
writeJson("read_content_checks.json", contentChecks);
  // Bài 2.2.1: tạo, kiểm tra, xóa theo tên và tạo lại index email.
  await runBenchmark("2_2_1_Q1_C0", Q1);
  await collection.createIndex({ email: 1 }, { name: "idx_email" });
  printjson(await collection.getIndexes());
  await collection.dropIndex("idx_email");
  const afterDrop = await collection.getIndexes();
  requireCondition(afterDrop.length === 1 && afterDrop[0].name === "_id_", "Chưa xóa được idx_email.");
  printjson(afterDrop);
  await collection.createIndex({ email: 1 }, { name: "idx_email" });
  printjson(await collection.getIndexes());
  await runBenchmark("2_2_1_Q1_idx_email", Q1);

  // Bài 2.2.2: so sánh bốn cấu hình cho cùng Q2.
  await useOnlyIndex(null, null);
  await runBenchmark("2_2_2_Q2_C0", Q2);
  await useOnlyIndex({ "diaChi.thanhPho": 1 }, "idx_C1_thanhPho");
  await runBenchmark("2_2_2_Q2_C1", Q2);
  await useOnlyIndex({ "diaChi.thanhPho": 1, "diaChi.quan": 1 }, "idx_C2_thanhPho_quan");
  await runBenchmark("2_2_2_Q2_C2", Q2);
  await useOnlyIndex(c3, "idx_C3_thanhPho_quan_hocBong");
  await runBenchmark("2_2_2_Q2_C3", Q2);

  // Bài 2.3.3: bộ tối ưu tự chọn kế hoạch, không ép dùng C3 bằng hint.
  await runBenchmark("2_3_3_Q3_C3", Q3);
  await useOnlyIndex({ "diaChi.quan": 1 }, "idx_quan");
  await runBenchmark("2_3_3_Q3_idx_quan", Q3);

  // Bài 2.3.4: kiểm tra số lượng trước và sau khi tạo C3.
  await useOnlyIndex(null, null);
  const countBeforeC3 = await collection.countDocuments(filterQ2);
  await useOnlyIndex(c3, "idx_C3_thanhPho_quan_hocBong");
  const countAfterC3 = await collection.countDocuments(filterQ2);
  requireCondition(countBeforeC3 === countAfterC3 && countAfterC3 === baselineCounts.Q2, "Index làm thay đổi số kết quả Q2.");
  writeJson("covered_count_check.json", { beforeIndex: countBeforeC3, afterIndex: countAfterC3, equal: countBeforeC3 === countAfterC3 });
  await runBenchmark("2_3_4_Q2_C3", Q2);
  const coveredResult = await runBenchmark("2_3_4_Q4_C3", Q4);
  const withNameResult = await runBenchmark("2_3_4_Q4_hoTen_C3", Q4_hoTen);

  // Kiểm tra mọi bài với số kết quả cơ sở, bao gồm cả hai phép chiếu.
  summary.forEach(function (row) {
    const expected = row.testName.includes("_Q1_") ? baselineCounts.Q1 : row.testName.includes("_Q3_") ? baselineCounts.Q3 : baselineCounts.Q2;
    requireCondition(row.nReturned === expected, "Sai số kết quả: " + row.testName);
  });
  requireCondition(coveredResult.covered, "Q4 chưa covered; hãy xem explain gốc.");
  requireCondition(withNameResult.totalDocsExamined > 0, "Q4_hoTen phải đọc document vì C3 không chứa hoTen.");
  print("Hoàn tất " + summary.length + " bài đo. Kết quả: " + outputDirectory);
}

main().catch(function (error) {
  console.error(error);
  quit(1);
});
