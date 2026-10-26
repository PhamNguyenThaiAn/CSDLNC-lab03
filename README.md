# LAB 03 – Chỉ mục trong MongoDB

## Cấu trúc

```text
.
├── scripts/
│   ├── 01_seed.js
│   └── 02_read_benchmarks.js
├── ketqua/
│   └── .gitkeep
├── docker-compose.yml
├── .gitignore
└── README.md
```

## Chạy trên GitHub Codespaces

1. Đẩy mã nguồn lên GitHub theo hướng dẫn bên dưới.
2. Mở repo → **Code → Codespaces → Create codespace on main** (chọn nhánh thực tế nếu dùng tên khác). Tài khoản cần có quyền và hạn mức Codespaces.
3. Trong terminal Codespaces, chạy các lệnh dưới đây từ thư mục gốc repo. Môi trường cần có Docker Engine và Docker Compose v2; kiểm tra bằng `docker --version` và `docker compose version`.

```bash
# Dựng MongoDB và chờ healthcheck thành công.
docker compose up -d --wait

# Xóa collection hocvien cũ và sinh đúng 100.000 document.
docker compose exec -T mongo mongosh --quiet mongodb://localhost:27017/lab03_indexing --file scripts/01_seed.js

# Đo tuần tự 11 bài; nếu một bước kiểm tra thất bại, tiến trình trả mã lỗi 1.
docker compose exec -T mongo mongosh --quiet mongodb://localhost:27017/lab03_indexing --file scripts/02_read_benchmarks.js

# Xem các file kết quả trong repo trên máy chủ Codespaces.
ls -lh ketqua
cat ketqua/read_summary.json

# Dừng container; giữ dữ liệu trong named volume để dùng lại.
docker compose down
```

Chạy các lệnh tương tự trên máy đã có Docker Desktop đang hoạt động. `exec` sử dụng mongosh có sẵn trong image `mongo:8.0`. Scripts và kết quả được bind mount; file sinh trong `/workspace/ketqua` sẽ xuất hiện ở `ketqua/` của repo. Không cần mở hoặc forward cổng MongoDB trong Codespaces. Cổng trên host chỉ bind `127.0.0.1`; cấu hình này dành cho lab cục bộ, chưa bật xác thực.

Nếu cần kiểm tra dịch vụ:

```bash
docker compose ps
docker compose logs --tail=100 mongo
docker compose exec -T mongo mongosh --quiet --eval 'db.adminCommand({ ping: 1 })'
```

Nếu có sẵn MongoDB/mongosh, bỏ qua Docker và chạy **từ thư mục gốc repo** để đường dẫn xuất kết quả đúng:

```bash
mongosh 'mongodb://localhost:27017/lab03_indexing' --file scripts/01_seed.js
mongosh 'mongodb://localhost:27017/lab03_indexing' --file scripts/02_read_benchmarks.js
```

## Git Bash: tạo repo, commit và push

Tạo repository trống trên GitHub (không chọn tạo README, license hay `.gitignore`). Thay `YOUR_USERNAME` và `YOUR_REPOSITORY` bằng thông tin thật; không đưa token vào URL hoặc mã nguồn. Các lệnh sau chạy trong Git Bash trên Windows:

```bash
cd '/c/Users/LENOVO/OneDrive - Hochiminh City University of Education/Desktop/lab03'
git init
git branch -M main
git add scripts ketqua/.gitkeep docker-compose.yml .gitignore README.md
git status
git commit -m "Add deterministic MongoDB seed and read benchmarks"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

Nếu Git yêu cầu danh tính, cấu hình trong repo rồi chạy lại lệnh commit và push:

```bash
git config user.name 'YOUR_NAME'
git config user.email 'YOUR_GITHUB_EMAIL'
```

Nếu repo đã có remote `origin`, kiểm tra `git remote -v` và dùng remote hiện có nếu đúng. Đăng nhập qua cơ chế xác thực GitHub của Git khi được yêu cầu. Đừng dùng mật khẩu tài khoản làm mật khẩu Git HTTPS.

Người B có thể chạy:

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY
docker compose up -d --wait
docker compose exec -T mongo mongosh --quiet mongodb://localhost:27017/lab03_indexing --file scripts/01_seed.js
docker compose exec -T mongo mongosh --quiet mongodb://localhost:27017/lab03_indexing --file scripts/02_read_benchmarks.js
```

