# Bên trong an toàn: cổng phê duyệt và lỗi

Dành cho người đóng góp mã. Phần operator dùng nằm ở [An toàn](../an-toan.md).

## Cổng phê duyệt

Cổng nằm sau khâu chuẩn bị đầu vào và ngay trước khâu thực thi (`engine/loop/turn.ts`), nên một lời
gọi bị chặn không bao giờ tới được bộ thực thi.

- **Chế độ.** `ApprovalMode` là `'manual' | 'bypass' | 'unavailable'` (`core/tool.ts`). Mỗi phiên chạy
  mang một chế độ. `createApprovalGate` cho phép ngay khi gặp `bypass`, trước khi hỏi
  `requiresApproval`, nên công cụ không thể tự biến mình thành không-thể-bypass ở đó. Công cụ có tác
  dụng không hoàn tác được ngoài tiến trình sẽ tự đọc `approvalMode` từ ngữ cảnh và từ chối:
  `order_place` ném `order.approval_bypassed` trừ khi `[trading.orders] allow_unattended` được bật
  (`trading/features/order/execute.ts`).
- **Nguy hiểm.** Một lời gọi nguy hiểm khi `capability` của công cụ là `write` hoặc `shell`, khi có
  `isExternal` (server MCP, plugin không đáng tin), hoặc khi `requiresApproval(input, context)` trả về
  đúng.
  - `requiresApproval` nhận đầu vào đã chuẩn hóa và hợp lệ theo schema, nên một công cụ chỉ đọc như
    `schedule` hay `memory_store` có thể chỉ chặn các thao tác ghi.
  - `CallApprovalContext`
    (`engine/hooks/approval-context.ts`) đếm số lần gọi công cụ đó trong phiên chạy và trả lời `hasSeen`
    dựa trên lời của chính người vận hành (đã bỏ phần `<pasted_content>` chuyển tiếp) và kết quả không
    lỗi của các công cụ `net`, không bao giờ dựa trên chữ mô hình tự viết.
  - `web_fetch` hỏi khi URL không nằm ở hai nguồn đó, khi có header thêm, và khi vượt
    `[loop] max_unasked_fetches`.
- **Ghi nhớ.** `oneTimeApproval: true` trên công cụ thì không đưa ra lựa chọn ghi nhớ. `order_place`
  đặt cờ này cùng với `requiresApproval: () => true`.
- **Quyết định.** `decisionsFor(scope, oneTime)` là bản đồ duy nhất từ phạm vi sang các lựa chọn được
  đưa ra. Phạm vi `scheduler` và `delegated`, cùng mọi lời gọi `oneTime`, nhận `['deny', 'once']`;
  `session` và `mcp` nhận cả ba. Mọi bề mặt phê duyệt (CLI, kênh, form MCP, server WS) đều gọi nó, nên
  không bề mặt nào hiện nút mà cổng từ chối.
- **Khóa.** `approvalKeyFor(call)` là `<tool>:<sha256 của [lệnh, ...đối số] chưa lọc>` với công cụ
  `shell` (không lưu bí mật dạng rõ, và `["a b"]` khác `["a", "b"]`), `<tool>:<sha256 của đầu vào
  chuẩn tắc>` với công cụ bên ngoài, và là tên công cụ với phần còn lại.
  Bộ quản lý theo phiên chỉ giữ khóa trong bộ nhớ tiến trình.
- **Gộp trùng.** Các lời gọi giống hệt đang chờ trong một phiên chạy dùng chung một ô hỏi, khóa là
  `<runId>:<tool>:<JSON đầu vào>`.
- **Ủy quyền.** `createDelegatedApproval(parentRunId)` dựng phê duyệt cho agent con: chỉ một lần, không
  bao giờ có bypass hay khóa đã nhớ của agent cha. Agent con không đầu cuối nhận
  `approvalMode: 'unavailable'` (`tools/delegation/child-run.ts`).
- **Hết giờ.** Khoảng chờ chạy dưới `[loop].approval_timeout_ms` (120 giây) hoặc
  `[schedule].approval_timeout_ms` (900 giây) với việc có đích, và tạm dừng hạn chót thời lượng của
  phiên chạy.
- **Chi tiết ô hỏi.** `shell_exec` từ chối lời gọi mà lệnh và đối số vượt phần chi tiết 400 ký tự của ô
  hỏi, và đặt trong dấu nháy các đối số có khoảng trắng hay dấu nháy. Bản xem trước tham số được lọc
  thông tin đăng nhập và chặn ở 2.000 ký tự.

