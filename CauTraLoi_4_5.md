# Nội dung đề xuất ghép vào BaoCao.pdf

Các kết quả định lượng phải điền từ lần chạy MongoDB của nhóm. Các con số đếm
trong Câu 4 dưới đây là kết quả kỳ vọng trên bộ mẫu cố định, cần đối chiếu nhật ký
`unique_sparse_results.json` có `completed=true` trước khi mô tả là đã thực nghiệm.

## Câu 4

**Đề:** Unique, sparse và unique kết hợp sparse giải quyết các yêu cầu khác nhau
như thế nào? Vì sao không nên ép sparse index cho truy vấn cần toàn bộ document?

Unique giải quyết yêu cầu toàn vẹn dữ liệu: các document khác nhau không được
có cùng khóa đã lập chỉ mục. Ví dụ, unique index trên email ngăn hai học viên
dùng cùng email, dù `_id` khác nhau. MongoDB kiểm tra khi xây dựng index trên dữ
liệu hiện hữu, khi INSERT và khi UPDATE làm thay đổi email. Nếu dữ liệu đã có
trùng lặp, xây index thất bại; nếu một INSERT hoặc UPDATE vi phạm, lệnh bị từ
chối với mã duplicate key 11000. Trong phép thử, sau khi sửa email trùng mới
tạo được unique index; thêm email mới được chấp nhận, còn thêm email trùng và
đổi email của một hồ sơ thành email của hồ sơ khác đều phải bị từ chối. Nhật ký
cần cho thấy số lượng và nội dung collection giữ nguyên sau từng lệnh bị từ chối.

Unique không đồng nghĩa trường bắt buộc tồn tại hay bắt buộc là chuỗi hợp lệ.
Với unique index đơn không sparse, document thiếu trường và document có giá trị
null đều tạo khóa null; vì vậy chỉ có tối đa một document thuộc nhóm khóa này.
Nếu nghiệp vụ bắt buộc có email, cần thêm kiểm tra đầu vào/schema validation.
Trong hocvien của bài này, seed đã tạo email có giá trị và khác nhau cho mọi hồ sơ.

Sparse giải quyết yêu cầu chỉ lập chỉ mục cho document có trường được chỉ mục.
Với single-field sparse index trên soDienThoai, document thiếu hẳn trường không
được đưa vào index. Document có trường soDienThoai:null vẫn được đưa vào index.
Sparse không tự tạo ràng buộc duy nhất: sparse không unique cho phép nhiều số
trùng và nhiều null. Trên sáu document mẫu, index chứa bốn document: hai null
và hai chuỗi; bỏ qua hai document missing. Bộ lọc $exists:true trả bốn document;
$exists:false trả hai missing; phép bằng null trả bốn document vì khớp cả null
lẫn missing. Đây là lý do không được dùng phép bằng null để đếm riêng nhóm null;
phải dùng $type:"null" khi cần phân biệt.

Unique kết hợp sparse giải quyết yêu cầu “không bắt buộc cung cấp trường, nhưng
giá trị đã cung cấp phải duy nhất”. Ràng buộc chỉ áp dụng với các document nằm
trong sparse index. Do missing bị bỏ qua, có thể có nhiều document thiếu số điện
thoại. Do null vẫn nằm trong index, chỉ cho phép tối đa một null. Bởi vậy, xây
unique+sparse trên bản sao sáu hồ sơ ban đầu phải thất bại do hai null. Sau khi
$unset trường của một hồ sơ null, collection vẫn có sáu document nhưng chỉ còn
một null; index được tạo thành công. Thêm missing tiếp theo được phép, thêm null
thứ hai hoặc chuỗi điện thoại đã có phải bị E11000. Không nên diễn đạt sai rằng
unique+sparse cho phép tùy ý nhiều null. Nếu nghiệp vụ coi null cũng là “chưa
cung cấp”, có thể chuẩn hóa thành missing hoặc xem xét unique partial index chỉ
áp dụng cho chuỗi; đó là thiết kế khác, không phải hành vi của unique+sparse.

