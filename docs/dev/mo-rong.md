# Mở rộng runtime

Dành cho lập trình viên nhúng OpenAlpha vào hệ thống của mình hoặc viết thêm cho nó. Chỉ cần dùng với tư
cách operator? Bắt đầu từ [mục lục tài liệu](../README.md).

Ba đường vào, từ ít việc đến nhiều việc:

- **Nhúng runtime.** Gọi `boot()` ngay trong tiến trình của bạn rồi đăng ký công cụ, agent, kênh và lệnh
  riêng. Không cần fork.
- **Viết plugin.** Thêm nội dung khai báo mà không đụng vào repo này. Mã chỉ chạy khi operator cho phép.
- **Hiểu container.** Gốc composition là một tệp duy nhất với thứ tự cố định. Hãy đọc nó **trước** khi
  thêm provider, đừng đọc sau.

---

## Bề mặt SDK

`@openalpha/runtime` là gói private trong workspace. Các export của nó vạch ranh giới được hỗ trợ giữa
các gói và những người nhúng runtime; thứ gì không được export từ một entry point là nội bộ của module.
Hợp đồng đầy đủ nằm ở [src/index.ts](../../src/index.ts).

Khai báo một công cụ, lệnh hay agent **không** tự đăng ký nó. Việc đăng ký là của gốc composition, qua các
tùy chọn phẳng của `boot` (đường dễ dùng) hoặc qua một `ServiceProvider` (lối thoát nâng cao). Phần lớn
các bản mở rộng trông giống nhau: import một hàm hỗ trợ, export định nghĩa, đưa nó cho `boot`.

```ts
import { createTool } from '@openalpha/runtime'
import { boot } from '@openalpha/runtime/app'
import { z } from 'zod'

const echoTool = createTool({
  name: 'echo',
  description: 'Return the supplied text',
  inputSchema: z.object({ text: z.string() }),
  capability: 'read',
  async execute(input) {
    return input.text
  },
})

const { app, dispose } = await boot({
  mode: 'daemon',
  env: process.env,
  shutdownSignal: AbortSignal.timeout(60_000),
  tools: [echoTool],
})
```

```ts
import { createCommand } from '@openalpha/runtime/cli'

export const helloCommand = createCommand({
  name: 'hello',
  summary: { key: 'cliHelp.commandStatusSummary' }, // một khóa trong danh mục i18n, không phải văn bản tự do
  run(_args, app) {
    app.write('hello\n')
    return 0
  },
})
```

### Các entry point

| Import | Chứa |
|---|---|
| `@openalpha/runtime` | Các hàm khai báo `create*`, `channelId`, `bindLocale`, `renderMessages`, `BRAND`, các bộ chuyển id, `scrubCredentials`, và mọi kiểu hợp đồng công khai. Cố ý chứa nhiều kiểu; hãy import kiểu bằng `import type`. Nó không khởi động gì cả |
| `@openalpha/runtime/app` | Nhúng vào tiến trình: `boot`, `main`, `passThroughBootGate`, và các kiểu `BootOptions`, `Booted`, `MainOptions` |
| `@openalpha/runtime/cli` | Các hàm dựng lệnh, khâu cho phép và thực thi, các hàm phân tích cờ và in đầu ra, `BUILT_IN_COMMANDS` |
| `@openalpha/runtime/package.json` | Siêu dữ liệu của gói |

### Các hàm hỗ trợ

