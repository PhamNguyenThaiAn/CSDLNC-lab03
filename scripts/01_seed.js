/* Chạy từ thư mục gốc: mongosh <URI> --file scripts/01_seed.js */
"use strict";

async function main() {
  const database = db.getSiblingDB("lab03_indexing");
  const collection = database.getCollection("hocvien");
  const totalDocuments = 100000;
  const batchSize = 5000;
  const seed = 20260303;

  // Mulberry32 chỉ sử dụng phép toán số nguyên 32 bit, cho kết quả lặp lại được.
  function mulberry32(initialSeed) {
    let state = initialSeed >>> 0;
    return function random() {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }
  const random = mulberry32(seed);
  function choose(values) {
    return values[Math.floor(random() * values.length)];
  }
  function requireCondition(condition, message) {
    if (!condition) throw new Error(message);
  }

  const locations = [
    { thanhPho: "TP.HCM", quan: ["Quan1", "Quan3", "Quan7", "BinhThanh", "ThuDuc"] },
    { thanhPho: "HaNoi", quan: ["BaDinh", "HoanKiem", "CauGiay", "DongDa"] },
    { thanhPho: "DaNang", quan: ["HaiChau", "ThanhKhe", "SonTra", "CamLe"] },
    { thanhPho: "CanTho", quan: ["NinhKieu", "BinhThuy", "CaiRang", "O Mon"] },
    { thanhPho: "HaiPhong", quan: ["HongBang", "LeChan", "NgoQuyen", "HaiAn"] }
  ];
  const familyNames = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Võ", "Đặng", "Bùi"];
  const middleNames = ["Minh", "Ngọc", "Thanh", "Quang", "Thị", "Văn"];
  const givenNames = ["An", "Bình", "Chi", "Dũng", "Hà", "Linh", "Nam", "Phương", "Trang"];
  const scholarshipLevels = [0, 200000, 500000, 1000000, 1500000, 2000000, 3000000, 5000000];
  const startDate = Date.UTC(2022, 0, 1);
  const dateSpan = Date.UTC(2026, 0, 1) - startDate;

  // Xóa collection để loại cả dữ liệu, index cũ và tùy chọn collection cũ.
  // MongoDB tự tạo lại duy nhất index _id_ khi tạo collection mới.
  await collection.drop();
  await database.createCollection("hocvien");
  let batch = [];
  for (let number = 1; number <= totalDocuments; number += 1) {
    const suffix = String(number).padStart(6, "0");
    const location = choose(locations);
    const document = {
      // _id cũng cố định để toàn bộ document giống nhau giữa các lần seed.
      _id: number,
      maHV: "HV" + suffix,
      hoTen: choose(familyNames) + " " + choose(middleNames) + " " + choose(givenNames),
      email: "hv" + suffix + "@example.test",
      diaChi: { thanhPho: location.thanhPho, quan: choose(location.quan) },
      hocBong: choose(scholarshipLevels),
      ngayDangKy: new Date(startDate + Math.floor(random() * dateSpan))
    };

    // Bảo đảm ràng buộc thay vì trông chờ xác suất của bộ sinh ngẫu nhiên.
    if (number <= 2000) {
      document.diaChi = { thanhPho: "TP.HCM", quan: "Quan7" };
      if (number <= 500) document.hocBong = 1000000 + (number % 5) * 500000;
    }

    // Ba nhóm tách biệt: thiếu trường, null, chuỗi duy nhất có 10 chữ số.
    if (number % 3 === 1) {
      document.soDienThoai = null;
    } else if (number % 3 === 2) {
      document.soDienThoai = "09" + String(number).padStart(8, "0");
    }
    batch.push(document);
    if (batch.length === batchSize) {
      await collection.insertMany(batch, { ordered: true });
      print("Đã nạp " + number + "/" + totalDocuments + " học viên.");
      batch = [];
    }
  }
  if (batch.length > 0) await collection.insertMany(batch, { ordered: true });

  // {soDienThoai: null} khớp cả thiếu trường, vì thế dùng $type cho nhóm null.
  const report = {
    seed: seed,
    totalDocuments: await collection.countDocuments({}),
    phoneMissing: await collection.countDocuments({ soDienThoai: { $exists: false } }),
    phoneNull: await collection.countDocuments({ soDienThoai: { $type: "null" } }),
    phoneString: await collection.countDocuments({ soDienThoai: { $type: "string" } }),
    hcmQuan7: await collection.countDocuments({ "diaChi.thanhPho": "TP.HCM", "diaChi.quan": "Quan7" }),
    hcmQuan7Scholarship: await collection.countDocuments({ "diaChi.thanhPho": "TP.HCM", "diaChi.quan": "Quan7", hocBong: { $gte: 1000000 } }),
    indexes: await collection.getIndexes()
  };
  requireCondition(report.totalDocuments === totalDocuments, "Số document không đúng 100.000.");
  requireCondition(report.phoneMissing > 0 && report.phoneNull > 0 && report.phoneString > 0, "Thiếu nhóm số điện thoại.");
  requireCondition(report.phoneMissing + report.phoneNull + report.phoneString === totalDocuments, "Phân bố số điện thoại không hợp lệ.");
  requireCondition(report.hcmQuan7 >= 1000 && report.hcmQuan7Scholarship >= 100, "Không đạt ràng buộc TP.HCM/Quan7.");
  requireCondition(report.indexes.length === 1 && report.indexes[0].name === "_id_", "Còn chỉ mục ngoài _id_.");
  print("Kết quả kiểm tra dữ liệu:");
  printjson(report);
}

main().catch(function (error) {
  console.error(error);
  quit(1);
});
