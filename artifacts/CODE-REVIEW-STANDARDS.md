# Tiêu chuẩn & Quy trình Review Code — Switch-Router

> Tài liệu này **bổ sung** lớp review của con người lên trên lớp QA tự động hiện có
> (`docs/QA-WORKFLOW.md`). Nó không thay thế CI/gate — nó định nghĩa *con người* soi
> những gì máy không soi được: đúng ý định hay không, dễ bảo trì không, có rủi ro bảo
> mật/hiểu lầm không.

---

## 0. Mục đích & tinh thần

- **Review là mentor, không phải gatekeeper.** Mỗi comment nên dạy được một điều,
  không chỉ phán "sai".
- **Ưu tiên đúng việc.** Đừng bắt người ta đổi tên biến trong khi có lỗ hổng SQL
  injection. Dùng 3 mức độ (🔴 / 🟡 / 💭) để phân tách.
- **Nhanh và dự đoán được.** PR nhỏ → review nhanh → merge sớm. Quy trình phải rõ
  SLA và rõ ai duyệt.
- **Học từ mỗi review.** Pattern xấu lặp lại → đưa vào checklist hoặc lint rule,
  không lặp lại tay.

---

## 1. Phạm vi áp dụng

Áp dụng cho **mọi** thay đổi trong repo: `src/`, `open-sse/`, `scripts/`,
`custom-server.js`, config, và tài liệu kỹ thuật. Riêng bản dịch `i18n` thuần
(đã có quy ước bán phần) và file hình ảnh tĩnh có thể miễn review nếu chỉnh sửa
nhỏ không đổi logic.

---

## 2. Nguyên tắc cốt lõi

1. **PR nhỏ hơn 400 dòng thay đổi lý tưởng (< 800 là chấp nhận được).** PR lớn =
   review lướt qua = bug lọt. Refactor lớn phải tách thành nhiều PR: (a) tái cấu
   trúc không đổi behavior, (b) thay đổi behavior.
2. **Máy chạy trước, người chạy sau.** Reviewer chỉ bắt đầu khi CI xanh (lint +
   gate + drift + build). Đừng lãng phí công người để tìm lỗi mà máy bắt được.
3. **Comment phải actionable.** "Khó hiểu" là vô dụng. "Hàm này làm 3 việc, tách
   `validate()` ra vì X" là actionable.
4. **Phân biệt opinion vs bug.** Ý kiến cá nhân (💭) không được phủ quyết merge.
   Lỗi đúng/sai (🔴) thì bắt buộc.
5. **Author tự check trước khi gửi.** Đừng ném PR thô cho người khác dọn.

---

## 3. Tiêu chuẩn review (Rubric)

Mọi comment review phải mang một trong 3 nhãn:

| Nhãn | Ý nghĩa | Tác động đến merge |
|------|---------|--------------------|
| 🔴 **Blocker** | Sai đúng/sai, mất data, lỗ hổng bảo mật, break API | **Bắt buộc sửa** trước merge |
| 🟡 **Suggestion** | Nên sửa: thiếu validate, tên rối, perf, thiếu test | Nên sửa; author có thể dispute có lý do |
| 💭 **Nit** | Style/thói quen, naming nhỏ, tài liệu | Không chặn merge |

### 3.1 🔴 Blockers (phải sửa)

- **Bảo mật:** SQL injection, XSS, auth bypass, trust boundary sai. Đặc biệt chú ý
  `custom-server.js` (đã strip `X-Forwarded-For` — đừng đọc trực tiếp header đó ở
  nơi khác), và mọi chỗ nối chuỗi vào query/log.
- **Mất data / corruption:** ghi SQLite sai thứ tự adapter, xoá bảng, race condition
  trên file/DB.
- **Break API contract:** đổi shape response `/v1`, đổi tên/biến env, đổi hành vi
  default của provider mà không bump version/ghi chú.
- **Thiếu error handling ở path quan trọng:** server crash trên input ngoài dự kiến,
  không catch promise rejection ở route handler.
- **Vi phạm quy tắc provider drift:** xoá provider khỏi `open-sse/config/providers.js`
  mà **không** làm đủ 4 bước cùng 1 commit (xoá config → xoá/viết lại test →
  `vitest run -u` → thêm id vào `REMOVED_LIST`).
- **Bulk-regenerate baseline** (`known-fails.txt`) để "lấy màu xanh" — biến gate
  thành màu xanh giả. Bắt buộc revert.

### 3.2 🟡 Suggestions (nên sửa)