| Hàm | Import từ | Mục đích |
|---|---|---|
| `createTool` | gốc | Khai báo công cụ có kiểu. Kiểm tra tên và mô tả, suy ra kiểu đầu vào của `execute` từ `inputSchema` |
| `createAgent` | gốc | Khai báo agent không đáng tin, viết bằng mã (không có trường model-tier hay reasoning) |
| `createSlashCommand` | gốc | Khai báo lệnh gạch chéo. Kiểm tra tên và cấu trúc |
| `createChannel` | gốc | Khai báo kênh. Gắn nhãn cho id và kiểm tra các hàm của adapter |
| `channelId` | gốc | Kiểm tra và gắn nhãn một mã kênh |
| `bindLocale`, `renderMessages` | gốc | Gắn danh mục `en`/`vi` vào một cặp tra `translate`/`has`; dựng đầu ra lệnh đã bản địa hóa từ cặp đó |
| `BRAND` | gốc | Định danh sản phẩm, suy ra một lần từ `productName` |
| `agentId`, `runId`, `sessionId` | gốc | Gắn nhãn chuỗi thô thành các id có kiểu |
| `scrubCredentials` | gốc | Xóa bí mật khỏi văn bản trước khi hiển thị |
| `boot`, `passThroughBootGate` | `/app` | Khởi động container. Trả về `{ app, delivery, dispose }` |
| `main` | `/app` | Entry đầy đủ: khởi động, rồi chạy CLI với provider, lệnh và cổng khởi động thêm |
| `createCommand`, `createGroup`, `createRoot` | `/cli` | Khai báo lệnh terminal, gom các lệnh con, dựng cây gốc chạy được (cây gốc tự thêm `help` và bí danh `--version`) |
| `lazyCommand` | `/cli` | Chỉ nạp module của lệnh khi nó chạy |
| `admitCommand`, `preflightCommand` | `/cli` | Cổng cho phép và cổng kiểm tra trước, bao quanh bước điều phối lệnh |
| `preBootApp`, `runCli` | `/cli` | Ứng dụng chỉ có cấu hình cho các lệnh không cần khởi động; chạy cây lệnh với argv |
| `parseGlobalFlags` | `/cli` | Phân tích cờ chung trước khi điều phối lệnh |
| `formatTerminalError`, `printError`, `usage`, `fail` | `/cli` | Đầu ra lỗi và hướng dẫn dùng ở terminal |
| `getEnv`, `isVerbose`, `stopDaemonIfRunning` | `/cli` | Hàm hỗ trợ môi trường CLI, hỗ trợ tắt dịch vụ nền (daemon) |
| `BUILT_IN_COMMANDS` | `/cli` | Sổ đăng ký chuẩn các lệnh có sẵn |

### Công cụ nhận được gì

Hàm `execute` của mọi công cụ nhận một `ToolInvocationContext` làm tham số thứ hai, chỉ thuộc về phiên
chạy đã gọi nó.

| Thành viên | Dùng để |
|---|---|
| `ctx.signal` | `AbortSignal` của phiên chạy. Hãy truyền nó cho mọi thứ có thể sống lâu hơn lời gọi |
| `ctx.logger` | Logger theo phạm vi phiên chạy; tự lọc thông tin đăng nhập |
| `ctx.locale` | `'en'` hoặc `'vi'` cho các thông báo hướng tới công cụ |
| `ctx.config` | Cấu hình đã phân giải và đóng băng |
| `ctx.workspaceDir` | Thư mục làm việc chuẩn cho shell và thao tác tệp. Không cô lập ở mức hệ điều hành |
| `ctx.childEnv` | Môi trường đã đóng băng cho tiến trình shell và tiến trình con được ủy quyền |
| `ctx.memory` | Đối tượng truy cập bộ nhớ, có lọc bí mật |
| `ctx.bus` | Bus sự kiện của phiên chạy |
| `ctx.budget` | Ngân sách dùng chung của phiên chạy; agent con được ủy quyền tính chi phí vào cùng đối tượng này |
| `ctx.callId` | Mã nhà cung cấp gán cho lời gọi này. Cùng với `ctx.runId`, đó là định danh idempotency bền vững duy nhất mà một công cụ được dùng |
| `ctx.services` | Các dịch vụ do công cụ đóng góp (declaration-merge theo từng bề mặt công cụ) |
| `ctx.deadline` | Đồng hồ thời gian của phiên chạy. Hãy tạm dừng nó khi đang chờ người dùng |
| `ctx.reportProgress` | Báo một mốc tiến độ thưa lên bề mặt cha |
| `ctx.addExternalCost`, `ctx.recordExternalCost` | Tính chi phí của một phản hồi nhà cung cấp không phải LLM vào các tổng đang chạy |

### Tạo một agent

Agent là dữ liệu (một `agent.toml` đã qua kiểm tra) hoặc mã (`createAgent`). Agent viết bằng mã có cùng
schema với `agent.toml`, theo camelCase, trừ `modelTier` và `reasoning` (một `agent.toml` của người dùng được đặt `model_tier`, agent viết bằng mã thì không bao giờ; `reasoning` chỉ dành cho agent đáng tin) và
trừ `focus` cùng `max_daily_usd` (chỉ `agent.toml` mới có). Nó luôn **không đáng tin**, ngang hàng với một
`agent.toml` của người dùng.

```ts
import { createAgent } from '@openalpha/runtime'
import { boot } from '@openalpha/runtime/app'

const researcher = createAgent({
  id: 'web-researcher',
  name: 'Web Researcher',
  description: 'Read-only web research assistant',
  systemPrompt: 'You are a focused research assistant.',
  maxTurns: 12,
  capabilities: { tools: ['web_search', 'web_fetch'] },
})

await boot({
  mode: 'daemon',
  env: process.env,
  shutdownSignal: AbortSignal.timeout(60_000),
  agents: [researcher],
})
```

