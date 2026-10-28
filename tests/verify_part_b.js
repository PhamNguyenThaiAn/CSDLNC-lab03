/* Kiểm tra luồng điều khiển bằng MongoDB giả lập, KHÔNG phải thực nghiệm server.
 * Chạy: node tests/verify_part_b.js. File minh chứng giả lập chỉ nằm trong RAM.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert/strict");
const crypto = require("crypto");
const root = path.resolve(__dirname, "..");
const copy = function (value) { return structuredClone(value); };
function get(document, key) {
  return key.split(".").reduce(function (value, part) { return value === undefined || value === null ? undefined : value[part]; }, document);
}
function bsonType(value) {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Object.prototype.toString.call(value) === "[object Date]") return "date";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "double";
  return typeof value;
}
function expression(value, document) {
  if (typeof value === "string" && value.startsWith("$")) return get(document, value.slice(1));
  if (Array.isArray(value)) return value.map(function (part) { return expression(part, document); });
  if (value === null || typeof value !== "object") return value;
  const operator = Object.keys(value)[0];
  const argument = value[operator];
  const result = expression(argument, document);
  switch (operator) {
    case "$type": return bsonType(result);
    case "$eq": return result[0] === result[1];
    case "$gte": return result[0] >= result[1];
    case "$lte": return result[0] <= result[1];
    case "$and": return result.every(Boolean);
    case "$in": return result[1].includes(result[0]);
    case "$toInt": return Number.parseInt(result, 10);
    case "$substrBytes": return result[0].slice(result[1], result[1] + result[2]);
    case "$concat": return result.join("");
    case "$toLower": return result.toLowerCase();
    case "$mod": return result[0] % result[1];
    case "$multiply": return result.reduce(function (a, b) { return a * b; }, 1);
    case "$add": return result.reduce(function (a, b) { return a + b; }, 0);
    default: throw Error("Biểu thức chưa được mô phỏng: " + operator);
  }
}
function matches(document, query) {
  return Object.entries(query).every(function ([key, condition]) {
    if (key === "$expr") return expression(condition, document);
    if (key === "$and") return condition.every(function (part) { return matches(document, part); });
    if (key === "$or") return condition.some(function (part) { return matches(document, part); });
    const actual = get(document, key);
    if (Object.prototype.toString.call(condition) === "[object RegExp]") return condition.test(actual);
    if (condition === null) return actual === null || actual === undefined;
    if (typeof condition !== "object") return actual === condition;
    return Object.entries(condition).every(function ([operator, target]) {
      if (operator === "$exists") return (actual !== undefined) === target;
      if (operator === "$type") return bsonType(actual) === target;
      if (operator === "$gte") return actual >= target;
      if (operator === "$gt") return actual > target;
      if (operator === "$in") return target.includes(actual);
      throw Error("Bộ lọc chưa được mô phỏng: " + operator);
    });
  });
}

function createDatabase() {
  const collections = new Map();
  const database = {
    version() { return "MOCK_ONLY"; },
    getName() { return "lab03_indexing"; },
    async getCollectionInfos(filter) { return collections.has(filter.name) ? [{ name: filter.name }] : []; },
    async createCollection(name) { if (!collections.has(name)) database.getCollection(name).ensure(); },
    getCollection(name) {
      function ensure() {
        if (!collections.has(name)) collections.set(name, { documents: new Map(), indexes: [{ name: "_id_", key: { _id: 1 } }], unique: new Map() });
        return collections.get(name);
      }
      function keyOf(document, index) {
        const values = Object.keys(index.key).map(function (field) { return get(document, field); });
        if (index.sparse && values.every(function (value) { return value === undefined; })) return undefined;
        return JSON.stringify(values);
      }
      function duplicate() { const error = new Error("E11000 duplicate key (MOCK)"); error.code = 11000; throw error; }
      function store(document) {
        const state = ensure();
        for (const [indexName, keys] of state.unique) {
          const index = state.indexes.find(function (item) { return item.name === indexName; });
          const key = keyOf(document, index);
          if (key !== undefined && keys.has(key) && keys.get(key) !== document._id) duplicate();
        }
        const previous = state.documents.get(document._id);
        for (const [indexName, keys] of state.unique) {
          const index = state.indexes.find(function (item) { return item.name === indexName; });
          if (previous) keys.delete(keyOf(previous, index));
          const key = keyOf(document, index);
          if (key !== undefined) keys.set(key, document._id);
        }
        state.documents.set(document._id, copy(document));
      }
      function all(query) {
        // Các phép ghi của 04 truy cập batch bằng _id, tránh quét 100.000 lần.
        if (query._id && query._id.$in && Object.keys(query).length === 1) {
          return query._id.$in.map(function (id) { return ensure().documents.get(id); }).filter(Boolean);
        }
        return Array.from(ensure().documents.values()).filter(function (document) { return matches(document, query); });
      }
      const collection = {
        ensure: ensure,
        getName() { return name; },
        async drop() { return collections.delete(name); },
        async countDocuments(query) { return all(query).length; },
        async getIndexes() { return copy(ensure().indexes); },
        async dropIndexes() { ensure().indexes = [{ name: "_id_", key: { _id: 1 } }]; ensure().unique.clear(); },
        async createIndex(key, options) {
          const index = { key: copy(key), ...copy(options) };
          if (index.unique) {
            const keys = new Map();
            for (const document of ensure().documents.values()) {
              const value = keyOf(document, index);
              if (value === undefined) continue;
              if (keys.has(value)) duplicate();
              keys.set(value, document._id);
            }
            ensure().unique.set(index.name, keys);
          }
          ensure().indexes.push(index);
          return index.name;
        },
        async insertOne(document) {
          if (ensure().documents.has(document._id)) duplicate();
          store(document);
          return { acknowledged: true, insertedId: document._id };
        },
        async insertMany(documents) {
          const insertedIds = {};
          for (let i = 0; i < documents.length; i += 1) {
            if (database.failInsert && name === "ghi_A" && documents.length === 1000 && i === 13) duplicate();
            await collection.insertOne(documents[i]);
            insertedIds[i] = documents[i]._id;
          }
          return { acknowledged: true, insertedIds: insertedIds };
        },
        async updateOne(query, update) { return await collection.updateMany(query, update, {}, true); },
        async updateMany(query, update, options, single) {
          if (database.failUpdate && name === "ghi_A") throw Error("Lỗi UPDATE chủ động để kiểm tra finally");
          let count = 0;
          for (const document of all(query)) {
            const next = copy(document);
            if (update.$set) Object.assign(next, copy(update.$set));
            if (update.$unset) Object.keys(update.$unset).forEach(function (key) { delete next[key]; });
            if (update.$inc) Object.entries(update.$inc).forEach(function ([key, amount]) { next[key] += amount; });
            store(next); count += 1;
            if (single) break;
          }
          return { acknowledged: true, matchedCount: count, modifiedCount: count };
        },
        async deleteMany(query) {
          const documents = all(query);
          for (const document of documents) {
            for (const [indexName, keys] of ensure().unique) {
              const index = ensure().indexes.find(function (item) { return item.name === indexName; });
              keys.delete(keyOf(document, index));
            }
            ensure().documents.delete(document._id);
          }
          return { acknowledged: true, deletedCount: documents.length };
        },
        find(query) {
          let sort = null;
          let hint = null;
          return {
            sort(value) { sort = value; return this; },
            hint(value) { hint = value; return this; },
            async toArray() {
              let documents = all(query);
              if (hint) {
                const index = ensure().indexes.find(function (item) { return item.name === hint; });
                documents = documents.filter(function (document) { return keyOf(document, index) !== undefined; });
              }
              if (sort) documents.sort(function (left, right) { return left._id < right._id ? -1 : left._id > right._id ? 1 : 0; });
              return copy(documents);
            },
            async explain() {
              const documents = await this.toArray();
              return { executionStats: { nReturned: documents.length }, queryPlanner: { winningPlan: { stage: hint ? "IXSCAN" : "COLLSCAN" } } };
            }
          };
        },
        aggregate(pipeline) {
          return { async toArray() {
            let documents = Array.from(ensure().documents.values());
            for (const stage of pipeline) {
              if (stage.$match) documents = documents.filter(function (document) { return matches(document, stage.$match); });
              else if (stage.$out) { await database.getCollection(stage.$out).insertMany(documents); documents = []; }
              else if (stage.$count) documents = documents.length ? [{ [stage.$count]: documents.length }] : [];
              else if (stage.$group) {
                const groups = new Map();
                for (const document of documents) {
                  const id = expression(stage.$group._id, document);
                  const token = JSON.stringify(id);
                  if (!groups.has(token)) groups.set(token, { _id: id });
                  const group = groups.get(token);
                  for (const [field, accumulator] of Object.entries(stage.$group)) {
                    if (field === "_id") continue;
                    if (accumulator.$sum) group[field] = (group[field] || 0) + 1;
                    if (accumulator.$addToSet) {
                      if (!group[field]) group[field] = [];
                      const item = expression(accumulator.$addToSet, document);
                      if (!group[field].includes(item)) group[field].push(item);
                    }
                  }
                }
                documents = Array.from(groups.values());
              } else throw Error("Pipeline chưa được mô phỏng");
            }
            return copy(documents);
          } };
        },
        async stats() {
          // Đây là số giả chỉ để kiểm tra xuất file, không phải dung lượng MongoDB.
          const sizes = {};
          ensure().indexes.forEach(function (index) { sizes[index.name] = 4096; });
          return { count: ensure().documents.size, indexSizes: sizes, totalIndexSize: Object.values(sizes).reduce(function (a, b) { return a + b; }, 0) };
        }
      };
      return collection;
    }
  };
  return database;
}

async function run(filename, database, files) {
  let scriptError;
  const context = vm.createContext({
    db: { getSiblingDB(name) { assert.equal(name, "lab03_indexing"); return database; } },
    require(name) {
      if (name === "fs") return { mkdirSync() {}, writeFileSync(filename, content) { files.set(path.basename(filename), content); } };
      return require(name);
    },
    process: { cwd() { return root; } }, EJSON: { stringify: JSON.stringify },
    print() {}, printjson() {}, console: { error(error) { scriptError = error; } },
    quit(code) { throw scriptError || Error("exit " + code); }
  });
  await vm.runInContext(fs.readFileSync(path.join(root, "scripts", filename), "utf8"), context);
}

(async function () {
  const database = createDatabase();
  const files = new Map();
  await run("03_unique_sparse_tests.js", database, files);
  const unique = JSON.parse(files.get("unique_sparse_results.json"));
  assert.equal(unique.completed, true);
  assert(unique.operations.every(function (entry) { return entry.passed; }));
  assert.equal(unique.operations.filter(function (entry) { return entry.error && entry.error.code === 11000; }).length, 6);
  assert.equal(await database.getCollection("test_unique").countDocuments({}), 4);
  assert.equal(await database.getCollection("test_sparse").countDocuments({}), 6);
  assert.equal(await database.getCollection("test_sparse_unique").countDocuments({}), 7);
  await run("01_seed.js", database, files);
  await run("04_write_cost_benchmarks.js", database, files);
  const summary = JSON.parse(files.get("write_cost_summary.json"));
  assert.equal(summary.completed, true);
  assert.equal(summary.rounds.length, 10);
  assert(summary.rounds.every(function (row) { return row.success && row.restored && row.deletedCount === 1000 && row.modifiedCount === 1000; }));
  assert.deepEqual(summary.collections.map(function (row) { return row.indexes.length; }), [1, 4]);
  for (const row of summary.collections) {
    assert.equal(row.count, 100000);
    const sorted = row.insertMillisSamples.slice().sort(function (a, b) { return a - b; });
    assert.equal(row.medianInsertMillis, sorted[2]);
    assert.equal(row.updateMillisSamples.length, 5);
  }
  assert.equal(files.get("write_cost_summary.csv").trim().split("\r\n").length, 3);
  // Tạo lỗi UPDATE sau INSERT và chứng minh batch được xóa trong finally.
  database.failUpdate = true;
  await assert.rejects(run("04_write_cost_benchmarks.js", database, files));
  const failed = JSON.parse(files.get("write_cost_summary.json"));
  assert.equal(failed.completed, false);
  assert.equal(failed.rounds[0].restored, true);
  assert.equal(failed.rounds[0].success, false);
  assert(failed.fatalError);
  assert.equal(await database.getCollection("ghi_A").countDocuments({}), 100000);
  assert.equal(await database.getCollection("ghi_B").countDocuments({}), 100000);
  assert.equal(await database.getCollection("hocvien").countDocuments({}), 100000);
  database.failUpdate = false;
  database.failInsert = true;
  await assert.rejects(run("04_write_cost_benchmarks.js", database, files));
  const partial = JSON.parse(files.get("write_cost_summary.json"));
  assert.equal(partial.completed, false);
  assert.equal(partial.rounds[0].restored, true);
  assert.equal(partial.rounds[0].deletedCount, 13);
  assert.equal(await database.getCollection("ghi_A").countDocuments({}), 100000);
  console.log("PASS (MOCK ONLY): Unique/Sparse, 10 lượt ghi, trung vị, CSV, fingerprint và hoàn nguyên khi UPDATE lỗi hoặc INSERT dở dang. Không lưu minh chứng giả lập ra đĩa.");
})().catch(function (error) { console.error(error); process.exitCode = 1; });