- **Thiếu input validation** ở API route và form.
- **Tên rối / logic khó hiểu:** hàm > 40 dòng làm nhiều việc, biến `data2`, `tmp`.
- **Thiếu test cho behavior quan trọng:** behavior mới không có test; bug fix không
  có regression test (vi phạm Definition of Done hiện tại).
- **Performance:** N+1 query, allocate không cần, re-render React không memo, gọi
  sync I/O trong hot path.
- **Trùng lặp code** nên extract (đặc biệt giữa `src/` và `open-sse/`).
- **Hardcode vi phạm design token:** dùng `#f97815` thay vì `bg-brand-500` /
  `var(--color-brand-500)` (đã có quy ước P0 ngày 2026-08-06). Landing page luôn
  dark với palette `#1a1a1a / #262626 / #333333`.
- **i18n:** chuỗi user-facing mới mà không tuân quy ước (EN inline, VI trong
  `public/i18n/literals/vi.json`); hardcode tiếng Anh vào UI cần dịch.
- **Dùng API Node không có trên Node 24** (engine pinned). Env CI chạy Node 24 —
  đừng dùng tính năng mới hơn.

### 3.3 💭 Nits (không chặn)

- Không nhất quán style (nếu chưa có lint rule cấm).
- Tên biến cải thiện được nhưng không sai.
- Thiếu comment/tài liệu nhỏ.
- Cách viết khác mà vẫn đúng.

---

## 4. Quy trình review (PR Lifecycle)

```
Author                   CI (tự động)              Reviewer
  |                          |                         |
  |-- tự check (§2.5) ------>|                         |
  |-- mở PR ---------------->|                         |
  |                          |-- lint+test+gate+drift+build
  |                          |       |                 |
  |                          |       X xanh? --> block, author sửa
  |                          |       | xanh            |
  |                          |<------v-----------------| gán reviewer
  |<-------------------------|<-------review round -----|
  |-- sửa theo comment ------>|                         |
  |                          |-- re-run CI ------------|
  |                          |<------round 2 (nếu cần)|
  |                                       | đủ approval
  |<---------------------------------------v merge (squash)
```

**Bước 0 — Author tự check (trước khi gửi):**
- [ ] `cd tests && npm run test:fast` không fail ngoài dự kiến
- [ ] `npm run gate` không regression
- [ ] `node scripts/qa-provider-drift.mjs` sạch
- [ ] Không obsolete snapshot mới
- [ ] Đã đọc lại diff của chính mình (tự review 5 phút)

**Bước 1 — Mở PR:** tiêu đề rõ (conventional commit style), mô tả *tại sao*, link
issue nếu có, gắn label (feature / fix / refactor / chore / security).

**Bước 2 — CI:** 4 job chạy (lint → test+gate → drift → build). PR bị block đến khi
xanh. Reviewer **không** review khi CI đỏ (trừ khi là flaky đã biết — xem triage).

**Bước 3 — Gán reviewer:** ít nhất **1** reviewer. **2** reviewer bắt buộc với:
thay đổi bảo mật, thay đổi core routing/proxy, xoá provider, thay đổi schema DB.

**Bước 4 — Review round:** reviewer dùng rubric §3. Mỗi comment gắn nhãn. Không
dùng "LGTM" một mình nếu PR > 100 dòng.

**Bước 5 — Sửa & re-review:** author sửa toàn bộ 🔴, giải quyết/xuất trình 🟡. Push
lại → CI re-run → reviewer xác nhận. Round tối đa **3**; sau đó escalate cho
maintainer.

**Bước 6 — Approval & Merge:** đủ approval + CI xanh → merge **squash** vào nhánh
chính (giữ lịch sử sạch). Xoá nhánh sau merge.

**Bước 7 — Theo dõi:** nếu merge gây regression bị gate bắt ở PR sau, author của PR
gốc chịu trách nhiệm fix (không đổ cho "máy").

### SLA (thời gian phản hồi)

| Loại PR | Reviewer phản hồi đầu | Hoàn thành review |
|---------|----------------------|-------------------|
| 🔒 Security / hotfix | 4h | 1 ngày |
| Feature / fix thường | 1 ngày | 2 ngày |
| Refactor / docs | 2 ngày | 3 ngày |

Nếu quá SLA, author nhắc (ping) một lần; vẫn quá thì escalate maintainer.

### Quy tắc tranh luận

- Disagreement là bình thường. Author có thể **dispute** một 🟡/💭 bằng lý do kỹ
  thuật hợp lý → ghi nhận vào PR, không chặn merge.