`createAgent` kiểm tra id và system prompt không rỗng ngay khi bạn gọi, rồi trả về một định nghĩa đã đóng
băng. Các tham chiếu tới công cụ và agent được ủy quyền chỉ được phân giải lúc khởi động, trên các sổ
đăng ký đã dựng xong. Nhờ vậy một agent có thể cho phép những công cụ cấp trong cùng tùy chọn `tools`, và
ủy quyền cho các agent trong cùng tùy chọn `agents`. Tham chiếu không hợp lệ được báo trong đúng một lỗi
khởi động tổng hợp, không bao giờ bị bỏ qua trong im lặng.

Dạng dữ liệu là [agent.sample.toml](../../agent.sample.toml). Agent của người dùng nằm ở
`<data_dir>/agents/<id>/agent.toml`; plugin thì đưa agent vào dưới dạng `AgentProfileSource`
(`{ id, tomlPath }`). Tệp không hợp lệ bị ghi log và bỏ qua lúc khởi động. Bỏ hẳn `[capabilities]` thì
agent **không có quyền gì**: đặt `tools = "*"` để cấp cả sổ đăng ký, hoặc liệt kê tên. Hướng dẫn viết đầy
đủ ở [Agent](../tro-ly.md).

### Khởi động ứng dụng

Entry gốc không khởi động gì cả, và `createApp` là nội bộ. Entry gốc chỉ export các kiểu của container
(`App`, `Bind`, `Extend`, `ServiceProvider`, `Services`, `DaemonTask`). Người nhúng dùng `boot` và `main`
từ `@openalpha/runtime/app`.

`boot` nhận các tùy chọn mở rộng dạng phẳng rồi chuyển chúng vào phần lắp provider chuẩn. Ứng dụng vẫn là
bên duy nhất quyết định thứ tự đăng ký.

```ts
const { app, dispose } = await boot({
  mode: 'daemon',
  env: process.env,
  shutdownSignal: AbortSignal.timeout(60_000),
  tools: [myTool],
  agents: [myAgent],
  slashCommands: [myCommand],
  channels: [myChannelDefinition],
})
```

| Tùy chọn | Hạ xuống thành | Khi trùng |
|---|---|---|
| `tools` | sổ đăng ký công cụ | trùng tên công cụ thì báo lỗi |
| `agents` | sổ đăng ký agent (dựng dạng không đáng tin qua `buildAgentDefinition`) | trùng mã agent thì báo lỗi |
| `slashCommands` | bộ điều phối lệnh gạch chéo | trùng tên lệnh thì báo lỗi |
| `channels` | sổ đăng ký định nghĩa kênh | trùng mã kênh thì báo lỗi |

Mọi tùy chọn được kiểm tra **cùng lúc**: mọi vấn đề trên mọi tùy chọn được gom lại và ném ra thành
**một** `ConfigError` đã lọc thông tin đăng nhập, thay vì dừng ở lỗi đầu tiên. Công cụ mới đi qua đúng
các cổng năng lực và phê duyệt như công cụ có sẵn. Mục `channels` đăng ký **định nghĩa**; kênh chỉ thật
sự chạy khi có cấu hình operator (thông tin đăng nhập) của nó, giống các định nghĩa telegram và zalo có
sẵn.

`features` (`readonly ServiceProvider[]`) là lối thoát cho mọi thứ mà các tùy chọn phẳng không diễn đạt
được: các provider thô, xếp sau thứ tự chuẩn. Workflow do tệp và cấu hình quản lý
(`<data_dir>/workflows/`), vì kiểu `Workflow` chứa hành vi thực thi được; nên không có tùy chọn
`workflows`.

### Hợp đồng mở rộng

| Mở rộng | Hợp đồng |
|---|---|
| Công cụ | `ToolDefinition`, tạo bằng `createTool(...)` |
| Kênh | `ChannelDefinition`, tạo bằng `createChannel(...)`, sinh ra một `ChannelAdapter` |
| Agent | `AgentDefinition`, tạo bằng `createAgent(...)`, hoặc một `agent.toml` đã qua kiểm |
| Lệnh gạch chéo | `SlashCommand`, tạo bằng `createSlashCommand(...)` (`usage()` tùy chọn là thứ `/help <tên>` in ra), hoặc `DeclarativeSlashCommandSource` |
| Workflow | `WorkflowSource` (chỉ khám phá từ tệp và cấu hình) |
| Plugin | `Plugin` kèm `PluginContributions` |
| Dịch vụ giao dịch | `PortfolioService`, `MarketDataService`, `SuggestionService`, `AlertService`, `BriefService`. Phân giải từ container, không bao giờ do người nhúng tự dựng |

