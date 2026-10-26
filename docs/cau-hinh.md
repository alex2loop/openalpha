# Cấu hình

Mọi khóa TOML, giá trị mặc định và biến môi trường. Một tệp, đọc đúng một lần lúc khởi động.

Hai điều cần biết trước:

- **Cấu hình chỉ được đọc một lần, lúc khởi động.** Đổi gì thì khởi động lại daemon. Không có nạp nóng,
  cũng không có trạng thái áp dụng nửa vời.
- **Khóa lạ là lỗi.** Gõ sai thì `config validate` báo ngay, thay vì để một thiết lập nằm ở mặc định
  suốt ba tháng mà không ai hay.

## Tệp nằm ở đâu

Mặc định là `~/.openalpha/config.toml`.

```bash
openalpha config path       # tệp nào đang thật sự được đọc
openalpha config validate   # có phân tích và phân giải được không
openalpha config show       # cấu hình hiệu lực đã trộn, thông tin bí mật đã che
openalpha config edit       # mở bằng $VISUAL hoặc $EDITOR
```

`openalpha onboard` ghi một tệp khởi đầu khi chưa có tệp và đích không phải symlink. Chạy khi đã có cấu
hình, nó đổi một phần (mô hình, bot Telegram, mức chi hoặc ngôn ngữ) và sao lưu tệp cũ cạnh đó trước (giữ 5 bản sao lưu mới nhất), vì lần
ghi lại làm mất các dòng chú thích.