## Lỗi

Nguồn chuẩn: [`src/core/errors.ts`](../../src/core/errors.ts). Lỗi đi qua ranh giới runtime là các lớp
con có kiểu của `Error`, với mã ổn định. Các bề mặt bản địa hóa và dựng hiển thị chúng; các module
nghiệp vụ không tự in lỗi.

### Cây phân cấp

```text
Error
`-- AppError
    |-- RunHalted
    |-- LLMError
    |-- ToolError
    |-- ConfigError
    |-- StorageError
    |-- ChannelError
    |-- ValidationError
    |-- ConflictError
    `-- OrderError

ToolError
|-- HttpRequestError        (thêm status, retryAfter)
|-- SearchRetryableError    (thêm retryAfterMs, failureCode)
`-- SearchProviderError     (thêm costUsd, retryAfterMs, failureCode)

ConfigError
`-- OperatorConfigError     (thêm OperatorMessage có khóa, đã bản địa hóa)
```

`AppError` lưu một `cause` tùy chọn, đặt `name` là tên lớp cụ thể và buộc lớp con phải có `code`. Các
lớp con của `ToolError` vẫn mang một `ToolErrorCode` như mọi lỗi khác, và chỉ thêm đúng những gì người
gọi cần để quyết định thử lại: mã HTTP, khoảng chờ, và nhà cung cấp đã tính bao nhiêu tiền cho lần thử
hỏng.

| Lớp | Kiểu mã | Mục đích |
|---|---|---|
| `RunHalted` | `HaltCode` | Trạng thái kết thúc phiên chạy đã lường trước; có thể kèm `detail` |
| `LLMError` | `LLMErrorCode` | Lần thử nhà cung cấp/mô hình hỏng, kèm siêu dữ liệu lượng dùng và dự phòng |
| `ToolError` | `ToolErrorCode` | Hỏng ở khâu tra công cụ, phân quyền, kiểm tra, thực thi hoặc an toàn |
| `ConfigError` | `'config'` | Hỏng ở khâu phân tích, kiểm tra hoặc phân giải; mang `path` có cấu trúc |
| `StorageError` | `'storage'` | Hỏng ở ranh giới lưu trữ |
| `ChannelError` | `ChannelErrorCode` | Hỏng ở khâu khởi tạo, polling, gửi hoặc sửa tin của kênh |
| `ValidationError` | `'validation'` | Đầu vào của người gọi không hợp lệ, ngoài các lĩnh vực hẹp hơn |
| `ConflictError` | `'conflict'` | Một compare-and-set bị thua, hoặc một định danh yêu cầu bị phát lại với nội dung khác |
| `OrderError` | `OrderErrorCode` | Hỏng ở khâu xác thực sàn, gửi lệnh, khớp lệnh hoặc phản chiếu vào sổ trên đường đặt lệnh |

`ConflictError` khác `ValidationError` vì yêu cầu vốn **đúng định dạng** - người gọi bị đua hoặc phát
lại - và hai cái ánh xạ sang hai mã trạng thái khác nhau ở ranh giới giao thức. CLI in thông báo của
nó ngay cả khi không có `--verbose`, vì thông báo đó mang số phiên bản mà operator cần để thử lại.

Lỗi thiết lập mà operator sửa được thì ném `OperatorConfigError` với thông báo `errors.*` có khóa.

- `toInvalidConfigError(err, schema, section?)` diễn đạt một lỗi schema với mọi vấn đề trong một tham
  số danh sách (giới hạn số lượng, phần dư báo "và còn K chỗ nữa").
- Khóa lạ là một mục riêng cho từng khóa, kèm tên gần nhất mà `schema` nhận ở chỗ đó (`closestName`,
  `core/utils/text`). Nó cho phép số lần sửa bằng một phần ba độ dài từ, nên từ ngắn không được gợi ý
  gì. Một mục cấp cao nhất không ai nhận được gợi ý mục gần nhất theo cách tương tự.
- `ConfigError` trần chỉ dùng nội bộ: bề mặt in một dòng chung đã bản địa hóa và giữ bản tiếng Anh cho
  `--verbose`. `ConfigError` cố tình chỉ có một mã; hãy dùng `path` để nêu trường bị từ chối.
- `StorageError` cũng chỉ có một mã và giữ nguyên nguyên nhân gốc.

### Lỗi đặt lệnh