- Disagreement về 🔴 → maintainer quyết định (có thể yêu cầu fix hoặc ghi nhận rủi ro
  bằng comment + label `risk-accepted`).
- Cấm chốt bằng quyền lực ("tôi senior hơn"). Chốt bằng lý do + evidence (link test,
  doc, CVE).

---

## 5. Vai trò & trách nhiệm

**Author:**
- Tự check §2.5, viết PR rõ ràng, phản hồi comment nhanh, không "resolve" comment
  chưa xong.
- Khi dispute, đưa evidence, không im lặng bỏ qua.

**Reviewer:**
- Review trong SLA, dùng rubric, comment cụ thể + giải thích *tại sao*.
- Praise code tốt ("chỗ dùng memo ở đây hay đấy") — không chỉ bắt lỗi.
- Không approve PR mình chưa hiểu rõ behavior.

**Maintainer (người merge cuối):**
- Đảm bảo CI xanh + đủ approval + merge squash.
- Quyết định tranh luận 🔴 và ghi nhận rủi ro.

---

## 6. Tích hợp với CI / QA hiện có

Lớp người **không** lặp lại việc máy làm:

| Việc | Do ai | Ghi chú |
|------|-------|---------|
| Lint, test, gate, drift, build | CI | Đã có trong `qa.yml` |
| Bắt regression mới (pass→fail) | Gate | `known-fails.txt` |
| Đánh giá *đúng ý định*, dễ bảo trì, rủi ro bảo mật | **Người** | Rubric §3 |
| Quyết định merge | Maintainer | Sau CI xanh + approval |

**Quy tắc cứng:** PR có CI đỏ **không được approve**. Nếu nghi ngờ flaky, chạy lại
job (triage rules trong QA-WORKFLOW §6) thay vì approve tắt mắt.

---

## 7. Template (copy-paste khi áp dụng)

### 7.1 Pull Request Template — `.github/pull_request_template.md`

```markdown
## Tại sao (Why)
<!-- lý do / link issue -->

## Thay đổi chính (What)
-

## Loại
- [ ] feature  [ ] fix  [ ] refactor  [ ] security  [ ] chore/docs

## Tự check (Author)
- [ ] test:fast xanh
- [ ] gate không regression
- [ ] drift sạch
- [ ] test mới / regression test cho bug fix

## Rủi ro / note cho reviewer
-
```

### 7.2 Review Comment Template

```
🔴 **Security: <tên lỗi>**
File:line — <mô tả ngắn>

**Why:** <tại sao nguy hiểm>

**Suggestion:** <cách sửa cụ thể, có đoạn code/mệnh đề nếu được>
```

---

## 8. Trường hợp đặc biệt

- **Xoá / đổi provider (`open-sse`):** bắt buộc 4 bước §3.1 trong **cùng 1 commit**.
  Reviewer check kỹ drift script + snapshot.
- **Security fix:** PR riêng, label `security`, reviewer 2 người, merge sớm nhất,
  changelog ghi (không lộ chi tiết exploit nếu chưa patch xong ở bản phát hành).
- **Large refactor:** tách PR (structure-only không đổi behavior trước, rồi behavior
  sau). Không refactor + thêm feature cùng lúc.
- **Thay đổi schema / migration SQLite:** reviewer 2 người + test bench
  (`npm run test:bench`) phải xanh.

---

## 9. Definition of Done (mở rộng từ QA-WORKFLOW §8)

Thêm vào checklist hiện có:

- [ ] ✅ CI xanh (lint + gate + drift + build)
- [ ] ✅ Đã qua ít nhất 1 review (2 cho trường hợp §8)
- [ ] ✅ Mọi 🔴 được sửa hoặc ghi nhận `risk-accepted` bởi maintainer
- [ ] ✅ PR mô tả rõ *tại sao*
- [ ] ✅ Không hardcode vi phạm design token / i18n
- [ ] ✅ Behavior mới có test, bug fix có regression test

---

## 10. Lộ trình áp dụng (Rollout)

1. **Tuần 1:** Thống nhất tài liệu này, thêm PR template, thông báo SLA.
2. **Tuần 2–3:** Áp dụng thử với 50% PR, thu thập feedback (pattern lặp lại → đưa
   vào lint rule hoặc checklist).
3. **Tuần 4:** Bắt buộc 100%, review định kỳ hàng tháng (retro): quy trình có chạy
   thực tế không, SLA có giữ được không, rubric có thiếu mục gì.

---

*Tài liệu này là bản nháp để team thảo luận. Chưa được đưa vào `docs/` cho đến khi
team đồng thuận.*