### Quy tắc ổn định và an toàn

- Chỉ named export. Không có default export.
- Mã giữa các module import API của module, không import tệp nội bộ.
- Plugin không đáng tin không đóng góp được công cụ hay hook thực thi được.
- Một công cụ nguy hiểm khai qua SDK **vẫn** đi qua cổng phê duyệt của engine.
- SDK export **hợp đồng và kết quả** của phần giao dịch, không bao giờ export sổ đăng ký, kho, bộ nối,
  thị trường, nguồn, giai đoạn hay hàm dựng tác vụ. Tầng composition quyết định cái gì đang hoạt động.
- `Locale` đến từ `@/core/types/locale`, nên khai kiểu theo locale không kéo theo cả danh mục ngôn ngữ.

---

## Container ứng dụng

Một ứng dụng là một container dịch vụ lắp từ các provider, cộng với trình tự khởi động nối cấu hình, log,
tài nguyên và tầng lưu trữ xung quanh nó. Container nằm ở
[src/core/container.ts](../../src/core/container.ts). Nơi duy nhất có danh sách provider đầy đủ là
[src/app/providers.ts](../../src/app/providers.ts). Người nhúng không bao giờ tự dựng container.

### Container

Mọi thứ dùng chung lúc chạy là một dịch vụ có khóa. Mỗi module declaration-merge các khóa của nó vào
interface `Services`, nên `app.resolve('tools')` được kiểm kiểu theo đúng module sở hữu. Một
`ServiceProvider` đăng ký các binding:

```ts
export const apiServiceProvider: ServiceProvider = {
  name: 'api',
  register(bind): void {
    bind('apiRoutes', () => ROUTES)
  },
}
```

- `bind(key, factory)` cài một singleton lười: factory chạy ở lần `resolve` đầu tiên và giá trị được
  cache. Bind một khóa đã bind thì ném lỗi.
- `extend(key, fn)` thêm lên một binding đã có (plugin mở rộng `tools` theo cách này). Mở rộng khóa chưa
  bind thì ném lỗi.
- `resolve` phát hiện phụ thuộc vòng và nêu tên khóa. Chỉ gọi nó **trong** `app/providers.ts` và các tệp
  `services.ts` của từng module; ở mọi nơi khác, phụ thuộc đến dưới dạng tham số của factory.
- `has(key)` kiểm tra một binding tùy chọn mà không ném lỗi.

### Thứ tự provider chuẩn

`buildProviders` đăng ký các provider theo một thứ tự cố định, vì mọi đích của `extend` đều phải đã có từ
một `bind` trước đó:

```text
logger, bus, sessionQueue (cốt lõi, inline)
storage -> tradingStores -> baseCurrencyGuard, memory -> ai -> engine -> tools
-> channels, commands -> cliCommands -> social -> đăng ký phần giao dịch
-> plugins -> mcp -> userAgents -> app -> scheduler -> bootExtensions -> liveAgents -> api
```

- `baseCurrencyGuard` (bước 2b) mở rộng các binding hồ sơ và sổ lệnh của phần giao dịch, nên đứng sau
  `tradingStores`.
- `cliCommands` (8b) là phần cơ sở rỗng mà phần giao dịch và plugin cùng mở rộng.
- `social` (8c) bind dịch vụ mạng xã hội và mở rộng sổ đăng ký công cụ cùng lệnh.
- `scheduler` (13b) bind các lệnh việc và tác vụ dịch vụ nền sau khi các binding của provider `app` đã có.
- `api` (cuối cùng) bind API HTTP/WS; dịch vụ nền chỉ khởi động nó khi `[api]` được bật.

Các ràng buộc cứng, đúng như `providers.ts` phát biểu:

- logger, bus và sessionQueue trước mọi thứ;
- storage trước các kho giao dịch, trước memory, và trước bộ theo dõi chi phí của engine;
- ai trước bộ nén của engine;
- engine trước tools và plugins;
- tools trước plugins và mcp;
- commands trước plugins;
- đăng ký phần giao dịch trước plugins;
- plugins trước mcp và userAgents;
- `cliCommands` trước phần giao dịch và plugins, vì cả hai đều mở rộng nó.

Đừng đổi thứ tự khi chưa rà hết danh sách trên. Provider mở rộng lúc khởi động (nó chuyển các tùy chọn
phẳng vào đúng chỗ) đăng ký sau các provider `app` và `scheduler`. Các provider truyền qua
`BootOptions.features` đăng ký **sau cả thứ tự chuẩn**, nên các lời gọi `extend` của chúng thấy bảng đã
lắp xong.