`OrderError` được khai báo ở
[`trading/features/order/types.ts`](../../src/trading/features/order/types.ts), không phải `core`:
`core` không mang từ vựng tài chính, và `AppError` được export để mỗi lĩnh vực tự đặt tên cho lỗi của
mình. Mọi mã trong `OrderErrorCode` nằm ở một trong hai nhóm.

**Operator phải ra tay** (lệnh đã khớp mà sổ không biết, hoặc thiếu lớp bảo vệ): `order.unmirrorable`,
`order.unmirrorable_fee`, `order.fee_unreported`, `order.unpriced_fill`, `order.fill_timeout` (vẫn còn sống ở sàn),
`order.exit_failed` (vị thế mở, không có lệnh cắt lỗ).

`order.fee_unreported` chỉ xảy ra sau khi phần đọc biên nhận của Binance đã liệt kê lại các giao dịch một số lần
có giới hạn, có lùi nhịp (`rereadUntil`, `venues/transport.ts`, hủy được); khi đó mirror ghi log mức `warn`
(`order.fill_fee_unreported`) vì `/record sync` sẽ vào sổ lệnh đó sau. Mọi fill không vào sổ được khác vẫn là
`order.fill_unbookable` mức `error`.

**Sổ nguyên vẹn:** `order.auth`, `order.network`, `order.rate_limited`, `order.insufficient`,
`order.rejected`, `order.clock_skew`, `order.below_minimum`, `order.exit_below_minimum`, `order.exit_inverted`,
`order.exit_oversized`, `order.book_moved`, `order.book_unpriced`, `order.sell_unsettled`, `order.sell_guarded`,
`order.no_position`, `order.exit_conflict`, `order.approval_bypassed`, `order.buying_halted`,
`order.unfilled`, `order.exit_not_amendable`, `order.venue_unavailable`, `order.venue_ambiguous`,
`order.venue_unreachable`, `order.quote_not_live`.

`order.exit_unsupported` nằm ở cả hai: cùng một lần từ chối nghĩa là chưa có gì dịch chuyển khi
`/trade exit` ném ra, và nghĩa là một vị thế đang mở mà không có lệnh cắt lỗ khi nó ném ra lúc gắn
lệnh thoát vào một lệnh vào đã khớp.

Ghi chú:

- `order.sell_unsettled` và `order.sell_guarded` là hai nửa của một lệnh bán mà sổ không khớp được
  (khối lượng chưa giao; khối lượng một lệnh thoát đang treo đã đóng băng). Chúng từ chối riêng vì
  cách sửa khác nhau, và mỗi cái mang khối lượng bán được trong phần chi tiết.
- `order.venue_unavailable` và `order.venue_ambiguous` là các lần từ chối ở khâu định tuyến. Cả hai
  mang danh sách ứng viên trong phần chi tiết của lỗi. `translateToolError(locale, code, detail)`
  (`src/i18n/index.ts`) không nhận tham số theo sàn, nên câu trong danh mục không nêu tên sàn nào và
  tên sàn tới được operator qua phần chi tiết.
- `order.venue_unreachable` không phải chuyện định tuyến: sàn đã được nêu tên, và nó là sàn giao dịch
  bằng tay hoặc không có thông tin đăng nhập.

### Mã dừng phiên chạy

`HALT_SPEC` ánh xạ mỗi `HaltCode` sang mã thoát CLI, khóa thông báo, khóa gợi ý tùy chọn và emoji.

- `HALT_DETAIL_SPEC` mang văn bản riêng cho những chi tiết dừng cần nó: trần chi tiêu đứng sau một
  lần dừng ngân sách, và các mã của nhà cung cấp làm đổi việc người dùng phải làm tiếp (`auth`,
  `billing`, `not_found`, `rate`).
- `failureSpecOf(result)` chọn văn bản của chi tiết thay cho văn bản của mã dừng khi chi tiết có văn
  bản riêng; CLI diễn đạt một `LLMError` trơn theo cùng cách.
- Các mã `auth`, `billing`, `not_found` chỉ đọc như phán quyết của nhà cung cấp khi chính nhà cung cấp
  gửi nó. `classifyHttpError` đánh dấu lỗi (`answeredByProvider`), và `haltDetailOf` bỏ mã khỏi mọi
  `LLMError` khác (lỗi đăng nhập, nhà cung cấp không có trong danh mục). Lỗi đó giữ chẩn đoán riêng
  hoặc đọc là `llm_error` chung.
- Một lần dừng `budget` mang `BudgetHaltDetail` (`run_budget`, `daily_cap`, `monthly_cap`,
  `agent_daily_cap`, `ledger_unavailable`); một lần dừng `llm_error` mang `LLMErrorCode` của nhà cung
  cấp khi `haltDetailOf` cho phép.