Không nên ép sparse index cho truy vấn cần toàn bộ document vì tính đầy đủ của
kết quả phụ thuộc đường truy cập. find({}) bình thường trên mẫu phải trả sáu
document. find({}).hint("idx_sdt_sparse") chỉ duyệt những entry có trong index,
nên trả bốn và làm mất hai hồ sơ missing, dù chúng thỏa bộ lọc rỗng. Hai null vẫn
được trả về. Tương tự, truy vấn bằng null cần cả missing và null; ép sparse có
thể làm mất nhóm missing. MongoDB thông thường tránh chọn sparse index nếu nó
làm kết quả không đầy đủ, nhưng hint ép chỉ mục có thể vượt qua lựa chọn đó.
Do đó, tối ưu tốc độ chỉ có ý nghĩa khi vẫn giữ đúng tập kết quả. Dùng hint để
minh họa rủi ro trong lab là hợp lý; không dùng nó cho truy vấn cần đủ toàn bộ
document. Với mẫu chỉ sáu hồ sơ, COLLSCAN của truy vấn tự chọn cũng không phải
bằng chứng lỗi: chi phí quét một collection rất nhỏ có thể thấp hơn dùng index.

Minh chứng đưa vào báo cáo: lỗi build unique/unique+sparse, trạng thái trước/sau
INSERT và UPDATE, danh sách _id của năm phép đọc sparse, cùng explain gốc.