Có hai tệp mẫu để tải: [config.minimal.toml](https://raw.githubusercontent.com/alex2loop/openalpha/main/config.minimal.toml)
chạy được ngay với mức chi 2 USD/ngày, chỉ cần `OPENROUTER_API_KEY` (bản trả lời bằng tiếng Anh là
[config.minimal.en.toml](https://raw.githubusercontent.com/alex2loop/openalpha/main/config.minimal.en.toml)); [config.sample.toml](https://raw.githubusercontent.com/alex2loop/openalpha/main/config.sample.toml)
liệt kê mọi khóa kèm giải thích.

## Thứ tự ưu tiên

Có ba câu hỏi riêng, xét theo đúng thứ tự này.

**1. Đọc tệp cấu hình nào?**

```text
--config <đường dẫn>  >  (--data-dir  >  OPENALPHA_DATA_DIR  >  ~/.openalpha) / config.toml
```

`--config` thắng ngay. Nếu không có, `--data-dir` rồi `OPENALPHA_DATA_DIR` chọn thư mục chứa
`config.toml`. `[paths].data_dir` không ảnh hưởng được bước này vì tệp còn chưa được đọc. Thiếu tệp
`--config` là lỗi nghiêm trọng, không bao giờ âm thầm rơi về mặc định. Không có `./config.toml` trong
thư mục hiện hành.

**2. Trạng thái nằm ở đâu?**

```text
--data-dir  >  OPENALPHA_DATA_DIR  >  [paths].data_dir trong config.toml  >  ~/.openalpha
```

`[paths].data_dir` dời được dữ liệu của bạn, chỉ không dời được chính tệp cấu hình chứa nó.
`agent.toml` không đặt được khóa này; agent thừa hưởng từ tiến trình.

Hai cách ghi đè khác nhau: `OPENALPHA_DATA_DIR` chuyển cả thư mục dữ liệu, gồm cả nơi tìm cấu hình
mặc định. `--config` chỉ dời tệp cấu hình.

**3. Trong cấu hình, cái gì thắng?**

```text
tệp cấu hình  >  giá trị mặc định có sẵn
```

Chỉ có vậy. `agent.toml` không phải lớp phủ: nó chọn được một chuỗi `[[model_tiers.<name>]]` và thu hẹp
những gì riêng agent đó được làm, nhưng không đụng được vào các mục toàn cục. Xem [Agent](tro-ly.md).

## Cấu hình tối thiểu

```toml
[[models]]
provider = "anthropic"
model    = "claude-sonnet-4-6"
api_key_env = "ANTHROPIC_API_KEY"
```

## Schema đầy đủ

### `[[models]]` (bắt buộc, ít nhất một)

Chuỗi mô hình. Mục đầu là mô hình chính, các mục sau là dự phòng.

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `provider` | chuỗi | - | Mã nhà cung cấp trong danh mục. Bắt buộc ở đây hoặc trong `[model_defaults]`. |
| `model` | chuỗi | - | Mã mô hình riêng của nhà cung cấp. Bắt buộc ở mọi mục. |
| `alias` | chuỗi không khoảng trắng | - | Bộ chọn ngắn cho `/model`. Phải duy nhất trong cả chuỗi. Không có thì bộ chọn là `<provider>:<model>`. |
| `api_key_env` | chuỗi | - | Tên biến môi trường chứa khóa. Chưa đặt hoặc để trống thì `start` báo và chạy tiếp không có mô hình này; các lệnh khác bỏ qua nó. Bắt buộc ở đây hoặc trong `[model_defaults]`, trừ nhà cung cấp đăng nhập bằng thuê bao, nhà cung cấp đăng nhập bằng tài khoản cloud, và server chạy trên chính máy này (`base_url` loopback, như Ollama hay LM Studio). |
| `base_url` | url | endpoint trong danh mục | Ghi đè endpoint. Bắt buộc với nhà cung cấp không có endpoint mặc định (như `vllm`). |
| `reasoning` | `default \| off \| low \| medium \| high` | `default` | `default` để nhà cung cấp tự quyết; `off` yêu cầu tắt suy luận; các mức còn lại đặt độ sâu. |
| `max_tokens` | số nguyên dương | giới hạn runtime | Trần đầu ra riêng cho mục này. |
| `provider_sort` | `price \| throughput \| latency` | mặc định của router | Chỉ cho router. Xếp thứ tự các endpoint phục vụ mô hình. Mỗi lời gọi vẫn được xếp chỗ lại từ đầu. |
| `provider_only` | chuỗi[] | - | Chỉ cho router. Các slug endpoint được phép phục vụ mô hình (OpenRouter `provider.only`). |
| `provider_order` | chuỗi[] | - | Chỉ cho router. Các slug endpoint cần thử, theo thứ tự (OpenRouter `provider.order`). |
| `provider_allow_fallbacks` | bool | mặc định của router | Chỉ cho router. `false` làm hỏng yêu cầu thay vì để nó rời khỏi `provider_only` / `provider_order`. |
| `ttft_timeout_ms` | số nguyên dương | mặc định của bộ nối | Chờ sự kiện luồng đầu tiên tối đa bao lâu trước khi chuyển dự phòng. Tối đa 2147483647 (khoảng 24 ngày). |
| `stream_idle_timeout_ms` | số nguyên dương | mặc định của bộ nối | Im lặng giữa hai sự kiện luồng tối đa bao lâu. Tối đa 2147483647 (khoảng 24 ngày). |
| `reasoning_required` | bool | `false` | Đặt khi endpoint từ chối yêu cầu tắt suy luận (OpenRouter trả 400). Router không suy ra được điều này từ tên mô hình. |
| `cost_input_per_m` | số >= 0 | giá trong danh mục | Giá USD đầu vào mỗi triệu token. Đặt cùng `cost_output_per_m`. |
| `cost_output_per_m` | số >= 0 | giá trong danh mục | Giá USD đầu ra mỗi triệu token. Đặt cùng `cost_input_per_m`. |
| `cost_cache_read_per_m` | số >= 0 | - | Giá đọc cache, khi bạn khai giá tường minh. |
| `cost_cache_write_per_m` | số >= 0 | - | Giá ghi cache, khi bạn khai giá tường minh. |

Hai mục cùng nhà cung cấp và cùng mô hình thì cần `alias` khác nhau.

Khóa chỉ được đọc từ biến môi trường mà `api_key_env` nêu tên. Không có trường ghi khóa dạng văn bản
thuần, cũng không có biến base URL theo từng nhà cung cấp.

**Ollama.** Mô hình chạy qua Ollama dùng cửa sổ ngữ cảnh của server, chỉ vài nghìn token nếu bạn không
nâng lên. Prompt dài hơn bị cắt im lặng, nên một phiên tranh luận có thể mất bằng chứng mà không báo
lỗi. Hãy khởi động server với cửa sổ lớn hơn: `OLLAMA_CONTEXT_LENGTH=32768 ollama serve`.

**Nhà cung cấp theo thuê bao.** Mục của chúng không nhận `api_key_env`; hãy đăng nhập bằng
`openalpha auth login <nhà cung cấp>` (ví dụ `chatgpt`). Chúng cũng từ chối giá `cost_*` tường minh (lượng dùng miễn phí) và `max_tokens`,
dù đặt trên mục hay trong `[model_defaults]` (endpoint ChatGPT không nhận trần đầu ra). Chưa đăng nhập
không làm hỏng khởi động; lỗi chỉ hiện ở lời gọi đầu tiên. Xem [Agent](tro-ly.md).

**Tài khoản cloud.** Ba nhà cung cấp có thể đăng nhập bằng chính tài khoản cloud bạn đang dùng thay
cho API key. Đặt các biến mà công cụ của từng cloud vẫn đọc, và bỏ `api_key_env`:

| Nhà cung cấp | Biến | `base_url` |
|---|---|---|
| `vertex` (Google Vertex AI) | `GOOGLE_APPLICATION_CREDENTIALS`, đường dẫn tới khóa service account hoặc tới file mà `gcloud auth application-default login` tạo ra | bắt buộc: `https://aiplatform.googleapis.com/v1/projects/<project>/locations/global/endpoints/openapi` |
| `azure-openai`, `azure-openai-responses` | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (một service principal của Microsoft Entra) | bắt buộc: resource của bạn, ví dụ `https://<resource>.openai.azure.com/openai/v1` |

Mục Azure nào có cả `api_key_env` thì dùng key. Token được tạo ở lời gọi đầu tiên và làm mới trước khi
hết hạn; không có gì ghi xuống đĩa. Thiếu biến thì khởi động dừng lại và nêu đúng tên biến cần đặt,
`openalpha doctor` cũng báo dòng đó.

Amazon Bedrock không cần ký request AWS: `bedrock` (Claude, định dạng Anthropic) và `bedrock-openai`
(các mô hình định dạng OpenAI) nhận API key của Bedrock trong `AWS_BEARER_TOKEN_BEDROCK`. Cả hai mặc
định ở `us-east-1`; vùng khác thì đặt `base_url` thành `https://bedrock-mantle.<region>.api.aws/anthropic`
hoặc `.../openai/v1`. Tên mô hình Claude mang tiền tố `anthropic.` của Bedrock, ví dụ
`anthropic.claude-sonnet-5-5`.

### `[[model_tiers.<name>]]` (tùy chọn)

Một chuỗi dự phòng có tên mà agent chọn được: agent có sẵn, agent plugin đi kèm và agent của bạn. Mỗi nhóm là một mảng bảng TOML dưới
`model_tiers.<name>`. Mục đầu là mô hình chính, các mục sau được thử theo thứ tự. Mỗi mục theo schema
của `[[models]]` và thừa hưởng `[model_defaults]`. Mọi mục phải hỗ trợ gọi công cụ.

Mọi nhóm đều **ngầm kết thúc** bằng mô hình chính của `[[models]]`: khi mọi mục của nhóm đều hỏng
(thiếu nhà cung cấp, 404, hết giờ), yêu cầu rơi về mô hình mặc định thay vì bị hủy.

```toml
[[model_tiers.research]]
provider = "anthropic"
model = "claude-sonnet-4-6"
api_key_env = "ANTHROPIC_API_KEY"
```

Tên nhóm bắt đầu bằng chữ thường, phần sau là chữ thường, chữ số, `_` hoặc `-`. Bỏ trống một nhóm chỉ
là lỗi khi có agent chọn nó.

Các vai tranh luận ưu tiên nhóm tên `debate`. Có nhóm này thì mọi vai chạy trên chuỗi đó. Đây là chỗ
nên ghim endpoint và đặt mốc hết giờ luồng chặt, trong khi chat vẫn dùng chuỗi chính:

```toml
[[model_tiers.debate]]
model = "deepseek/deepseek-v4.1-flash"
provider_only = ["deepseek"]
provider_allow_fallbacks = false
```

Các tên nhóm sau được tra theo tên:

| Nhóm | Ai dùng |
|---|---|
| `research-heavy` | `research-crawler` |
| `research` | `deep-researcher`, `research-planner`, `research-synthesizer`, `research-reviewer` |
| `delegate` | `reviewer` |
| `debate` | các vai tranh luận giao dịch |
| `themes` | vai phân tích chủ đề đứng sau `/themes`; mọi mục phải hỗ trợ gọi công cụ, vì nó có thể gọi `research` |
| `extraction` | chỉ riêng tác vụ trích xuất vĩ mô của daemon, đọc số liệu vĩ mô VN từ báo cáo của cơ quan thống kê và báo chí |
| `decisions` | lượt đọc tiêu đề chạy trước phiên tranh luận |

Không có nhóm của mình thì agent hay tác vụ dùng chuỗi `[[models]]` toàn cục. `decisions` là ngoại lệ:
không có nhóm này thì lượt đọc tiêu đề tắt, và phiên tranh luận nhóm tiêu đề theo nguồn tin. Agent
`deep-researcher` đứng sau `/research` viết báo cáo bạn đọc, nên nó chạy trên nhóm `research` chứ không
phải chuỗi rẻ hơn có thể làm sai số liệu.

Dưới `openalpha mcp serve`, mô hình của client đã kết nối trả lời cho mọi agent, nên `[[models]]` không
được đọc và không cần khóa. Chỉ các nhóm tra theo tên, như `decisions`, còn dùng cấu hình, và nhóm nào
thiếu khóa thì bị bỏ qua thay vì làm hỏng khởi động.

#### Chọn mô hình theo việc

Mọi mô hình phải gọi được công cụ và trả JSON đúng schema. Mô hình hay trả sai schema làm đề xuất chưa kết luận được.

| Việc | Nhóm | Nên chọn |
|---|---|---|
| Chat, và mọi việc chưa có nhóm riêng | `[[models]]` | Mô hình rẻ, nhanh, ví dụ `deepseek-v4-flash`. Thêm một mục dự phòng ở nhà cung cấp khác. |
| `/suggest`, bản tin sáng | `debate` | Bắt đầu với mô hình rẻ. Qua OpenRouter thì ghim endpoint bằng `provider_only` như ví dụ trên, vì endpoint ngẫu nhiên có thể rất chậm. |
| `/research` | `research`, `research-heavy` | Xem mục dưới. Reviewer là cổng chất lượng, nên đừng chọn quá rẻ. |
| `/themes` | `themes` | Như `research`: cần gọi công cụ. |
| Đọc tiêu đề, trích số liệu vĩ mô | `decisions`, `extraction` | Mô hình rẻ là đủ: việc ngắn, chỉ cần chép đúng số và đúng schema. |

Đổi mô hình chưa có cách đo trước được, nên đổi từng nhóm một rồi theo dõi chi phí bằng `openalpha cost --breakdown`.

#### Chọn mô hình cho các nhóm nghiên cứu

Chọn theo tải công việc, không theo số lượng agent:

- **`research-heavy` (chỉ crawler).** Mỗi câu hỏi nghiên cứu một lời gọi, mang tối đa 8 nguồn đã truy
  hồi, mỗi nguồn cắt ở 4000 ký tự - khoảng 8-10k token đầu vào. Khâu truy hồi lưu tối đa 64 KiB văn bản
  thô mỗi nguồn, nhưng mô hình không bao giờ thấy chừng đó. Đầu ra bị chặn ở 12000 token. Crawler không
  giữ công cụ nào và chỉ rút trích từ văn bản được đưa, nên nó cần chép trích dẫn chính xác từng ký tự
  và tuân thủ chặt JSON schema, không cần suy luận sâu hay cửa sổ khổng lồ. Mức suy luận cố định ở
  `low`. Phù hợp: `claude-sonnet-4-6` (anthropic), `gpt-5.5` (openai); tiết kiệm: `gemini-2.5-flash`
  (gemini).
- **`research` (planner, synthesizer, reviewer).** Synthesizer và reviewer mỗi bên nhận trọn gói bằng
  chứng, tối đa 128 KiB (khoảng 32k token). Đầu ra chặn ở 6000 token mỗi giai đoạn. Lập kế hoạch và
  tổng hợp chấp nhận mô hình hạng giữa. Reviewer là cổng chất lượng, nên hãy chọn cỡ nhóm theo nó.
  Phù hợp: `claude-sonnet-4-6`, `gpt-5-mini` (openai); tiết kiệm: `gemini-2.5-flash`,
  `deepseek-v4-flash` (deepseek).

Hai quy tắc kinh nghiệm:

- Đặt mô hình chính của nhóm ở nhà cung cấp hoặc tuyến khác với mô hình chính toàn cục, để một nhà
  cung cấp sự cố không đánh sập cả chat lẫn nghiên cứu.
- Khai một tuyến rẻ hơn hoặc tuyến phụ làm mục dự phòng.

### `[model_defaults]` (tùy chọn)

Các trường mà mọi mục `[[models]]` và `[[model_tiers.<name>]]` thừa hưởng. Giá trị ở chính mục thì
thắng. Nó nhận `provider`, `api_key_env`, `base_url`, `reasoning`, `max_tokens`, `provider_sort`,
`provider_only`, `provider_order`, `provider_allow_fallbacks`, `ttft_timeout_ms` và
`stream_idle_timeout_ms`, mỗi khóa mang đúng nghĩa như trong `[[models]]`. `model`, `alias`,
`reasoning_required` và các khóa `cost_*` chỉ đặt theo từng mục.

Mục nào ghi `provider` khác thì không nhận `base_url` và các khóa `provider_*`, vì chúng thuộc về nhà
cung cấp của `[model_defaults]`. Mục đó vẫn nhận `api_key_env`, nhưng biến chưa đặt thì không phải lỗi:
server chạy trên máy này không cần khóa, còn một endpoint khác của cùng nhà cung cấp
(`openrouter-decisions` cạnh `openrouter`) dùng được luôn khóa của router. Nhà cung cấp hosted khác
thì hãy ghi `api_key_env` riêng. `reasoning`, `max_tokens` và hai mốc hết giờ vẫn được thừa hưởng.

### Agent `model_tier` (chỉ trong agent.toml)

Một hồ sơ agent chọn đúng một chuỗi có tên qua `model_tier`. Đây là cách duy nhất để agent chọn chuỗi
mô hình; không có khóa `model` riêng cho từng agent. Nhóm phải có trong `[[model_tiers.<name>]]`.

Hồ sơ có sẵn, hồ sơ plugin đi kèm và agent do bạn viết được đặt `model_tier`, và mọi mục trong nhóm phải hỗ trợ
gọi công cụ. Hồ sơ plugin không đáng tin mà khai nó thì bị từ chối. `reasoning` vẫn chỉ dành cho hồ sơ đáng tin.

Không có `model_tier` thì agent dùng chuỗi `[[models]]`. Một vai có sẵn có thể mang lựa chọn ưu tiên
riêng (các worker nghiên cứu ưu tiên `research`), và `model_tier` tường minh không ghi đè được nó.

### `[llm]`

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `max_calls_per_minute` | số nguyên | `60` | Số dương. Trần số lời gọi mô hình toàn tiến trình, kèm một gáo công bằng theo agent và người dùng. |

Thời gian thử lại và nghỉ là cố định. Một lời gọi được thử lại tối đa 2 lần, độ lùi cơ sở 500 ms. Một
mục (nhà cung cấp + mô hình) hết lượt thử lại vì lỗi tạm thời thì nghỉ 1 phút. Cả một nhà cung cấp từ
chối xác thực hoặc thanh toán thì bị tạm dừng 15 phút rồi thử lại.

### `[budget]`

Các trần chi tiêu: `max_daily_usd`, `max_monthly_usd`, `soft_warn_ratio` (0 tới 1) và `max_per_run_usd`.
Mọi trần mặc định `0`, nghĩa là không chặn. Từng khóa chặn cái gì, cảnh báo mềm và trần theo agent nằm
ở [Chi phí và ngân sách](ngan-sach.md).

### `[locale]`

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `language` | chuỗi | `vi` | `en` hoặc `vi`. Ngôn ngữ duy nhất mọi câu trả lời, bản tin và cảnh báo dùng; hồ sơ đầu tư không có ngôn ngữ riêng. |
| `timezone` | chuỗi | múi giờ của máy (`UTC` nếu máy không báo) | Tên IANA, ví dụ `Asia/Ho_Chi_Minh`. Việc cron mới chụp lại giá trị này, trừ khi `--tz` ghi đè; lịch theo chu kỳ từ chối `--tz`. |
| `currency` | chuỗi | `VND` | Mã ISO 4217 (ba chữ in hoa). Đồng tiền cơ sở của phần giao dịch; `onboard` hỏi ở lần thiết lập đầu và ghi vào đây. Cố định từ khi sổ có hồ sơ: đổi sau đó bị từ chối, và `doctor` báo chỗ lệch ở dòng `database`. |
| `region` | chuỗi | `vn` | Khu vực chính; hiện chỉ có `vn`. Khu vực cần có sàn giao dịch thị trường chính của nó, nên `global` (vàng thế giới, chỉ để tham chiếu) bị từ chối. Thị trường của khu vực này là bảng mặc định, và hồ sơ đầu tiên chỉ phân bổ cho các nhóm trong nước của nó cùng crypto. |

Mọi khóa đều tùy chọn. `[locale]` không nhận khóa nào khác. `currency` và `region` cho biết bạn đang ở
đâu, nên phần giao dịch đọc chúng ở đây thay vì giữ bản trùng dưới `[trading]`.

`[locale] language` là cài đặt ngôn ngữ duy nhất. Hồ sơ giao dịch còn giữ trong kho một bản sao cũ tên `preferred-locale`, nhưng
không có gì đọc nó: sửa ở đó không đổi gì, và hồ sơ mà ứng dụng hiện ra báo đúng khóa này.

Phần chữ do mô hình viết, như luận điểm của một đề xuất hay phần đọc một chủ đề, giữ nguyên ngôn
ngữ của lần chạy đã viết ra nó. Đổi `language`, hoặc nhắn bot bằng ngôn ngữ khác, chỉ đổi phần nhãn
xung quanh chứ không đổi phần chữ đã lưu; lần chạy sau sẽ viết bằng ngôn ngữ mới.

### `[paths]`

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `data_dir` | chuỗi | `~/.openalpha` | Thư mục gốc cho trạng thái và dữ liệu runtime, áp dụng sau khi cấu hình đã nạp. Nó không chọn tệp cấu hình. `--data-dir` và `OPENALPHA_DATA_DIR` ghi đè nó. |
| `skills_dirs` | chuỗi[] | `[]` | Các thư mục kỹ năng bổ sung. `~` được mở rộng lúc khởi động. |

Bố cục dưới `data_dir`:

```text
{data_dir}/
  data/openalpha.sqlite             cơ sở dữ liệu SQLite mặc định (dữ liệu + bộ nhớ)
  openalpha.pid                     tệp khóa của daemon
  openalpha.ready                   ghi khi daemon đã sẵn sàng; những gì nó đang thiếu
  daemon.stdout.log                 đầu ra lạc của daemon chạy nền, xóa trắng mỗi lần khởi động
  daemon.stderr.log                 cảnh báo và lỗi của daemon chạy nền, xóa trắng mỗi lần khởi động
  restart.json                      ghi khi có yêu cầu khởi động lại, xóa khi daemon mới báo chuyện đó
  restart.stdout.log                đầu ra lạc của một lần khởi động lại từ API, nơi cần xem khi nó thất bại
  restart.stderr.log                cảnh báo và lỗi của lần khởi động lại đó
  logs/daemon.log                   log chung mặc định (`[log] file`)
  logs/agents/<agentId>/agent.log   log chạy riêng theo agent, được giữ lại
  backups/                          bản sao lưu `db backup`, cùng ảnh chụp pre-migration/ và pre-rollback/
    daily/                          bản sao hằng ngày của daemon, giữ `[retention] daily_backups` bản mới nhất
  plugins/                          plugin đã cài
  workspaces/<agentId>/             thư mục nháp riêng của từng agent
    run/                            HOME của tiến trình con; chỉ `workspace cleanup` có xác nhận mới dọn
    tmp/                            thư mục tạm của tiến trình con; `workspace cleanup` dọn, và một lần
                                    lúc khởi động với tệp cũ hơn `[retention].days`
```

Tệp ở gốc thư mục làm việc được giữ lâu dài; dọn dẹp thường lệ không bao giờ đụng tới. `workspace
cleanup` chỉ ghé `run/` và `tmp/`, không vào `logs/agents/`. Các công cụ tệp bị giam trong thư mục nháp
của agent. `shell_exec` bắt đầu ở đó, với `HOME` và thư mục tạm nằm trong đó, nhưng đó chỉ là thư mục
xuất phát, không phải vùng cách ly của hệ điều hành: một tiến trình đã được duyệt vẫn ghi được ra chỗ
khác.

### `[storage]`

Có hai engine, chọn bằng `engine`. Mỗi engine có bộ khóa riêng, không trộn lẫn. SQLite là mặc định khi
vắng mục này.

```toml
[storage]
engine = "sqlite"
# path = "data/openalpha.sqlite"
```

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `engine` | `sqlite` | `sqlite` | Engine nhúng. |
| `path` | chuỗi | `data/openalpha.sqlite` dưới `data_dir` | `~/` mở rộng thành home, đường dẫn tuyệt đối giữ nguyên, tương đối thì nối vào `data_dir`. |

PostgreSQL cần cả tên biến và schema:

```toml
[storage]
engine = "postgres"
url_env = "OPENALPHA_DATABASE_URL"
schema = "openalpha"
```

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `engine` | `postgres` | - | Chọn PostgreSQL. |
| `url_env` | chuỗi | - | Bắt buộc. Biến môi trường chứa URL kết nối. |
| `schema` | chuỗi | - | Bắt buộc. Định danh PostgreSQL chữ thường, tối đa 63 ký tự. |

Thiếu `url_env` hoặc để rỗng thì bước phân giải cấu hình thất bại. URL không bao giờ được ghi ngược
vào cấu hình bạn xem.

### `[retention]`

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `days` | số nguyên | `90` | Số dương. Giữ bao lâu: phiên không còn hoạt động và đường định tuyến của chúng, mục bộ nhớ đã xóa, lượt chạy của bộ lập lịch quá 200 lượt mới nhất mỗi việc, mục inbox chưa ai nhận, ghép nối đang chờ, cảnh báo đã kích hoạt hoặc đã tắt, bản chụp bản tin quá bản mới nhất mỗi ngôn ngữ, và lịch sử mà ứng dụng đọc: các phiên chạy đã xong sau danh sách hoạt động, và thông báo trong chuông, đã đọc hay chưa. |
| `inbox_days` | số nguyên | `7` | Số dương. Giữ bao lâu các mục inbox đã xong và đã hỏng, gồm cả nội dung. |
| `daily_backups` | số nguyên | `3` | Từ `0`. Giữ bao nhiêu bản sao lưu SQLite hằng ngày trong `backups/daily/`; `0` là tắt. PostgreSQL bị bỏ qua (dùng `pg_dump`). |

`days` còn điều khiển hai quy tắc về tệp:

- Lúc daemon khởi động, tệp trong `workspaces/<agentId>/tmp/` cũ hơn `days` bị xóa một lần, trước khi
  nhận việc.
- Trong lượt quét định kỳ của daemon, thư mục trong `logs/agents/` của agent không còn được cấu hình chỉ
  bị xóa khi đoạn log mới nhất của nó cũ hơn `days`.

Nó không áp cho log chung hay log theo agent đang hoạt động (bị chặn bởi `[log].max_file_mb` và
`[log].max_files`), cho tệp ở gốc thư mục làm việc, và cho `workspaces/<agentId>/run/`. Muốn xóa log
theo agent ngay, kể cả agent đang cấu hình, dùng `openalpha logs clear`. Lệnh này không đụng tới log
chung.

### `[notices]`

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `chat` | mảng chuỗi | `[]` | Các loại thông báo được gửi tới chat của bạn ngoài chuông. Loại hợp lệ: `call-scored`, `held-news`, `index-drop`; tên khác sẽ làm daemon dừng lúc khởi động và nêu các loại hợp lệ. |

Các loại này chỉ vào chuông trong ứng dụng, không tới chat nào trừ khi bạn liệt kê ở đây: một đề xuất bạn nhận đã có kết quả, tin về mã bạn đang giữ, và chỉ số của khu vực giảm mạnh trong phiên. Tin về mã đang giữ chỉ gồm những mã daemon đã đọc: tiêu đề được lưu khi `/suggest` hoặc một cuộc chat về mã đó đọc chúng, và không có gì đi lấy tin cho các mã bạn giữ theo lịch. Mọi thứ khác daemon gửi tới chat vẫn như cũ.

### `[log]`

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `level` | chuỗi | `info` | `debug`, `info`, `warn`, `error`, `fatal`. |
| `file` | chuỗi | `logs/daemon.log` | Đường dẫn tương đối nối vào `data_dir`; đường dẫn tuyệt đối và `~/...` giữ nguyên nghĩa. Thư mục chưa có sẽ được tạo ở chế độ riêng tư; thư mục đã có được giữ nguyên, nhưng phải là của bạn và người khác không ghi vào được. |
| `max_file_mb` | số thực | `50` | Kích thước tệp đang ghi trước khi xoay vòng. |
| `max_files` | số nguyên | `7` | Số tệp đã xoay vòng được giữ, ngoài tệp đang ghi. |

Thứ tự ưu tiên của mức log: `--log-level`, rồi `OPENALPHA_LOG_LEVEL`, rồi `[log].level`.

### `[update]`

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `check` | bool | `true` | Hỏi GitHub hai lần mỗi ngày xem đã có bản mới chưa. |
| `auto` | bool | `false` | Tự cài bản sửa lỗi (chỉ đổi số cuối, như 1.0.5 lên 1.0.6) lúc 00:00-06:00 theo `[locale] timezone`, khi daemon chạy nền; không bao giờ cài khi thị trường bạn theo dõi đang trong phiên, kể cả giờ nghỉ trưa (crypto chạy cả ngày nên không tính). |

Khi có bản mới, CLI in một thông báo ngắn sau lệnh (tối đa mỗi ngày một lần), chat hiện thông báo đó dưới lời chào, `version` và `doctor version` báo lại, daemon ghi vào nhật ký, bản tin sáng gửi qua kênh kết thúc bằng thông báo đó, và bot nhắc trong chat riêng của bạn. Không có gì tự cài cho tới khi bạn chạy `openalpha upgrade` hoặc `/upgrade confirm`, trừ khi bật `auto`: khi đó daemon chạy nền tự cài bản sửa lỗi trong khung giờ ấy, nhắn bạn khi đã chạy lại (vào chat riêng bạn nhắn bot gần nhất), và quay về bản cũ nếu bản mới không khởi động được. Trên máy chủ, hãy đặt `[locale] timezone` để khung giờ rơi vào ban đêm. Bản chạy từ mã nguồn không bao giờ kiểm tra; trong CI chỉ `version` và `doctor --online` kiểm tra.

### `[channels.telegram]`

Có mục này là Telegram được bật, trừ khi `enabled = false`. Vẫn cần một token lúc khởi động.

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `enabled` | bool | `true` khi mục tồn tại | Công tắc kênh. |
| `agent` | chuỗi | `chat` | Agent cửa vào; `/agent <id>` đặt được một ghi đè theo từng chat. |
| `allowed_ids` | (chuỗi\|số)[] | `[]` | Danh sách cho phép ban đầu cho người dùng và chat Telegram. |
| `operator_user_ids` | (chuỗi\|số)[] | `[]` | Người dùng được chạy lệnh chỉ dành cho operator. |
| `token_env` | chuỗi | - | Biến môi trường chứa token. |
| `token_file` | chuỗi | - | Tệp mà nội dung đã cắt khoảng trắng chính là token. |
| `typing_indicator` | bool | `true` | Hiện "đang gõ" trong lúc sinh câu trả lời. |
| `use_reactions` | bool | `true` | Dùng cảm xúc làm tín hiệu trạng thái ở nơi hỗ trợ. |
| `markdown` | bool | `true` | Dựng Telegram MarkdownV2; `false` gửi văn bản thuần, kể cả khi trả lời theo luồng. |
| `require_mention` | bool | `true` | Bắt buộc nhắc tên bot trong nhóm. |
| `mid_stream_updates` | bool | `true` | Sửa câu trả lời trong lúc truyền luồng. |
| `slash_commands` | bool | `true` | Bật lệnh gạch chéo và menu lệnh. |
| `notify_max_per_minute` | số nguyên | `3` | Trần tần suất tin chủ động. |
| `gap_note_ms` | số nguyên | `1800000` | Số mili giây im lặng (mặc định 30 phút) để câu trả lời kế tiếp được nhắc xem lại giá; `0` là tắt. |
| `fallback_chat_id` | chuỗi | id được phép duy nhất, hoặc chat ghép nối duy nhất | Đích dự phòng cho tin chủ động. |
| `pairing` | bool | `true` khi không có danh sách cho phép | Cho chat lạ ghép nối. |

`token_env` thắng `token_file`. Không có khóa `token` ghi thẳng, và không biến token nào được đọc trừ
khi `token_env` nêu tên nó.

### `[channels.zalo]`

Có mục này là bot Zalo được bật, trừ khi `enabled = false` hoặc `dm_policy = "disabled"`. Nó nhận các
khóa gửi tin đã liệt kê cho Telegram, cộng các khóa dưới đây. Kênh làm được gì vẫn tùy năng lực của
đường truyền; xem [Kênh](kenh.md).

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `token_env` | chuỗi | - | Biến môi trường chứa token. |
| `token_file` | chuỗi | - | Tệp mà nội dung đã cắt khoảng trắng chính là token. |
| `allowed_ids` | (chuỗi\|số)[] | `[]` | Danh sách cho phép ban đầu cho chat và người dùng. |
| `operator_user_ids` | (chuỗi\|số)[] | `[]` | Người dùng được chạy lệnh operator. |
| `dm_policy` | `pairing \| allowlist \| disabled` | `pairing`, hoặc `allowlist` khi đã có `allowed_ids` | Cách xét duyệt chat, và công tắc tắt kênh. Không có chế độ mở. |

Token phân giải như Telegram. Bộ nối này dùng polling, nên lúc khởi động nó gỡ webhook đang gắn với
bot: Zalo chỉ giao tin theo một trong hai cách, không bao giờ cả hai.

### `[channels.zalo_personal]`

Bộ nối này dùng một API tài khoản cá nhân không chính thức. Nó nhận các khóa gửi tin của Telegram, trừ
các khóa token và `pairing`. Nó luôn chỉ chạy theo danh sách cho phép, và chỉ khởi động khi
`i_accept_ban_risk` là `true` và `allowed_ids` không rỗng. Rủi ro được nêu ở [Kênh](kenh.md).

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `allowed_ids` | (chuỗi\|số)[] | `[]` | Bắt buộc, danh sách cho phép không rỗng. |
| `operator_user_ids` | (chuỗi\|số)[] | `[]` | Người dùng được chạy lệnh operator. |
| `i_accept_ban_risk` | bool | - | Phải đúng bằng `true` mới bật được bộ nối. |
| `profile` | chuỗi | `default` | Kênh dùng lần đăng nhập QR đã lưu nào. |

Khóa là `zalo_personal`, trùng mã kênh. Liên kết đăng nhập bằng `openalpha zalo login`; nó được cất theo
`profile`.

### `[schedule]`

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `approval_timeout_ms` | số nguyên | `900000` | 15 phút. Một việc theo lịch chờ người duyệt qua kênh lâu như vậy. Câu trả lời không bao giờ được lưu. Tối đa 2147483647 (khoảng 24 ngày). |
| `failure_target` | chuỗi | - | `<channel>:<chatId>` nhận thông báo khi một việc bị tắt vì hỏng nhiều lần. |

Bộ lập lịch cứ 30 giây xem có việc đến hạn không, mỗi lần khởi động tối đa 5 việc, và chạy tối đa 50
việc cùng lúc. Cron tính theo phút và `schedule run-now` bỏ qua lượt xem này, nên một khoảng ngắn hơn
chẳng được gì.

### `[loop]`

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `max_turns` | số nguyên | `40` | Trần cứng mỗi phiên chạy. |
| `max_tool_calls` | số nguyên | `120` | Trần cứng số lời gọi công cụ mỗi phiên chạy. |
| `max_duration_ms` | số nguyên | `900000` | 15 phút. Dưới `mcp serve`, 90% của nó (tối đa 10 phút) là thời gian một câu trả lời của client được phép mất. Tối đa 2147483647 (khoảng 24 ngày). |
| `approval_timeout_ms` | số nguyên | `120000` | 2 phút; hết hạn thì tự từ chối. Trần thời lượng tạm dừng trong lúc một ô hỏi đang mở. Tối đa 2147483647 (khoảng 24 ngày). |
| `delegation_depth` | số nguyên | `3` | Độ sâu lồng agent con tối đa. |
| `max_delegations` | số nguyên | `32` | Tổng số agent con cả một phiên chạy được khởi động. |
| `max_parallel_delegations` | số nguyên | `5` | Số mục agent con tối đa một lời gọi `delegate_parallel` nhận. |
| `max_spawn_duration_ms` | số nguyên | `600000` | 10 phút: thời gian một agent con do `spawn` tạo làm việc trước khi bị dừng; phần đã đọc được trả về và đánh dấu là một phần. Tối đa 2147483647. |
| `max_spawn_turns` | số nguyên | `12` | Số lượt mô hình mỗi agent con do `spawn` tạo có. |
| `max_unasked_fetches` | số nguyên | `10` | Số lần gọi `web_fetch` trong một lần chạy, kể cả lần đã hỏi, trước khi mọi lần sau đều hỏi bạn. `0` là lần nào cũng hỏi. |

Việc nén phiên là cố định: một phiên được nén khi quá 500 tin nhắn hoặc khi đầy 75% cửa sổ ngữ cảnh,
tối đa 3 lần mỗi phiên chạy.

### `[memory]`

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `ttl_days` | số nguyên | `90` | Thời gian sống mặc định của các quan sát có hạn. |

Một giá trị bộ nhớ được lưu bị chặn ở 16 KiB. Trang văn phòng liệt kê các ghi chú ở Cài đặt > Bộ nhớ, theo từng agent và từng người nó đã trò chuyện cùng, thêm ghi chú bằng "+ Ghi nhớ" và quên một ghi chú với nút hoàn tác; một ghi chú tự quên sau `ttl_days` ngày kể từ lần cập nhật cuối.

### `[web_search]`

Cấu hình công cụ `web_search`. Bỏ hẳn mục này thì dùng DuckDuckGo. Dưới `openalpha mcp serve` mục này bị
bỏ qua và không công cụ web nào được chào; client tự mang của nó.

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `provider` | chuỗi | `duckduckgo` | `duckduckgo`, `anysearch`, `tavily`, `brave`, `deepseek`, `exa`, `serper` hoặc `searxng`. |
| `api_key_env` | chuỗi | - | Biến môi trường chứa khóa API. Bắt buộc với tavily, brave, deepseek, exa và serper; `ANYSEARCH_API_KEY` là tùy chọn với anysearch. |
| `base_url` | chuỗi | - | URL instance SearXNG. Bắt buộc với `searxng`, bị từ chối với mọi nhà cung cấp khác. Instance phải bật định dạng `json` trong `settings.yml` (`search.formats`). |
| `cost_per_search_usd` | số thực | - | Chi phí tính cho mỗi truy vấn với `brave`, `deepseek`, `serper` và `tavily` - các bên có tính tiền nhưng không trả về chi phí. DeepSeek chỉ bị tính khi lượt tìm có kết quả, đúng như cách DeepSeek tính tiền. Bị từ chối với `duckduckgo`, `searxng` (miễn phí), `exa` (tự báo chi phí) và `anysearch` (báo 0). Đặt đúng đơn giá gói của bạn; `0` thì tắt việc tính. |
| `fallback_provider` | chuỗi | - | Nhà cung cấp thứ hai, được thử sau một lỗi hoặc kết quả rỗng. Phải khác `provider`. Các khóa `fallback_*` cần nó. |
| `fallback_api_key_env` | chuỗi | - | Như `api_key_env`, cho bên dự phòng. |
| `fallback_base_url` | chuỗi | - | Như `base_url`, chỉ cho bên dự phòng `searxng`. |
| `fallback_cost_per_search_usd` | số thực | - | Như `cost_per_search_usd`, cho bên dự phòng. |
| `cache_ttl_ms` | số nguyên | `300000` | Thời gian sống của cache kết quả theo truy vấn, tính bằng mili giây; `0` thì tắt cache. |
| `exa_search_type` | chuỗi | `auto` | Chỉ Exa: `auto`, `fast`, `instant`, `deep-lite`, `deep`, `deep-reasoning`. |
| `safe_search` | số nguyên | theo instance | Chỉ SearXNG: `0`, `1` hoặc `2`. Bỏ trống thì giữ thiết lập của instance. |

Nếu `api_key_env` trỏ tới một biến rỗng hoặc chưa đặt, mọi thứ khác vẫn chạy, chỉ riêng tìm kiếm web
dừng: công cụ `web_search` và `/research` từ chối và nói bạn cần đặt biến nào, chứ không tự rơi về
DuckDuckGo. `doctor`, `config validate` và `start` cũng báo điều này. Nếu chỉ `fallback_api_key_env`
rỗng thì bên dự phòng bị bỏ, bên chính vẫn chạy, và `doctor` cho biết bên dự phòng đang tắt. Nhà cung
cấp cần khóa mà không khai `api_key_env` nào thì vẫn là lỗi cấu hình.

SearXNG không cần khóa, do bạn tự dựng, và yêu cầu kết quả theo `[locale] language`. Instance loopback
dùng HTTP hay HTTPS đều được; instance ở xa bắt buộc HTTPS và bị giới hạn ở đúng tên miền đã cấu hình.

`anysearch` dùng endpoint cố định `https://api.anysearch.com/v1/search` và làm được cả nhà cung cấp
chính lẫn bên dự phòng. `ANYSEARCH_API_KEY` là tùy chọn; không có nó thì truy cập ẩn danh với hạn mức
thấp hơn. Nó trả tối đa 20 kết quả, gửi `[locale] language`, và không hỗ trợ lọc theo độ mới, nên một
yêu cầu về độ mới được báo là chưa kiểm chứng.

`deepseek` là lựa chọn tiết kiệm: khoảng 0,75 USD cho 1.000 lượt tìm, lượt nào không ra kết quả thì không mất tiền. Nó đọc tốt nguồn tiếng Việt lẫn tiếng Anh, có ngày đăng cho từng kết quả và lọc đúng theo độ mới, nên "tuần trước" là đúng tuần trước. Nó dùng chung `DEEPSEEK_API_KEY` với mô hình DeepSeek; hãy đặt `cost_per_search_usd = 0.00075` để khoản chi hiện trong tổng. DeepSeek chỉ nhận truy vấn ngắn (128 ký tự). Truy vấn dài bị cắt bớt từ cuối nhưng vẫn giữ danh sách trang bạn chọn; chỉ khi danh sách dài tới mức gần hết chỗ cho câu hỏi thì nó mới chuyển sang lọc trên kết quả. Trang loại trừ luôn được lọc trên kết quả, nên bạn vẫn chỉ nhận đúng các trang đã chọn. DeepSeek không nhận tham số ngôn ngữ, nên bản dịch máy của một trang (đường dẫn kiểu `/nl/`, `/de/`) bị bỏ khỏi kết quả, chỉ giữ trang đúng ngôn ngữ của bạn. Các lượt tìm được giãn nhịp theo giới hạn 5 lượt mỗi giây của DeepSeek.

Khóa chỉ lấy từ biến môi trường mà `api_key_env` và `fallback_api_key_env` nêu tên.
Cài đặt > Công cụ trên trang văn phòng đổi được `provider` (sau khi khởi động lại) và lưu chính khóa, còn
tên biến và `base_url` vẫn nằm trong file này. Một lời gọi nhà
cung cấp hết giờ sau 15 giây và thử lại lỗi tạm thời tối đa 3 lần, độ lùi cơ sở 800 ms. Nhà cung cấp
hỏng 3 lần liên tiếp thì bị bỏ qua 1 phút. Cache giữ 100 mục mỗi TTL, và mỗi đoạn trích kết quả bị cắt
ở 400 ký tự.

| Nhà cung cấp | Biến môi trường | Đăng ký |
|---|---|---|
| `tavily` | `TAVILY_API_KEY` | https://app.tavily.com/ |
| `brave` | `BRAVE_API_KEY` | https://api-dashboard.search.brave.com/ |
| `deepseek` | `DEEPSEEK_API_KEY` | https://platform.deepseek.com/api_keys |
| `exa` | `EXA_API_KEY` | https://dashboard.exa.ai/ |
| `serper` | `SERPER_API_KEY` | https://serper.dev/ |

### `[api]`

API HTTP/WS (`/v1`) mà các ứng dụng khách dùng. `openalpha start` mở API khi `enabled = true`; một lệnh
chạy một lần không bao giờ mở cổng. API chỉ nghe trên `127.0.0.1` và từ chối mọi máy khác, nên máy khác
phải nối qua đường hầm SSH hoặc một reverse proxy chạy cùng máy (xem [Vận hành](van-hanh.md)). API chỉ
trả lời yêu cầu gửi tới `127.0.0.1`, `localhost` hoặc `[::1]`, hoặc tới `public_url` khi đã đặt. Ô sửa
cấu hình trên trang văn phòng không đổi được plugin, câu lệnh khởi chạy máy chủ MCP, mọi khóa `*_env`
cùng mọi mục khác ghi tên biến môi trường (`[trading.sources]`, `[trading.venues.<id>] credentials`),
`base_url`, `[paths]`, `[log] file`, `[storage]`, `[api]`, `[update]` hay `[trading.orders]
allow_unattended`; những mục đó bạn sửa ngay trong file này. Bản thân giá trị khóa thì lưu được từ
Cài đặt > Nhà cung cấp, Sàn giao dịch và Công cụ, các mục này ghi `<thư mục dữ liệu>/env` giống `openalpha key set`.

Bất cứ thứ gì đứng trước daemon (proxy như Caddy hay nginx, `tailscale serve`, một tên miền) đều cần `public_url`
đặt là địa chỉ trình duyệt mở. Chính nó bật các giới hạn khi bị phơi ra ngoài và cookie đăng nhập `__Host-`.
Khi chưa đặt, daemon chỉ bắt được proxy gửi `X-Forwarded-For` hoặc `Forwarded`, hay một `Host` không phải
tên cục bộ, và từ chối chúng kèm một câu nêu tên `public_url`. Proxy không gửi cả hai (một `proxy_pass`
nginx trần gửi `Host: 127.0.0.1:<cổng>` và không có tiêu đề chuyển tiếp nào) trông như yêu cầu cục bộ, nên
hãy đặt `public_url` trước khi mở ra ngoài, và cho nginx gửi `proxy_set_header Host $host;` cùng
`proxy_set_header X-Forwarded-For $remote_addr;`. Đặt `public_url` cũng thu hẹp việc ứng dụng làm được, vì
lúc này ứng dụng với tới được từ bên ngoài: các đường đặt lệnh của API và `/trade` vẫn tắt cho tới khi đặt
`orders = true`; chat từ ứng dụng không chạy được lệnh shell, không ghi tệp và không dùng công cụ của máy
chủ MCP hay plugin, cũng không dùng công cụ mạng xã hội; công việc tạo từ ứng dụng chỉ trả lời trong ứng
dụng; còn việc duyệt ghép nối cùng `allowed_ids`, `operator_user_ids`, `pairing` và `dm_policy` của từng
kênh chỉ đổi được trên máy chủ: bằng câu lệnh hoặc trong file này, không bao giờ từ ứng dụng.
Khi đó trang cũng không lưu khóa nào và không bắt đầu đăng nhập ChatGPT: hãy dùng `openalpha key set` và
`openalpha auth login chatgpt` trên máy chủ.

Mã API là biến `token_env` nếu có, nếu không là tệp `auth/api/token.json` (tạo ở lần chạy đầu, quyền
0600). Nếu `token_env` được đặt mà biến rỗng hoặc ngắn hơn 32 ký tự thì API không mở (token đã lưu
không được dùng thay) và `start` in cảnh báo, phần còn lại của daemon vẫn chạy; cổng đã bị dùng thì
`start` vẫn dừng. `openalpha api token` in mã ra và `openalpha api rotate` thay mã mới; xoay vòng sẽ đăng
xuất mọi trình duyệt, và mã cũ chỉ hết dùng được sau khi daemon khởi động lại. Trình duyệt không bao giờ
giữ mã này: `openalpha web` in một liên kết dùng một lần để đăng nhập, còn `openalpha connect` in dòng mà
ứng dụng desktop dán vào (xem [Vận hành](van-hanh.md#chạy-api-trên-máy-chủ)).

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `enabled` | bool | `false` | Công tắc chính. |
| `port` | số nguyên | `8765` | Cổng TCP, 1024-65535. |
| `token_env` | chuỗi | - | Biến môi trường chứa bearer token. Khi được đặt, token trong tệp bị bỏ qua. |
| `orders` | bool | `true`, hoặc `false` khi đã đặt `public_url` | Cho ứng dụng đặt lệnh, hủy lệnh và tắt chức năng mua. |
| `public_url` | chuỗi | - | Địa chỉ `https://` mà daemon được truy cập qua proxy: chỉ tên máy và cổng nếu cần, không kèm đường dẫn. Dùng `https://<machine>.<tailnet>.ts.net` với `tailscale serve`. |

### `[[mcp.servers]]`

Các server công cụ MCP bên ngoài. Lúc khởi động, tất cả được kết nối và khám phá song song, mỗi server
có một hạn chót; server hỏng thì được ghi log và bỏ qua. Công cụ của nó mang tên `mcp__<name>__<tool>`.

Server rớt kết nối giữa chừng sẽ được nối lại ở lần gọi kế tiếp tới nó, không bao giờ bằng bộ hẹn giờ,
và tối đa 30 giây một lần. Trong lúc chờ, lời gọi báo "The tool server isn't responding right now". Nếu
server quay lại với danh sách công cụ khác, các lời gọi vẫn thất bại cho tới khi danh sách khớp lại hoặc
bạn khởi động lại, vì công cụ giao cho agent được chốt từ lúc khởi động.

`transport = "stdio"` nhận `command`, `args` và `env`; `transport = "http"` nhận `url`. Không trộn hai
kiểu trong một mục.

```toml
[[mcp.servers]]
name = "everything"           # duy nhất; dùng làm tiền tố tên công cụ
transport = "stdio"           # sinh một tiến trình cục bộ
command = "npx"
args = ["-y", "@modelcontextprotocol/server-everything"]
# env = { API_KEY = "${MY_SERVER_KEY}" }   # ${NAME} được điền lúc khởi động
enabled = true

[[mcp.servers]]
name = "remote"
transport = "http"            # Streamable HTTP
url = "https://host/mcp"      # phải là http: hoặc https:
enabled = true
```

Placeholder dùng `${NAME}`, với `NAME` khớp `[A-Za-z_][A-Za-z0-9_]*`. Nếu biến chưa đặt hoặc rỗng,
`start` bỏ qua server đó và cảnh báo, còn `config validate` liệt kê khóa còn thiếu. Placeholder
không phải tên hợp lệ thì dừng khởi động.

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `name` | chuỗi | - | Mã server duy nhất; trở thành tiền tố tên công cụ (`mcp__<name>__*`). |
| `transport` | chuỗi | - | `stdio` (sinh tiến trình cục bộ) hoặc `http` (Streamable HTTP). |
| `command` | chuỗi | - | Chỉ `stdio`: tệp thực thi. |
| `args` | chuỗi[] | `[]` | Chỉ `stdio`: danh sách tham số. |
| `env` | map | `{}` | Chỉ `stdio`: biến môi trường thêm; `${NAME}` được điền lúc khởi động. |
| `url` | chuỗi | - | Chỉ `http`: URL server, `http:` hoặc `https:`. |
| `enabled` | bool | `true` | `false` để tắt mà không phải xóa mục. |

Công cụ MCP là bên ngoài, nên mọi lời gọi đều cần phê duyệt (xem [An toàn](an-toan.md)). Muốn giới hạn
agent được gọi công cụ MCP nào, dùng `[capabilities] tools` trong `agent.toml`.

### `[plugins]`

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `dirs` | chuỗi[] | `[]` | Các thư mục được quét để tìm plugin đã cài. |
| `allow_untrusted` | bool | `false` | Cho phép nạp plugin đã cài từ `dirs`. Plugin đi kèm được nạp riêng. |
| `allow_code` | bool | `false` | Cho phép chạy mã nguồn dữ liệu của một plugin đã cài. Tách khỏi `allow_untrusted`, vì chạy mã plugin là cấp cho nó mọi thứ tiến trình làm được. Công cụ và hook vẫn bị cấm trong cả hai trường hợp. |

### `[social]`

Các mạng xã hội của agent mà agent của bạn có thể tham gia; xem [Mạng xã hội](mang-xa-hoi.md). Mọi khóa
đều tùy chọn. Khóa lạ hoặc tên công cụ bị từ chối làm khởi động thất bại.

| Khóa | Mặc định | Ý nghĩa |
|---|---|---|
| `allowed_tools` | `[]` | Tên công cụ chính xác thêm vào những gì agent trên mạng được giữ. Công cụ ghi, chạy lệnh, lên lịch hay ủy quyền, công cụ ngoài, và các công cụ sổ, lệnh, tệp đều bị từ chối. |
| `heartbeat_interval_ms` | `7200000` | Khoảng cách giữa các lượt ghé của một agent tới một mạng; tối thiểu một phút. `social join --every` đặt riêng cho một agent. |
| `active_hours` | `""` | `"07:00-23:00"` theo `[locale] timezone` của bạn; để trống là cả ngày. Khung giờ kết thúc trước khi bắt đầu thì qua nửa đêm. |
| `max_posts_per_day` | `8` | Số bài mỗi agent và mỗi mạng. |
| `max_comments_per_day` | `40` | Số bình luận mỗi agent và mỗi mạng. |

Mọi giới hạn khác là quy tắc cố định; [Mạng xã hội](mang-xa-hoi.md) liệt kê chúng.

### `[capabilities]` (chỉ trong agent.toml)

Trần theo từng agent (`tools`, `delegates`, `hosts`, `skills`) nằm trong `agent.toml`, không phải
`config.toml`, và chỉ có thể thu hẹp quyền truy cập. Xem [Agent](tro-ly.md).

## Biến môi trường

### Phân giải cấu hình

| Biến | Tác dụng |
|---|---|
| `OPENALPHA_DATA_DIR` | Ghi đè `data_dir` trừ khi có `--data-dir`. Đường dẫn cấu hình mặc định đi theo thư mục này. |
| `OPENALPHA_LOG_LEVEL` | Đặt mức log trừ khi có `--log-level` (xem [`[log]`](#log)). Một trong `debug`, `info`, `warn`, `error`, `fatal`. |
| Biến nào được nêu tên trong cấu hình | Đọc qua `api_key_env`, `token_env` của kênh, `token_env` của API, hoặc `api_key_env` của web-search. |
| Biến mà `storage.url_env` nêu tên | Cung cấp URL kết nối PostgreSQL lúc khởi động. |

Mỗi mô hình đọc đúng biến mà `api_key_env` nêu tên, không có danh sách dự phòng. Các lựa chọn thường
gặp: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`.

### CLI

| Biến | Tác dụng |
|---|---|
| `NO_COLOR` | Tắt màu ANSI. |
| `FORCE_COLOR` | Ép bật màu ANSI kể cả khi stdout không phải terminal. |
| `HOME` | Thư mục home của bạn (dùng khi hiển thị đường dẫn). |
| `VISUAL` | Trình soạn thảo ưa dùng cho các lệnh sửa cấu hình và sửa agent. |
| `EDITOR` | Dự phòng khi chưa đặt `VISUAL`. `config edit` dùng `nano` khi cả hai đều chưa đặt. |
| `LC_ALL`, `LC_CTYPE`, `LANG` | Giá trị có nhắc UTF-8 thì CLI vẽ ký hiệu tiến độ dạng Unicode, nếu không thì dùng ASCII. Ngôn ngữ lấy từ `[locale] language`, không bao giờ từ các biến này. |

`--quiet` và `--verbose` điều khiển độ chi tiết của đầu ra; không biến môi trường nào tham gia.

## Danh mục nhà cung cấp

OpenAlpha đi kèm một danh mục nhà cung cấp và mô hình. `openalpha provider list` hiện các nhà cung cấp,
`openalpha provider models` hiện mô hình và bảng giá. Cấu hình của bạn vẫn phải nêu `provider`, mã
`model` riêng của nhà cung cấp và `api_key_env` cho từng mô hình.

Một số tên tắt trong danh mục:

| Tên tắt | Phân giải thành |
|---|---|
| `claude-opus` | `anthropic / claude-opus-4-7` |
| `claude-haiku` | `anthropic / claude-haiku-4-5` |
| `claude` | `anthropic / claude-sonnet-4-6` |
| `opus` | `anthropic / claude-opus-4-7` |
| `gpt` | `openai / gpt-5.5` |
| `gpt-mini` | `openai / gpt-5-mini` |
| `o1` | `openai / o1` |
| `o3` | `openai / o3` |
| `grok` | `xai / grok-4.3` |
| `auto` | `openrouter / openrouter/auto` |
| `claude-via-openrouter` | `openrouter / anthropic/claude-sonnet-4-6` |
| `gemini-flash` | `gemini / gemini-2.5-flash` |
| `deepseek-flash` | `deepseek / deepseek-v4-flash` |
| `deepseek-pro` | `deepseek / deepseek-v4-pro` |
| `ernie` | `baidu / ernie-4.5-turbo-128k` |
| `moonshot` | `kimi / kimi-k2-turbo-preview` |
| `glm` | `zai / glm-4.6` |
| `llama` | `ollama / llama3.3:70b` |

`openalpha provider models` in ra danh sách đầy đủ.

## Chế độ phê duyệt

Chế độ phê duyệt (`manual`, `bypass` hoặc `unavailable`) được đặt theo từng phiên chạy, không đặt trong
`config.toml`. Mỗi chế độ làm gì, `remember` phủ tới đâu, và ô hỏi hiện ra thế nào trên từng bề mặt nằm
ở [An toàn](an-toan.md). Các mốc hết giờ giới hạn một ô hỏi là `[loop] approval_timeout_ms` và
`[schedule] approval_timeout_ms`.

## `[trading]`

Các mục con tùy chọn: `suggestions`, `markets`, `briefs`, `intraday`, `alerts`, `orders`, `venues`,
`refresh`, `sources`, `themes` và `typed_prices`. Khóa nào cũng có mặc định. Khóa lạ là lỗi khởi động.

```toml
[trading.suggestions]
cooldown_sessions = 0          # số phiên chờ trước khi cùng một mã được gợi ý lại; 0 = mọi phiên
debate_mode = "full"           # full: phe mua, phe bán, quản lý danh mục và người giao dịch; lean: một chuyên gia phân tích, rẻ hơn

[trading.markets.equity-vn]
holidays = ["2027-01-01"]      # ngày sàn nghỉ được công bố sau khi bản build của bạn đã ra
maximum_stop_loss = 0.08       # điểm cắt lỗ không bao giờ xa quá 8% dưới giá vào (0.02-0.30)
stop_loss_atr = 3              # khoảng cắt lỗ tính bằng số lần biên độ ngày trung bình (1-5)
reward_risk = 3                # mục tiêu bằng bao nhiêu lần khoảng rủi ro (1-5)

[trading.briefs]
send_time = "08:15"            # mặc định cho một bản gửi chưa tự đặt giờ trong chat

[trading.intraday]
send_times = []                # các mốc HH:MM theo múi giờ thị trường; rỗng = tắt (mặc định)

[trading.alerts]
breakout_range = 1.5           # một biến động phải đi bao nhiêu lần biên độ ngày trung bình thì mới báo
breakout_sessions = 14         # số phiên đã chốt dùng để đo biên độ ngày trung bình; tối thiểu 5

[trading.typed_prices]
confirm_multiple = 10          # hỏi lại trước khi lưu giá gõ lệch giá thị trường từng này lần

[trading.orders]
maximum_stake_quote = 0        # 0 = không chặn; giá trị ước tính bằng USDT trên okx và binance
maximum_open_trades = 0        # 0 = không chặn; vị thế mở cộng các lệnh chưa vào sổ; mua thêm mã đang giữ không tính là vị thế mới
maximum_price_drift = 0.005    # một phân số, không phải phần trăm: 0.005 là nửa phần trăm
allow_unattended = false       # cho phép đặt lệnh khi chế độ phê duyệt là "bypass"
require_stop_loss = true       # từ chối lệnh mua không nêu mức cắt lỗ

[trading.venues.binance]       # mọi thứ về một sàn nằm trong bảng riêng của nó
default_for = ["crypto"]       # các thị trường sàn này ghi sổ khi một dòng không nêu sàn
fees = { buy = 0.001, sell = 0.001, fee_asset = "base" }
credentials = { apiKey = "BINANCE_API_KEY", secret = "BINANCE_API_SECRET" }  # chỉ là tên biến
simulated = false              # demo-api.binance.com khi bật

[trading.venues.okx]           # có sẵn, không có thị trường mặc định; default_for = ["crypto"] sẽ lấy crypto về OKX
fees = { buy = 0.001, sell = 0.001, fee_asset = "base" }
credentials = { apiKey = "OKX_API_KEY", secret = "OKX_API_SECRET", passphrase = "OKX_API_PASSPHRASE" }
simulated = false              # đặt lệnh vào môi trường demo của sàn

[trading.venues.vps]
fees = { buy = 0.0015, sell = 0.0015, sell_tax = 0.001 }

[trading.venues.gold-shop]
fees = { buy = 0, sell = 0 }

[trading.venues.ssi]           # không có sẵn: một công ty chứng khoán bạn giao dịch bằng tay
default_for = ["equity-vn"]    # thay vps làm nơi mặc định của cổ phiếu VN
fees = { buy = 0.0015, sell = 0.0015, sell_tax = 0.001 }

[trading.refresh]
interval_ms = 43_200_000       # chỉ là trần; refresh bám theo lịch giao dịch

[trading.themes]
maximum_cost_usd = 1.0             # mức tối đa một lượt /themes được tiêu, gồm cả nghiên cứu
```

Bảng của một sàn nhận `default_for`, `markets` (chỉ sàn ghi tay), `fees` và, với OKX và Binance,
`credentials` cùng `simulated`. `okx`, `binance`, `vps` và `gold-shop` đi kèm sẵn với thị trường và mức
phí công bố như trên, nên bảng của một trong số đó chỉ nêu những gì bạn muốn đổi. `openalpha config
validate` kiểm tra tất cả những điều này.

### Công ty chứng khoán bạn giao dịch bằng tay

Mã sàn nào không có sẵn là một sàn ghi tay: nơi giữ tài sản để sổ của bạn ghi vào, và việc định tuyến
lệnh không bao giờ chọn tới. Khi đã có `[trading.venues.ssi]`, `/record deposit ssi ...` và
`/record buy ssi equity-vn:FPT ...` chạy được, và sàn hiện là `SSI`. Sàn này phải giữ ít nhất một thị
trường và phải khai `fees`:

- Thị trường của nó là `markets` nếu có, nếu không là `default_for`. Chỉ đặt `markets` cho sàn giữ một
  thị trường mà nó không phải mặc định, như công ty chứng khoán VN thứ hai bên cạnh `vps`:
  `[trading.venues.tcbs] markets = ["equity-vn"]`.
- `fees` là bắt buộc. Thiếu tỷ lệ thì mọi khoản phí ghi bằng 0 và giá vốn bị hụt, nên thiếu `fees` là
  lỗi khởi động kèm tên sàn.
- `credentials` và `simulated` bị từ chối: sàn không có bộ nối thì không có gì để chúng cấu hình.
- Sàn có sẵn không được đặt `markets`; thị trường của nó do bản build cố định.

### Sàn mặc định theo thị trường

Mặc định có sẵn: `equity-vn` ở `vps`, `gold-vn` ở `gold-shop`, `crypto` ở `binance`. Vàng thế giới
(`gold`) không có sàn nào. Nó chỉ để tham chiếu (giá vàng, và mức chênh mà `gold-vn` so với nó), nên
nhóm này luôn tắt và `/profile enable gold` bị từ chối.

`default_for` của một sàn ghi đè mặc định có sẵn của thị trường đó, và quyết định đề xuất được cân và
chấm điểm theo phí của sàn nào. Hai sàn cùng nhận một thị trường là lỗi khởi động (nêu tên cả hai);
sàn nhận thị trường mà nó không giữ cũng vậy.

Đổi sàn mặc định không chuyển những gì đã ghi. Ví dụ đặt `[trading.venues.sjc] default_for = ["gold-vn"]`:
dòng mua bán vàng mới không ghi sàn sẽ vào `sjc`, còn vàng và tiền đã ghi ở `gold-shop` vẫn nằm ở đó, vì
tài sản không chuyển được giữa các sàn. Bán phần đó thì ghi rõ sàn (`/record sell gold-shop SJC 1 145000000`),
hoặc chuyển hẳn bằng cách `/update` từng dòng cũ sang `sjc`. `gold-shop` vẫn có sẵn; chưa ghi gì ở đó thì
cứ để nguyên.

### Phí

`fees` là nguồn của mọi con số phí trong sản phẩm.

- Mỗi tỷ lệ là một **phân số của giá trị giao dịch, không bao giờ là phần trăm**: `0.0015` là mười lăm
  điểm cơ bản. Mỗi tỷ lệ bị chặn trên ở `0.05`, vì mức cao như vậy là đặt sai dấu thập phân.
- `sell_tax` là phần thuế theo luật của một lần bán, vắng mặt ở thị trường không thu khoản đó. Ở chỗ
  nào chỉ hiện một con số thì nó được gộp vào tỷ lệ bán, vì một dòng sổ chỉ mang một khoản phí, trừ
  thẳng vào tiền về.
- Phí đặt **theo sàn, không theo thị trường**. Cùng một đồng coin ở hai sàn chịu hai biểu phí, và
  `/record` đọc tỷ lệ theo đúng sàn ghi trên dòng đó.
- `fee_asset` cho biết sàn thu phí từ bên nào của một lệnh **mua**. `quote` (mặc định) tính phí vào số
  tiền chi ra và bạn nhận đủ khối lượng đã đặt. `base` lấy phí từ chính số coin, nên số về ít hơn số
  đã đặt - mặc định ở phần lớn sàn tiền mã hóa. Lệnh bán luôn bị tính phí vào tiền về, nên thiết lập
  này không bao giờ áp cho lệnh bán.
- Phần hụt coin ở sàn `base` không bao giờ được suy ra từ các tỷ lệ này, vì chỉ sàn mới biết lệnh khớp
  kiểu maker hay taker. Các tỷ lệ chỉ định giá một khoản phí bị bỏ trống, không bao giờ định ra khối
  lượng. Cách đọc khối lượng từ sàn nằm ở [Giao dịch](giao-dich.md).
- `fees` của một sàn được **thay trọn gói**, không gộp. Bản ghi đè bỏ sót một khóa mà mức có sẵn có
  (`sell_tax` với `vps`, `fee_asset` với `okx` và `binance`) bị từ chối lúc khởi động, kèm tên các khóa
  còn thiếu. Nếu không, bản ghi đè `vps` chỉ có `buy` và `sell` sẽ ghi mọi lần bán mà không có thuế.
- Các tỷ lệ đi kèm là biểu phí bán lẻ công bố: phí môi giới của VPS cộng thuế bán theo luật, và mức
  taker của OKX và Binance. Lệnh giới hạn đang treo bị tính ở mức maker, và cả hai đều sai nếu bạn ở bậc
  phí khác. Vì vậy mọi dòng xác nhận đều nêu tỷ lệ nó đã dùng.
- Một tiệm vàng (SJC, PNJ, DOJI) không thu hoa hồng, vì khoản ăn của họ là chênh lệch giữa hai giá,
  nên mặc định là 0.
- `/suggest` nêu tên công cụ chứ không nêu nơi giao dịch nó, nên dòng chi phí chỉ hiện ở thị trường mà
  đúng một sàn có thể khớp lệnh. Trung bình của hai biểu phí là con số không sàn nào thu.

### Lệnh và thông tin đăng nhập của sàn

Chỉ `[trading.orders]` quyết định một lệnh có được đặt hay không. Trần `0` là không chặn.
`maximum_price_drift` là một **phân số**: `0.5` nghĩa là năm mươi phần trăm, không phải nửa phần trăm.

`allow_unattended` có vì chế độ phê duyệt `bypass` cho một lời gọi đi qua trước khi cổng phê duyệt kịp
hỏi. Nên đặt lệnh khi không có người trông cần **hai** quyết định của bạn, không phải một; xem
[An toàn](an-toan.md).

`credentials` chứa **tên biến**, không bao giờ chứa giá trị. Tên khóa là của chính sàn: `okx` nhận `apiKey`, `secret` và `passphrase`, `binance` nhận `apiKey` và `secret`, còn trường nào khác sẽ làm khởi động dừng lại và nêu các trường sàn đó nhận. Mỗi cái được đọc
theo đúng tên biến đó, hoặc nếu không có thì đọc cùng tên với tiền tố `OPENALPHA_`. Thiếu một cái không
phải lỗi khởi động: sàn không có bộ nối, không đặt được lệnh nào, `/trade` chỉ nêu tên các khóa cần đặt,
và daemon vẫn khởi động. Sàn vẫn là nơi giữ tài sản để bạn ghi sổ lệnh; chỉ là không bao giờ được
chọn khi định tuyến.

`simulated` không phải chạy thử. Bộ nối vẫn ký, gửi và thăm dò một API thật trên môi trường demo của sàn
(`demo-api.binance.com` với Binance), nên cần khóa demo, và không có lệnh khớp nào bị bịa ra trên máy
bạn. Sàn không có môi trường demo thì bỏ qua cờ này. Những gì Binance niêm yết luôn được đọc từ bảng
thật, nên khâu sàng lọc thấy đúng thị trường thật dù ở chế độ nào. Hướng dẫn từng bước nằm ở
[Giao dịch](giao-dich.md).

### Lịch chạy và mặc định

Chỉ vòng làm mới dữ liệu có nhịp bạn đặt được: `[trading.refresh] interval_ms` (tối đa
2147483647). Nó là một **trần,
không phải chu kỳ**. Refresh bám theo giờ đóng và mở phiên của từng thị trường; khoảng này chỉ áp cho
thị trường liên tục và cho sổ đăng ký rỗng. Phần còn lại được điều nhịp theo chi phí hoặc việc chúng
canh giữ, nên không có gì để đặt:

- vòng cảnh báo (gửi tin, canh lệnh thoát và canh breakout): mỗi 60 giây;
- đối chiếu lệnh: lệnh thoát đang treo mỗi 60 giây, lệnh khớp bị sót mỗi 5 phút;
- bản tin, kết cục đề xuất, sổ yếu tố, trích xuất vĩ mô và kết cục chủ đề.

`intraday` kích hoạt ở các mốc trong `[trading.intraday] send_times`, không theo chu kỳ.

`send_time` chỉ là một **mặc định**. `/brief enable 07:30` lưu giờ riêng lên dòng gửi, và chỉ dòng nào
chưa có giờ riêng mới theo khóa này. Bản tin luôn được lập lịch theo múi giờ của **thị trường**, lấy từ
lịch của khu vực `[locale] region`, không bao giờ từ `[locale] timezone` (nơi bạn đang ở). Một operator
ở London không nhận bản tin vào 15:15 giờ Hà Nội.

Danh sách theo dõi trong hồ sơ là danh sách công cụ duy nhất được cấu hình. Bảng giá và các mục gợi ý
trong bản tin đều suy ra từ nó và từ phần đang nắm trong sổ.

Mọi vòng lặp giao dịch tự khởi động và không làm gì khi không có việc phù hợp. Ngoại lệ là đối chiếu
lệnh thoát: không có khóa sàn thì không sàn nào có bộ nối, nên không có gì đang treo để đối chiếu và
vòng đó không bao giờ được tạo. Refresh luôn phủ mọi thị trường đã đăng ký có khả năng refresh. Nêu tên
một tập con sẽ lặng lẽ bỏ sót một thị trường mà bạn vẫn đang giao dịch.

### Cấu hình không điều khiển được gì

**Không tham số chấm điểm nào cấu hình được.** Khoảng nhìn lại, ngưỡng và trọng số yếu tố nằm trong mã
cùng thị trường sở hữu chúng, nên hai bản cài cùng phiên bản chấm cùng đầu vào ra cùng một điểm. Cấu
hình quyết định cái gì chạy và khi nào, cộng ba thứ thuộc quyền bạn cân nhắc:

- **Khi nào cảnh báo ngắt lời bạn.** `[trading.alerts] breakout_range` và `breakout_sessions` đặt một mã
  trong danh sách theo dõi phải chạy bao xa thì bạn mới được báo. Nâng mức này làm cảnh báo thưa hơn và
  không đổi điểm số nào.
- **Khi nào giá bạn gõ bị hỏi lại.** `[trading.typed_prices] confirm_multiple` đặt giá trong `/record`,
  `/update` hay `/alert` phải cao hoặc thấp hơn giá gần nhất của mã bao nhiêu lần thì bạn mới được hỏi
  xác nhận (mặc định 10). Nó không đổi điểm số nào.
- **Điểm cắt lỗ và mục tiêu nằm cách bao xa.** Trong `[trading.markets.<id>]`, `maximum_stop_loss` (trần
  cứng, tính theo phần của giá vào), `stop_loss_atr` và `reward_risk` thay độ rộng cắt lỗ và bội số lợi
  nhuận của thị trường. Đặt bất kỳ khóa nào trong số đó sẽ mở một track record riêng cho thị trường ấy.
  Mức trần làm gì với mục tiêu, cỡ lệnh và điểm cắt lỗ bạn đang giữ nằm ở [Giao dịch](giao-dich.md).
  Crypto còn đặt lệnh mua chờ thấp hơn giá live nửa ATR cho mã đã tăng từ 25% trong một tuần; đó là
  chính sách của thị trường, không phải một khóa cấu hình.

**Lịch giao dịch do từng thị trường quyết định, và chỉ có một thiết lập.** Giờ phiên và ngày cuối tuần
nằm trong mã, và mỗi thị trường đi kèm bảng ngày sàn nghỉ của riêng nó. `[trading.markets.<id>]
holidays` thêm các ngày nghỉ được công bố sau khi bản build của bạn ra đời. Nó cộng thêm vào các ngày có
sẵn, không bao giờ thay thế. Một ngày rơi vào cuối tuần của chính thị trường đó là gõ nhầm và làm khởi
động thất bại. Khi bảng của một thị trường kết thúc trước năm hiện tại, lúc khởi động hệ thống cảnh báo
(`trading.holidays_outdated`).

Phiên được đếm sau khi đã xảy ra: một phiên là một ngày đã có một cây nến. Nên bước chốt kết cục và
thanh toán T+2 đọc lịch sử đã quan sát được chứ không đọc lịch dự phóng. Thanh toán chỉ quay về tính
theo ngày trong tuần khi vượt quá phiên cuối cùng đã quan sát. Chỉ bộ lập lịch bản tin nhìn về phía
trước, và nó chỉ cần một câu trả lời: phiên trước có giao dịch không?

## Khóa của nguồn dữ liệu

Endpoint, giới hạn tần suất, URL nguồn RSS, mốc hết giờ, trần byte, thời gian nghỉ của cầu dao, chính
sách thử lại và cửa sổ lưu giữ dữ liệu thị trường không phải lựa chọn của bạn. Chúng là dữ kiện của nhà
cung cấp hoặc phần chỉnh kỹ thuật bên trong, và nằm trong mã. Không cấu hình nào chuyển hướng được một
nguồn sang host khác.

Thứ duy nhất bạn đổi được là tên biến môi trường mà một nguồn đọc khóa của nó. Trong các nguồn có sẵn,
chỉ `fred` và `coingecko` cần thông tin đăng nhập, và `[trading.sources]` đổi tên biến cho một trong
hai:

```toml
[trading.sources]
coingecko = "OPENALPHA_COINGECKO_API_KEY"
```

Khóa là mã nguồn, giá trị là tên biến môi trường, không bao giờ là bí mật. Đổi tên cho nguồn không cần
thông tin đăng nhập là lỗi khởi động kèm tên nguồn đó. Nguồn nào chưa đặt biến thì đơn giản là không
được đăng ký, nên chạy không có khóa là chế độ hạn chế được hỗ trợ. Tên biến mặc định, việc rơi về tên
có tiền tố `OPENALPHA_` và cơ chế dự phòng nằm ở [Nguồn dữ liệu](nguon-du-lieu.md).

Thời gian lưu giữ dữ liệu thị trường là suy ra, không cấu hình: bằng cửa sổ bằng chứng dài nhất mà bất
kỳ thị trường đã đăng ký nào khai, quy ra ngày lịch theo quy tắc cuối tuần của chính thị trường đó,
cộng một khoảng dự phòng.

Một khối `[sources]` ở cấp cao nhất là **lỗi khởi động**. Mục nào không module nào nhận cũng vậy, giống
như một khóa lạ bên trong một mục có chủ.

## Lỗi kiểm tra

`config validate` chạy đúng các bước kiểm tra như lúc khởi động: phân tích, phân giải, rồi `[trading]`,
`[channels.*]` và mọi mục không module nào nhận. Cấu hình nó chấp nhận thì khởi động được. Xác thực và lưu cấu hình qua
API cũng dùng đúng các bước đó. Giá trị cấu hình nêu tên thị trường, sàn hay khu vực mặc định chưa đăng
ký cũng lỗi ngay ở đây, không đợi tới lần dùng đầu tiên. Khóa chưa đặt của một mô hình mà chuỗi của nó vẫn còn
mô hình khác trả lời được chỉ là cảnh báo, không làm lệnh thất bại.

Mọi lỗi đều được báo theo ngôn ngữ trong `[locale]` và nêu đúng thiết lập cần sửa. Một lần chạy liệt
kê mọi chỗ sai của tệp (hiện tối đa 8, phần còn lại báo bằng một con số), nên bạn sửa một lượt rồi mới
chạy lại. Khóa gõ sai thì được gợi ý tên gần nhất, ví dụ `max_daly_usd` gợi ý `max_daily_usd`. `config
validate` cũng đối chiếu tên nhà cung cấp trong `[[models]]` với danh mục, và báo biến môi trường của
khóa còn thiếu như một mục trong cùng danh sách thay vì dừng ở đó. `--verbose` in thêm toàn bộ danh sách
lỗi schema. Thiếu biến môi trường của khóa thì câu báo chỉ luôn lệnh lưu nó:
`openalpha key set TÊN`, giống nhau trên mọi hệ. Khóa được giữ trong `<thư mục dữ liệu>/env`, mọi
lệnh đều đọc tệp này lúc bắt đầu. Biến đặt trong môi trường luôn thắng tệp. Tệp chỉ giữ khóa dịch vụ,
kể cả khóa mang tiền tố `OPENALPHA_` như `OPENALPHA_OPENROUTER_API_KEY`: các tên điều khiển chính
OpenAlpha (`OPENALPHA_DATA_DIR`, `OPENALPHA_LOG_LEVEL`) hay cách chương trình khởi động (`PATH`,
`NODE_OPTIONS`, `LD_*`...) bị bỏ qua, và `#` sau
một dấu cách là chú thích. Tệp khóa theo `--data-dir`
hoặc `OPENALPHA_DATA_DIR`, không bao giờ theo `[paths] data_dir`, vì nó được đọc trước cấu hình. Thiếu khóa của mô hình chỉ chặn những việc cần
gọi AI: `status`, `stop`, `/price`, `/portfolio`, `/record` và các lệnh miễn phí khác vẫn chạy, còn
`openalpha start` vẫn khởi động kèm một dòng cảnh báo, chạy mọi việc không cần AI cho tới khi bạn lưu
khóa bằng `openalpha key set <TÊN>` rồi chạy `openalpha restart --background`.

```text
config.toml có chỗ cần sửa:
- `loop.max_turns`: giá trị phải lớn hơn 0
- `budget.max_daly_usd`: không phải thiết lập mình biết, có phải ý bạn là `max_daily_usd`?
Sửa xong rồi chạy lại nhé.

Chưa có ANTHROPIC_API_KEY nên model anthropic/claude-sonnet-4-6 chưa chạy được. Lưu bằng `openalpha key set ANTHROPIC_API_KEY` rồi thử lại nhé.
```