- `RUN_FAILURE_SPEC` ánh xạ các lý do phiên chạy chưa hoàn tất ở mức rộng hơn (`aborted`, `budget`,
  `turn_limit`, `loop`, `timeout`, `error`) sang cùng các mục đó khi ngữ nghĩa khớp; mã dừng có kiểu
  được ưu tiên.

| Mã | Mã thoát | Ý nghĩa |
|---|---:|---|
| `abort` | 130 | Người gọi hủy |
| `budget` | 3 | Chạm một trần chi phí, hoặc không đọc được sổ chi phí |
| `rate` | 4 | Hết hạn mức tần suất: của nhà cung cấp hoặc của bộ giới hạn trong tiến trình |
| `llm_error` | 5 | Lỗi LLM cuối cùng |
| `turn_limit` | 6 | Chạm số lượt tối đa |
| `length_limit` | 7 | Không nén nổi ngữ cảnh trong các giới hạn |
| `content_filter` | 8 | Nhà cung cấp hoặc chính sách an toàn chặn nội dung |
| `queue_full` | 9 | Hàng đợi của cuộc trò chuyện từ chối việc mới |
| `no_agents` | 10 | Không có hồ sơ agent đủ điều kiện |
| `hook_failed` | 11 | Một hook bắt buộc đã hỏng |
| `session_busy` | 12 | Cuộc trò chuyện đã có một phiên chạy đang diễn ra |
| `loop` | 15 | Phát hiện hành vi công cụ/trợ lý lặp lại |
| `agent_paused` | 16 | Agent sở hữu phiên chạy đang tạm dừng |
| `shutdown` | 0 | Runtime dừng bình thường |

### Mã lỗi LLM

`LLM_ERROR_CODES` trong `core/llm.ts`:

```text
transient, rate, auth, timeout, not_found, context_overflow,
billing, empty_response, output_budget_exhausted, response_too_large, fatal
```

- `rate` là nhà cung cấp trả 429. Nó khác `transient` vì cửa sổ bị từ chối không mở lại trong một
  khoảng chờ thử lại: cùng một mục không bao giờ bị hỏi lại, chuỗi rơi xuống mục kế tiếp, và mục đó
  nghỉ theo đúng `Retry-After`.
- Lỗi xảy ra **sau** khi luồng đã mở không bao giờ mang mã HTTP. Mỗi nhà cung cấp báo nó bằng một
  khung SSE với từ vựng riêng (`error.code`, `error.type`, `event_type: error`). Mỗi transport dịch từ
  đó về đúng mã trạng thái mà lỗi ấy đáng lẽ mang; việc phân loại vẫn nằm ở `classifyHttpError`
  (`ai/adapters/errors.ts`). Từ không có trong danh sách được đọc là lỗi phía server, và chuỗi sẽ
  chuyển dự phòng. Một khung không được định tuyến sẽ kết thúc luồng bằng một câu trả lời rỗng trơ
  trụi.
- `output_budget_exhausted` là lần thử dừng ở trần đầu ra mà không có gì để trình ra (`finish=length`,
  không văn bản, không lời gọi công cụ). Nó khác `empty_response` vì lời gọi y hệt sẽ tiêu ngân sách y
  hệt: không bao giờ thử lại trên cùng một mục, chỉ một mục khác mới giúp được.

`LLMError` có thể mang nhà cung cấp/mô hình, mã lần thử, lượng dùng và nguồn của nó, các lần thử trước,
khoảng chờ thử lại, quyền dự phòng và độ trễ. Lượng dùng và lịch sử lần thử được gắn vào qua
`attachAttemptUsage` và `attachProviderAttempts`, để phần việc đã trả tiền vẫn kiểm toán được dù một
lần thử đã hỏng.

### Mã lỗi công cụ

```text
unknown_tool, unauthorized, invalid_input, depth_limit,
delegate_full, budget_exhausted, approval_timeout, approval_denied,
approval_unavailable, unexpected,
path_escape, binary_content, host_blocked, dns_failure, payload_too_large,
schedule_blocked, file_not_found, credential_leak, timeout,
repeated_call, server_unavailable, superseded
```

Công cụ trả về các lỗi đã lường trước dưới dạng `ToolResult.isError` ở nơi phù hợp. Một `ToolError`
được ném ra là lỗi ở ranh giới mà engine phải phân loại.

### Mã lỗi kênh