Nguồn: [Unique Indexes](https://www.mongodb.com/docs/v8.0/core/index-unique/)
và [Sparse Indexes](https://www.mongodb.com/docs/v8.0/core/index-sparse/).

## Câu 5

**Đề:** Đề xuất bộ chỉ mục cuối cùng cho hệ thống ưu tiên Q1 và Q2, ít chạy Q3.
Nêu chỉ mục giữ lại, chỉ mục loại bỏ và đánh đổi giữa tốc độ đọc, ghi, dung lượng.

Đề xuất giữ ba index tổng cộng trên hocvien: `_id_` mặc định, unique index
`{email:1}`, và C3 `{"diaChi.thanhPho":1,"diaChi.quan":1,hocBong:-1}`.
Đề xuất này dựa trên workload đã nêu; số đo thật dùng để kiểm tra mức lợi ích,
không được khẳng định C3 hoặc index email luôn nhanh hơn trong mọi lần chạy.

Giữ `_id_` để định danh duy nhất và hỗ trợ tra cứu/cập nhật theo _id. Giữ unique
email vì Q1 tìm theo phép bằng trên email: MongoDB có thể tìm khóa phù hợp rồi
đọc document thay vì quét toàn bộ 100.000 hồ sơ. Unique đồng thời thực thi yêu
cầu không trùng email; vì dữ liệu seed không có email trùng, có thể xây được.
Index email thường của phần A phải được thay bằng unique email, không giữ cả
hai bản sao thừa cho cùng mục đích. Việc chuyển đổi cần kiểm tra dữ liệu trước;
script 04 chỉ minh họa trên ghi_B, không tự áp cấu hình đề xuất lên hocvien.

Giữ C3 vì Q2 lọc chính xác thành phố và quận rồi lọc/sắp xếp học bổng giảm dần.
Hai điều kiện bằng cố định tiền tố của index; phần hocBong phía sau hỗ trợ khoảng
giá trị và thứ tự mong muốn. Theo kế hoạch thực tế, C3 có thể giảm số khóa/document
phải xét và tránh bước SORT riêng. Q2 vẫn cần lấy toàn bộ document nên thường
có FETCH. Q4 chỉ trả các trường có trong C3 và loại _id, nhờ đó có thể covered,
thể hiện totalDocsExamined=0 khi có kết quả. Thêm hoTen vào projection buộc phải
đọc document vì C3 không chứa trường này. Không mở rộng C3 bằng hoTen chỉ để tối
ưu một biến thể minh họa khi workload ưu tiên vẫn là Q1 và Q2.

Loại C1 chỉ có thành phố và C2 gồm thành phố/quận nếu chúng không phục vụ nhu cầu
riêng nào khác: cả hai là tiền tố của C3 và không có unique/sparse khác biệt ở
bài này. Giữ cả C1, C2 và C3 thường làm tăng công bảo trì index mà không cần thiết
cho hai truy vấn ưu tiên. Index nhỏ hơn đôi khi vẫn có lợi cho một workload cụ
thể, vì vậy đây là quyết định dựa trên phạm vi bài và cần xem lại nếu workload đổi.

Không giữ index đơn quận trong cấu hình tối thiểu vì Q3 ít được gọi, còn Q1/Q2
không cần nó. C3 có trường đầu là thành phố nên Q3 chỉ lọc quận không tận dụng
được tiền tố để quét một khoảng hẹp như index đơn quận. Chấp nhận Q3 chậm hơn
để giảm chi phí ghi và dung lượng là đánh đổi phù hợp với tần suất đã cho. Nếu
Q3 có yêu cầu thời gian phản hồi nghiêm ngặt hoặc tần suất tăng, có thể cân nhắc
giữ/thêm lại idx_quan dựa trên số đo, không chỉ dựa vào việc “ít chạy”.

Không giữ sparse index SĐT chỉ vì nó xuất hiện trong bài 04: Q1/Q2/Q3 đều không
lọc SĐT. Chỉ thêm index này nếu hệ thống có truy vấn tra SĐT đủ thường xuyên.
Nếu còn yêu cầu SĐT phải duy nhất khi cung cấp, phải chọn rõ unique+sparse hay
unique partial và quy tắc null; sparse không unique của ghi_B không bảo vệ tính
duy nhất. Cấu hình ghi_B cố tình có thêm sparse để đo chi phí ba index phụ, vì
vậy chi phí ghi/dung lượng ghi_B không phải con số đo trực tiếp của cấu hình
cuối cùng chỉ có hai index phụ được đề xuất ở đây.

Đánh đổi về ghi: mỗi INSERT phải thêm entry vào _id_, email và C3, đồng thời
kiểm tra trùng email. UPDATE làm đổi hocBong phải sửa document và cập nhật khóa
C3. Trong bài 04, UPDATE chỉ đổi hocBong nên email và soDienThoai không đổi;
không nên viết rằng mọi UPDATE đều viết lại toàn bộ index. Index trên trường
không đổi có thể vẫn có chi phí kiểm tra xử lý, nhưng không nhất thiết sửa khóa.
Mọi index phụ cũng làm DELETE tốn công loại các entry tương ứng. Chi phí còn
phụ thuộc cache, I/O, journaling, phân bố giá trị và tải cạnh tranh.

Đánh đổi về dung lượng: index chiếm dung lượng lưu trữ và bộ nhớ cache, trong
khi index phủ có thể giảm đọc collection. Dùng indexSizes để xem riêng từng
index và totalIndexSize để so tổng số byte. Sparse bỏ qua missing nên có thể
ít entry hơn index SĐT đầy đủ, nhưng vẫn chứa null; kích thước không thể suy ra
chính xác chỉ từ tỷ lệ missing vì còn nén và cấp phát trang. Sau insert/delete,
file có thể giữ trang đã cấp phát dù số document đã trở về 100.000.

Chèn số đo thật của nhóm vào đoạn sau:

“Trên môi trường [CPU, RAM, MongoDB/mongosh, digest], Q1 thay đổi từ [plan,
docsExamined, median ms] sang [...]. Q2 C0/C1/C2/C3 lần lượt [...]; C3 [có/không]
có SORT riêng. Q4 C3 có [...] document đọc. Trong bài 04, ghi_A có năm mẫu
INSERT [...], trung vị [...] ms; UPDATE [...], trung vị [...] ms; tổng index
[...] byte. ghi_B tương ứng [...] với indexSizes [...]. Chênh lệch trung vị là
[...] ms và chênh lệch dung lượng [...] byte. B có thêm ba index phụ nên kết quả
minh họa chi phí của cả bộ đó; không gán toàn bộ chênh lệch cho riêng C3 hay sparse.”

Nếu thời gian thấp hoặc dao động làm A/B gần bằng nhau hay đảo thứ tự, nêu đúng
kết quả và giới hạn của năm mẫu; không chỉnh số liệu để khớp kỳ vọng. Bộ index
cuối cùng là sự cân bằng cho workload Q1/Q2, với mức chấp nhận chậm hơn của Q3
và chi phí lưu trữ/ghi đã được chứng minh bằng minh chứng thực nghiệm.

Nguồn: [Compound Indexes](https://www.mongodb.com/docs/v8.0/core/indexes/index-types/index-compound/),
[Index Sort Order](https://www.mongodb.com/docs/v8.0/core/indexes/index-types/index-compound/sort-order/)
và [Measure Index Use](https://www.mongodb.com/docs/v8.0/tutorial/measure-index-use/).