Sau này cập nhật repo hiện có bằng `git pull --ff-only` trước khi chạy. File kết quả bị bỏ qua để tránh trộn số đo từ nhiều máy. Nếu nhóm muốn lưu một lần thực nghiệm vào Git, thêm đích danh file cần lưu:

```bash
git add -f ketqua/read_summary.json ketqua/read_summary.csv
git commit -m "Record read benchmark results"
git push
```

## Dữ liệu và kiểm tra

- CSDL cố định `lab03_indexing`, collection `hocvien`. Seed sẽ **xóa toàn bộ collection này**, bao gồm các index cũ, rồi tạo lại với duy nhất `_id_`.
- Mulberry32 seed `20260303`; tên, địa chỉ, học bổng và ngày đều không phụ thuộc thời gian hay múi giờ máy chạy. `_id` là số thứ tự cố định, tránh ObjectId ngẫu nhiên làm bộ dữ liệu khác nhau.
- `maHV`: `HV000001`–`HV100000`; email: `hv000001@example.test`–`hv100000@example.test`. Giá trị không trùng do cách sinh, không tạo unique index để giữ đúng cấu hình thí nghiệm.
- Có 5 thành phố, mỗi thành phố nhiều quận; 2.000 document đầu luôn ở TP.HCM/Quan7 và ít nhất 500 document đầu có học bổng từ 1.000.000 đồng.
- Số điện thoại có đúng 33.333 document thiếu trường, 33.334 document null và 33.333 chuỗi duy nhất. Dùng `$type: "null"` để đếm riêng null; phép lọc `{soDienThoai: null}` còn khớp cả document thiếu trường.
- Nạp 20 lô, mỗi lô 5.000 document; `ngayDangKy` là BSON Date trong khoảng UTC từ 2022 đến trước 2026.
- Script benchmark xóa index phụ giữa các cấu hình. Kết thúc thành công sẽ giữ `_id_` và `idx_C3_thanhPho_quan_hocBong`. Chạy lại benchmark được mà không phải seed lại nếu dữ liệu vẫn nguyên vẹn.

Không chạy Người B hoặc tác vụ ghi dữ liệu song song với seed/benchmark trên cùng collection: chúng thay đổi index và làm mất tính so sánh của phép đo.

## Nội dung 11 bài đo

1. `2_2_1_Q1_C0`: Q1 với `_id_`; sau đó tạo `idx_email`, in `getIndexes()`, xóa theo tên, kiểm tra và tạo lại.
2. `2_2_1_Q1_idx_email`: Q1 với index email vừa tạo lại.
3. `2_2_2_Q2_C0`: Q2 với `_id_`.
4. `2_2_2_Q2_C1`: Q2 với index thành phố.
5. `2_2_2_Q2_C2`: Q2 với index thành phố + quận.
6. `2_2_2_Q2_C3`: Q2 với index thành phố + quận + học bổng giảm dần.
7. `2_3_3_Q3_C3`: Q3 với C3 hiện có.
8. `2_3_3_Q3_idx_quan`: Q3 với index đơn quận.
9. `2_3_4_Q2_C3`: Q2 đầy đủ document với C3 tạo lại.
10. `2_3_4_Q4_C3`: cùng điều kiện/sắp xếp, chỉ chiếu thành phố + quận + học bổng, bỏ `_id`.
11. `2_3_4_Q4_hoTen_C3`: thêm `hoTen` vào phép chiếu.

Mọi truy vấn đều trả hết kết quả, không dùng `limit`. Không dùng `hint`: kế hoạch ghi nhận là kế hoạch thực sự được bộ tối ưu chọn. Với Q3 không lọc trường đầu của C3, bộ tối ưu có thể chọn COLLSCAN hoặc một kiểu quét index; không được viết trước kết luận rằng nó chắc chắn chọn IXSCAN.

## File kết quả và cách đọc

- `<testName>_explain.json`: explain gốc của một lần chạy có thời gian đúng bằng trung vị. Dùng Extended JSON để giữ kiểu BSON.
- `<testName>_runs.json`: cả 5 explain chính thức theo thứ tự chạy; không chứa lần làm nóng.
- `read_summary.json` và `read_summary.csv`: toàn bộ bài đo, cập nhật sau từng bài. CSV UTF-8 có BOM, dấu phân cách phẩy và escape dấu nháy để mở bằng Excel; có thể chọn Import CSV nếu Excel địa phương dùng dấu chấm phẩy.
- `read_metadata.json`: số lần warm-up/đo, số kết quả cơ sở và thời điểm bắt đầu.
- `covered_count_check.json`: kiểm tra số kết quả trước và sau khi tạo C3 cho bài 2.3.4. Mọi `nReturned` của 11 bài còn được đối chiếu với số cơ sở.