### Khởi động

`boot(opts)` là đường khởi động dành cho người nhúng. Theo thứ tự, nó:

1. Nạp cấu hình thô (`loadConfig`), đóng băng cấu hình đã phân giải (`resolveConfig`), và từ chối mục cấu
   hình cấp cao nào mà không module nào nhận.
2. Chạy cổng khởi động. Kết luận `stop` ném `ConfigError`; `warn` in ra `err`. Mặc định là cổng cho qua.
   Bước này chạy **trước** khi logger, cơ sở dữ liệu hay thư mục dữ liệu tồn tại.
3. Tạo thư mục dữ liệu, rồi tạo tài nguyên logging.
4. Tính môi trường con đã đóng băng **chỉ từ một danh sách cho phép**: `PATH`, `HOME`, `LANG`, `LC_ALL`,
   `TZ`, `TERM`, `TMPDIR`, `TEMP`, `TMP`. Cố ý không có danh sách chặn. Các biến chiếm quyền trình thông
   dịch (`NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, `PYTHONSTARTUP`, ...) và mọi khóa API của
   nhà cung cấp bị loại vì **không có trong danh sách**.
5. Nạp các tài nguyên runtime (server MCP, plugin đã cài, agent của người dùng, workflow của người dùng)
   và mở tầng lưu trữ.
6. Gọi `createApp(config, [createAgentLogsProvider(...), ...assembly.providers, ...features], { configPath, signal })`.
7. Chạy `assembly.assertExtensionsRegistered(app)`: buộc các dịch vụ liên quan phân giải, rồi ném
   **một** `ConfigError` đã lọc thông tin đăng nhập, liệt kê mọi vấn đề trên mọi tùy chọn phẳng.
8. Phân giải ngay các dịch vụ giao dịch và truy xuất web (bản cài sai hoặc thiếu khóa tìm kiếm báo ngay
   lúc khởi động, không đợi đến lời gọi công cụ đầu tiên), khẳng định các công cụ spawn đã được đăng ký,
   kiểm tra các quy tắc công cụ của `[social]` trên sổ đăng ký công cụ cuối cùng, trỏ logger vào sổ đăng
   ký agent, chạy bước khởi động, rồi bật nhật ký phiên chạy và nhật ký thông báo (`dispose()` dừng cả hai).

`boot()` trả về `{ app, delivery, dispose }`. Nếu khởi động lỗi, kể cả lỗi kiểm tra phần mở rộng, nó ghi
log `boot.failed`, giải phóng những gì đã lấy, rồi ném lại lỗi. `dispose()` gọi nhiều lần cũng an toàn
(mỗi lần trả về cùng một promise): nó đóng các tài nguyên MCP và tầng lưu trữ qua `Promise.allSettled`,
ghi mọi lỗi thành `boot.dispose_failed`, và đóng logger sau cùng.

| Trường `BootOptions` | Mục đích |
|---|---|
| `mode` | `'cli'` hoặc `'daemon'`. Điều khiển việc nạp trạng thái khởi động |
| `bootScope` | `'full'` (mặc định) hoặc `'persistence'`, cái sau chỉ mở tầng lưu trữ, cho các lệnh không bao giờ chạy engine |
| `startup` | `'hydrate'` (mặc định), `'migrate'` hoặc `'none'`. Làm gì với trạng thái khởi động sau khi ứng dụng đã dựng |
| `env` | Môi trường nguồn cho bộ lọc môi trường con |
| `configFile` | `'required'` (mặc định), `'optional'` hoặc `'probe'` |
| `configPath`, `dataDir`, `logLevel`, `modelSource` | Các cách ghi đè cấu hình |
| `shutdownSignal` | `AbortSignal` của ứng dụng; công cụ và dịch vụ nền truyền nó đi |
| `tools`, `agents`, `slashCommands`, `channels` | Các tùy chọn mở rộng dạng phẳng. Mọi vấn đề gom vào một `ConfigError` |
| `features` | Các `ServiceProvider` thêm, xếp sau provider mở rộng lúc khởi động |
| `bootGate` | Mặc định là cổng cho qua |
| `err`, `onLoggerResource` | Nơi nhận cảnh báo; chuyển giao tài nguyên logger để xử lý sự cố |

### Entry đầy đủ

`main(argv, opts)` là cả binary: phân tích cờ chung, khởi động, chạy cây lệnh. Binary này không truyền
tùy chọn nào. Một ứng dụng chủ nhúng runtime có thể truyền:

```ts
process.exitCode = await main(process.argv.slice(2), {
  features: [myServiceProvider], // các provider xếp sau các provider chuẩn
  extraCommands: [myCommand], // các lệnh ghép vào cây gốc
  bootGate: myBootGate, // mặc định là passThroughBootGate
})
```

Đó là toàn bộ điểm nối để mở rộng. Ứng dụng chủ thêm bề mặt của nó qua `features` và `extraCommands`,
không bao giờ bằng cách sửa danh sách chuẩn. Runtime không bao giờ import ứng dụng chủ.

### Bề mặt nhận thông báo

Ứng dụng chủ không phải kênh chat vẫn nhận được những gì dịch vụ nền đẩy ra: cảnh báo giá, chạm mức cắt lỗ,
bản tin sáng, mã biến động mạnh và kết quả việc theo lịch. Từ một trong các `features`, hãy gắn một bề
mặt dưới một mã kênh và giữ hàm gỡ để dùng khi tắt:

```ts
const detach = app.resolve('noticeSurfaces').attach(channelId('api'), {
  deliver: ({ text, notice }) => (push(text, notice) ? 'accepted' : 'unavailable'),
})
```

- `text` là câu mà kênh chat sẽ nhận. `notice` là thông báo giao dịch có kiểu đứng sau câu đó, và không có
  với kết quả việc theo lịch.
- Trả `unavailable` khi không ai đang nghe; bên gửi sẽ thử lại như với một kênh chat đang tắt.
- `accepted` nghĩa là bề mặt đã nhận tin, không phải người dùng đã đọc.
- Thông báo gửi tới kênh của bề mặt luôn đến được bề mặt đó, dù mang chat id nào. Khi không có kênh chat
  nào được gắn, thông báo không ghi địa chỉ sẽ đi tới bề mặt gắn đầu tiên, với chat id `app`.

---

## Plugin

Plugin đóng góp nội dung đã qua kiểm tra vào các sổ đăng ký chuẩn. Việc khám phá plugin là chung: nó không
biết gì về phần giao dịch hay bất kỳ gói riêng nào khác của sản phẩm. Ranh giới:
[src/plugins/api.ts](../../src/plugins/api.ts).

### Hợp đồng lúc chạy

```ts
interface Plugin {
  readonly id: string
  readonly contributions: PluginContributions
}

interface PluginContributions {
  readonly tools?: readonly ToolDefinition[]
  readonly agents?: readonly AgentProfileSource[]
  readonly slashCommands?: readonly SlashCommand[]
  readonly cliCommands?: readonly CliCommandDef[]
  readonly channels?: readonly ChannelDefinitionRef[]
  readonly workflows?: readonly WorkflowSource[]
  readonly declarativeChannels?: readonly DeclarativeChannelSource[]
  readonly declarativeSlashCommands?: readonly DeclarativeSlashCommandSource[]
  readonly externalMcpTools?: readonly McpToolSource[]
  readonly daemonTasks?: readonly DaemonTask[]
  readonly apiRoutes?: readonly ApiRouteSource[]
  readonly skillsDirs?: readonly string[]
  readonly sourceModules?: readonly PluginSourceModule[]
}
```

Gốc composition cấp các đối tượng `Plugin` đi kèm, đáng tin. Binary này truyền danh sách đi kèm rỗng
(`createPluginsProvider([], ...)` trong `app/providers.ts`), nên bên cấp chúng là ứng dụng chủ nhúng
runtime. Plugin đã cài trong hệ thống tệp được khám phá như **dữ liệu không đáng tin**.

`DaemonTask` chạy `start(signal, options?)`. `options` là `DaemonStartOptions`: `onReady` kích hoạt khi mọi hệ con
đã lên, `onHealth` báo những gì một kênh còn bỏ xuống mỗi khi nó đổi, và `previousRun` được đặt khi lần khởi động
này giành lại tệp pid của một dịch vụ nền chưa từng dừng đàng hoàng.

Phần giao dịch **không** phải plugin. Nó đăng ký trực tiếp ở bước provider số 9, trước plugin, nên plugin
không bao giờ che được công cụ, lệnh hay vai tranh luận nào của phần giao dịch. Xem
[AD-5](ben-trong.md#ad-5-phần-giao-dịch-là-một-bounded-context).

### Bố cục một plugin đã cài

```text
<plugin-dir>/<plugin-id>/
  plugin.toml
  sources.ts
  agents/
    <agent-id>/agent.toml
  workflows/
    <workflow-id>/workflow.toml
  skills/
    <skill-name>/SKILL.md
```

Có mặt là đã khai báo: thư mục hay tệp nằm đó chính là phần đóng góp. Mọi mã thư mục và mã trong manifest
đều dùng tập ký tự path-id đã kiểm tra. Khi khám phá, runtime từ chối symlink, đường dẫn không đọc được,
và đường dẫn trỏ ra ngoài gốc plugin.

`plugin.toml` gồm siêu dữ liệu tùy chọn cộng các lệnh khai báo, cấu hình kênh, và các tham chiếu tới công
cụ MCP bên ngoài:

```toml
id = "research-pack"
name = "Research Pack"
version = "1.0.0"

[[commands]]
name = "brief"
description = "Run the daily brief workflow"
target = "workflow"
workflow = "daily-brief"

[[channels]]
adapter = "telegram"

[channels.config]
markdown = true

[[tools]]
server = "research"
tool = "lookup"
```

Lệnh có `target = "agent"` thì dùng `agent` và `prompt` thay cho `workflow`. Trường lạ trong manifest làm
phép kiểm tra nghiêm ngặt thất bại. Thiếu manifest vẫn hợp lệ: khi đó plugin chỉ đóng góp các agent,
workflow và kỹ năng tìm thấy theo thư mục, cộng `sources.ts` nếu có.

### Mô hình tin cậy

| Phần đóng góp | Đi kèm (đáng tin) | Đã cài (không đáng tin) |
|---|---|---|
| Công cụ thực thi được | cho phép | không có về mặt cấu trúc |
| Lệnh gạch chéo thực thi được | cho phép | không có về mặt cấu trúc |
| Định nghĩa kênh thực thi được | cho phép | không có về mặt cấu trúc |
| Agent dạng TOML | cho phép | cho phép, kèm các hạn chế của mức không đáng tin |
| Workflow dạng TOML | cho phép | cho phép; workflow có `schedule` bị bỏ qua |
| Thư mục kỹ năng | cho phép | cho phép và bị quét an toàn |
| Lệnh và kênh khai báo | cho phép | cho phép, qua các handler do runtime sở hữu |
| Tham chiếu công cụ MCP bên ngoài | cho phép | cho phép, qua ranh giới tin cậy MCP |
| `sources.ts` cho dữ liệu thị trường | cho phép | chỉ khi `[plugins].allow_code = true` |

Việc khám phá plugin đã cài không bao giờ tạo ra công cụ hay hook thực thi được từ đĩa. Mức tin cậy đến
từ **chính đối tượng** nằm trong tập đi kèm, không từ cờ trong manifest mà một plugin có thể tự khai.

Với agent plugin không đáng tin, `tools = "*"` chỉ mở ra những công cụ **không bao giờ** cần phê duyệt.
Công cụ có `requiresApproval` ở mức lời gọi cũng bị loại, vì lúc liệt kê chưa có đầu vào nào để kiểm tra.
Agent đáng tin thì mở ra cả sổ đăng ký. Plugin không đáng tin chỉ được nạp khi
`[plugins].allow_untrusted = true`.

#### Nguồn dữ liệu thị trường (`sources.ts`)

Plugin thêm một nhà cung cấp dữ liệu thị trường bằng cách đặt `sources.ts` ở gốc plugin. Đây là phần đóng
góp **duy nhất** chạy mã plugin từ đĩa, nên cần `[plugins].allow_code = true`, một cờ **riêng**, khác với
`allow_untrusted`. Chạy mã của plugin là cấp cho nó mọi thứ tiến trình làm được. Endpoint đã khai chỉ
ràng buộc được plugin trung thực, không ràng buộc được plugin có ý xấu, nên `allow_code` là ranh giới đồng
ý còn manifest chỉ để giữ cho đúng. Khi tắt cờ này, `sourceModules` bị bỏ khỏi mọi plugin được khám phá.

Dạng của module, kênh truyền đã ghim, các quy tắc về route và cách xử lý lỗi
(`trading.plugin_source_skipped`): [Nguồn dữ liệu](./nguon-du-lieu.md).

### Chính sách khi trùng

Mỗi quy tắc do đúng một sổ đăng ký sở hữu:

- mã công cụ, lệnh gạch chéo, lệnh CLI và kênh thực thi được đều duy nhất; trùng thì ném `ConfigError`;
- plugin đã cài mà mã trùng với một plugin đi kèm thì bị loại;
- agent không đáng tin không che được một agent đã có; nó bị bỏ qua kèm cảnh báo;
- workflow có mã đã bị dùng thì bị bỏ qua kèm cảnh báo;
- trùng lệnh hoặc kênh khai báo thì giữ khai báo đầu tiên và bỏ qua cái sau kèm cảnh báo;
- các mục không hợp lệ bị bỏ qua kèm chẩn đoán đã lọc, ở nơi ranh giới cho phép nạp một phần.

Plugin không bao giờ lặng lẽ ghi đè lên thứ có sẵn.

### Cấu hình

```toml
[plugins]
allow_untrusted = false
allow_code = false
dirs = ["~/.local/share/openalpha/plugins"]
```

`allow_untrusted` cho phép nội dung khai báo từ plugin đã cài. `allow_code` là sự đồng ý riêng, hẹp hơn,
cho phép một plugin mang theo `sources.ts` thực thi được. Công cụ và hook vẫn bị cấm với plugin đã cài, dù
hai cờ này đặt thế nào.

`dirs` mặc định rỗng, nên chưa có gì được khám phá cho tới khi bạn đặt một thư mục. `plugin install` và
`plugin update` ghi vào mục đầu tiên. Đường dẫn được phân giải lúc khởi động và giá trị mặc định được áp
một lần trong cấu hình đã phân giải. Không có danh sách `enabled` theo từng plugin: đã cài chưa, có mặt
không, mức tin cậy, bước kiểm tra và các quy tắc trùng quyết định plugin dùng được hay không.

### Quản lý qua CLI

```text
openalpha plugin list
openalpha plugin install <nguồn>
openalpha plugin update <id>
openalpha plugin uninstall <id>
```

Cài và cập nhật kiểm tra mã và kênh truyền của nguồn (id dự phòng của plugin không có manifest là tên kho
của URL chuẩn hóa, không bao giờ là tên thư mục clone tạm), chép vào gốc plugin được quản lý, và không cho gỡ
các mã đi kèm. Xem `openalpha plugin --help` để biết chính xác các cờ.

### Trình tự khởi động

1. Phân giải các thư mục plugin và cấu hình mức tin cậy.
2. Khám phá các cây plugin đã cài **mà không** chạy mã plugin.
3. Phân tích manifest, agent, workflow, công cụ MCP bên ngoài và kỹ năng dưới dạng dữ liệu.
4. Tạo provider plugin với tập đi kèm và tập đã cài.
5. Mở rộng các sổ đăng ký công cụ, agent, workflow, lệnh và lệnh CLI, và bind các phần đóng góp của kênh,
   qua đúng các hàm trộn chuẩn của chúng.
6. Chỉ dựng các dịch vụ phiên chạy **sau khi** các sổ đăng ký đã hoàn chỉnh.

Thứ tự provider trong `app/providers.ts` là cố định. Bước trộn plugin không được dời ra sau lúc các bên
dùng đã lấy một sổ đăng ký.

### Thêm một plugin đi kèm

1. Tạo một đối tượng `Plugin` đã đóng băng với một mã ổn định.
2. Giữ mã thực thi trong chính module sở hữu nó và chỉ công bố hợp đồng công khai.
3. Đăng ký đối tượng đó ở tầng composition của ứng dụng.
4. Để các khâu trộn sổ đăng ký chuẩn áp quy tắc trùng và quy tắc tin cậy.
5. Không thêm công tắc riêng cho plugin nào vào bộ nạp chung.

Phần đóng góp nào cần chính sách tin cậy mới thì trước hết phải mở rộng `PluginContributions` và đường
trộn/áp duy nhất của nó.

---

## Bản đồ mã nguồn

- [src/index.ts](../../src/index.ts): barrel của SDK
- [src/app/api.ts](../../src/app/api.ts), [src/app/boot.ts](../../src/app/boot.ts), [src/app/types.ts](../../src/app/types.ts): `boot`, `main`, `BootOptions`
- [src/app/providers.ts](../../src/app/providers.ts): thứ tự provider và các ràng buộc
- [src/app/extensions.ts](../../src/app/extensions.ts): các tùy chọn phẳng được hạ xuống và kiểm tra
- [src/core/container.ts](../../src/core/container.ts): `bind`, `extend`, `resolve`, `has`
- [src/plugins/api.ts](../../src/plugins/api.ts): khám phá, cài, trộn và mức tin cậy của plugin
- [src/cli/api.ts](../../src/cli/api.ts): entry `@openalpha/runtime/cli`
- [Agent](../tro-ly.md), [Kênh](./kenh.md), [Nguồn dữ liệu](./nguon-du-lieu.md), [Bên trong](./ben-trong.md)
- [AGENTS.md](../../AGENTS.md): module DAG, quy tắc ranh giới và quy tắc viết mã