| Mã | Ý nghĩa |
|---|---|
| `not_initialized` | Bộ nối bị dùng trước khi khởi tạo thành công |
| `get_updates_failed` | Khâu polling hoặc lấy tin đến bị hỏng |
| `send_failed` | Gửi ra ngoài bị hỏng |
| `edit_failed` | Sửa một tin đã gửi bị hỏng |

`ChannelError.retryAfterMs` mang gợi ý khoảng chờ do server cung cấp. Chính sách thử lại thuộc về
người gọi.

### Các hàm hỗ trợ

- `abortError(signal)` giữ nguyên lý do hủy dạng `Error`, hoặc trả `RunHalted('abort', 'aborted')`.
- `assertNotAborted(signal)` ném giá trị đó khi tín hiệu đã bị hủy.
- `isAbortError(err)` thu hẹp về `AbortError` của DOM mà một signal nêu ra - khác với
  `RunHalted('abort')` của lĩnh vực nghiệp vụ.
- `isErrno(error, code)` thu hẹp lỗi không rõ kiểu về hình dạng errno của Node.
- `attachAttemptUsage(error, input)` / `attemptUsageOf(error)` gắn và lấy lại lượng dùng trên một lần
  thử LLM đã hỏng.
- `attachProviderAttempts(err, attempts)` ghi lại các lần thử trước đó đứng sau một lỗi chuỗi cuối
  cùng.
- `markInterruptedVisibleOutput(err)` đánh dấu một `LLMError` đã hỏng sau khi phát ra đầu ra nhìn thấy
  được, để không có lần phát lại nào theo sau.
- `operatorMessageOf(err)` tìm thông báo dành cho operator qua các `cause` mà lớp bọc thêm vào (tối đa
  4 tầng).
- `isCallerFault(err)` đúng với `ValidationError`, `ConfigError`, `ConflictError`: yêu cầu của chính
  operator bị từ chối, nên khuyên thử lại là vô ích.

### Quy tắc ở ranh giới

- Chỉ ném các lớp con có kiểu trong cây phân cấp.
- Giữ nguyên lỗi gốc qua `cause`.
- Không để lộ thông tin đăng nhập, thân phản hồi thô của nhà cung cấp, đường dẫn hay stack trace tới
  người dùng kênh.
- Không hiện thực lại mã thoát hay câu chữ dừng ở một bề mặt; hãy dùng `HALT_SPEC` và i18n.
- Lỗi ở khâu dọn dẹp không được che lỗi gốc.

## Bản đồ mã nguồn

- Phân loại nguy hiểm: [`engine/hooks/dangerous.ts`](../../src/engine/hooks/dangerous.ts) - cổng: [`engine/hooks/approval.ts`](../../src/engine/hooks/approval.ts) - khóa và gộp trùng: [`engine/hooks/approval-manager.ts`](../../src/engine/hooks/approval-manager.ts)
- Hợp đồng công cụ (`requiresApproval`, `oneTimeApproval`, `ApprovalMode`): [`core/tool.ts`](../../src/core/tool.ts)
- Thứ tự thực thi: [`engine/loop/turn.ts`](../../src/engine/loop/turn.ts)
- Các ô hỏi: [`cli/commands/chat/approval.ts`](../../src/cli/commands/chat/approval.ts) - [`cli/commands/mcp/approval.ts`](../../src/cli/commands/mcp/approval.ts) - [`channels/delivery/callbacks.ts`](../../src/channels/delivery/callbacks.ts)
- Thông tin đăng nhập: [`core/security/credentials.ts`](../../src/core/security/credentials.ts)
- Đường dẫn và quyền: [`core/security/path-policy.ts`](../../src/core/security/path-policy.ts) - [`core/security/private-files.ts`](../../src/core/security/private-files.ts)
- Chính sách đầu ra: [`core/security/output-pipeline.ts`](../../src/core/security/output-pipeline.ts)
- Mạng: [`core/ssrf/network-policy.ts`](../../src/core/ssrf/network-policy.ts) - shell: [`tools/shell/policy.ts`](../../src/tools/shell/policy.ts)
- Mức tin cậy plugin: [`plugins/policy/trust.ts`](../../src/plugins/policy/trust.ts) - xét duyệt kênh: [`channels/delivery/gate.ts`](../../src/channels/delivery/gate.ts)
- Lỗi: [`core/errors.ts`](../../src/core/errors.ts) - [`core/config/operator-errors.ts`](../../src/core/config/operator-errors.ts) - [`trading/features/order/types.ts`](../../src/trading/features/order/types.ts)