Mỗi bài chạy 1 warm-up `explain("executionStats")`, tiếp theo 5 lần chính thức. Trung vị là phần tử thứ ba sau khi sắp xếp 5 thời gian. `nReturned`, keys/docs examined, stages và tên index trong summary lấy từ cùng lần đại diện có thời gian trung vị; các thời gian gốc nằm trong `executionTimeMillisSamples`. Chuỗi stage duyệt từ gốc xuống các nhánh của winning plan; đó là cách trình bày cây kế hoạch, không phải thứ tự thực thi theo thời gian. Có xử lý `winningPlan.queryPlan` của SBE.

Với Q4 có kết quả, `totalDocsExamined == 0` và sử dụng index là bằng chứng covered. Script báo lỗi nếu Q4 chưa covered hoặc Q4_hoTen không đọc document; tất cả file đo đã chạy vẫn được giữ để xem xét. Thường Q2 cần FETCH do trả toàn bộ document; Q4_hoTen cần đọc document vì C3 không chứa `hoTen`. Kế hoạch cụ thể phải lấy từ file explain.

`executionTimeMillis` có độ phân giải mili giây nên 0 ms hoặc bằng nhau giữa các cấu hình là hợp lệ. Đây là phép đo explain theo yêu cầu lab, gồm xử lý kế hoạch/thực thi phía server, không đo thời gian truyền và render toàn bộ kết quả trên client. Explain không dùng lại cached plan; warm-up chủ yếu làm nóng dữ liệu/index trong bộ nhớ. Khi báo cáo nên đối chiếu thời gian với `totalDocsExamined`, `totalKeysExamined`, SORT, FETCH và covered thay vì chỉ so một giá trị ms.

Thời gian không tất định dù dữ liệu tất định: CPU, RAM, tải máy và phiên bản server ảnh hưởng kết quả. Tag `mongo:8.0` có thể cập nhật bản vá; summary ghi phiên bản server thực chạy. Khi cần tái lập nghiêm ngặt, cả nhóm thống nhất image digest và cấu hình tài nguyên, đồng thời lưu raw explain.

## Tài liệu tham khảo

- [MongoDB: dùng module fs trong mongosh](https://www.mongodb.com/docs/mongodb-shell/write-scripts/require-external-modules/).
- [MongoDB: diễn giải kế hoạch truy vấn](https://www.mongodb.com/docs/manual/tutorial/analyze-query-plan/).
- [MongoDB 8.0: các trường trong explain](https://www.mongodb.com/docs/v8.0/reference/explain-results/).
- [MongoDB: explain bỏ qua plan cache](https://www.mongodb.com/docs/manual/reference/command/explain/).
- [Docker: docker compose up và tùy chọn --wait](https://docs.docker.com/reference/cli/docker/compose/up/).
- [GitHub: môi trường Codespaces trên trình duyệt](https://docs.github.com/en/codespaces/about-codespaces/what-are-codespaces).

## Trạng thái xác minh

Mã nguồn được kiểm tra cú pháp JavaScript và kiểm tra sinh dữ liệu bằng Node.js với collection giả lập. Hai lần seed có cùng SHA-256; mỗi lần có 100.000 document, 5.922 học viên TP.HCM/Quan7 và 3.925 người trong nhóm này có học bổng từ 1 triệu đồng. Luồng benchmark được kiểm tra giả lập đủ 11 bài, 66 lệnh explain (11 lần làm nóng + 55 lần chính thức), cách chọn trung vị, trích xuất cây SBE và 26 file xuất. File giả lập không được lưu vào ketqua.

Máy soạn thảo chưa có MongoDB/mongosh/Docker nên chưa chạy thực nghiệm server và chưa có số đo hiệu năng thật. Kiểm tra giả lập không xác nhận kế hoạch thực tế do MongoDB chọn. Chỉ dùng các kết quả do mongosh sinh sau khi chạy các lệnh phía trên để đưa vào báo cáo.
