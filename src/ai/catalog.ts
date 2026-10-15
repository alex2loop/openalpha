import { CHATGPT_PROVIDER_ID } from '@/ai/auth/providers/chatgpt'
import { LLMError } from '@/core/errors'
import { NetworkPolicy } from '@/core/ssrf/network-policy'

const OPENAI_CHAT = {
  transport: 'openai_chat',
  authStyle: 'bearer',
  supportsStreamOptions: true,
  supportsTools: true,
  supportsMaxTokens: true,
} as const

const ANTHROPIC_WIRE = {
  transport: 'anthropic_messages',
  authStyle: 'api_key_header',
  supportsStreamOptions: false,
  supportsTools: true,
  supportsMaxTokens: true,
} as const

const OPENAI_RESPONSES = {
  transport: 'openai_responses',
  authStyle: 'bearer',
  supportsStreamOptions: false,
  supportsTools: true,
  supportsMaxTokens: true,
} as const

// `authStyle` names the header the API key rides in, per transport: on openai_chat, `bearer` =
// `Authorization: Bearer`, `api_key_header` = `api-key` (Azure). On anthropic_messages, `bearer` =
// `Authorization: Bearer` (third-party Anthropic-wire hosts), `api_key_header` = `x-api-key`.
export type AuthStyle = 'bearer' | 'api_key_header'
// The cloud account a provider signs in with when no API key is set.
export type CloudIdentity = 'google' | 'azure'

export type TransportKind =
  | 'anthropic_messages'
  | 'openai_chat'
  | 'openai_responses'
  | 'gemini_generate'
  | 'openrouter_decisions'

// Provider is only the first half of reasoning capability: the resolver combines this family tag
// with the exact model before it emits request fields or enables tool-turn replay.
export type ReasoningFamily =
  | 'anthropic'
  | 'deepseek'
  | 'effort'
  | 'gemini'
  | 'glm'
  | 'groq'
  | 'kimi'
  | 'mistral'
  | 'ollama'
  | 'openai'
  | 'openai_responses'
  | 'openrouter'
  | 'qwen'
  | 'wafer'
  | 'xai'

export interface ProviderEntry {
  readonly id: string
  readonly displayName: string
  readonly transport: TransportKind
  // Empty for providers whose endpoint is account-specific: set `[[models]] base_url`.
  readonly baseUrl: string
  // Empty for a provider that signs in rather than taking a key.
  readonly apiKeyEnv: string
  readonly authStyle: AuthStyle
  // Set only for providers authenticated by a user subscription rather than an API key.
  readonly authKind?: 'oauth_subscription'
  readonly identity?: CloudIdentity
  readonly supportsStreamOptions: boolean
  readonly supportsTools: boolean
  // False for hosts that reject an output cap outright rather than ignoring it.
  readonly supportsMaxTokens: boolean
  // Set for hosts that accept only alphanumeric tool-call ids of exactly this length.
  readonly toolCallIdLength?: number
  readonly defaultModel?: string
  readonly reasoning?: ReasoningFamily
}

export interface CatalogModel {
  readonly name: string
  readonly provider: string
  readonly model: string
}

// biome-ignore format: provider data table — one entry per line for readability
export const PROVIDERS = [
  { ...ANTHROPIC_WIRE, id: 'anthropic', displayName: 'Anthropic', baseUrl: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-4-6', reasoning: 'anthropic' },
  { ...OPENAI_RESPONSES, id: CHATGPT_PROVIDER_ID, displayName: 'ChatGPT (subscription)', baseUrl: 'https://chatgpt.com/backend-api/codex', apiKeyEnv: '', authKind: 'oauth_subscription', supportsMaxTokens: false, defaultModel: 'gpt-5.6-terra', reasoning: 'openai_responses' },
  { ...OPENAI_CHAT, id: 'nous', displayName: 'Nous Research', baseUrl: 'https://inference-api.nousresearch.com/v1', apiKeyEnv: 'NOUS_API_KEY' },
  { ...OPENAI_CHAT, id: 'cloudflare', displayName: 'Cloudflare Workers AI', baseUrl: '', apiKeyEnv: 'CF_API_TOKEN', supportsStreamOptions: false, supportsTools: false, defaultModel: '@cf/meta/llama-3.1-70b-instruct' },
  { ...OPENAI_CHAT, id: 'azure-openai', displayName: 'Azure OpenAI', baseUrl: '', apiKeyEnv: 'AZURE_OPENAI_API_KEY', authStyle: 'api_key_header', identity: 'azure', reasoning: 'openai' },
  { ...OPENAI_RESPONSES, id: 'azure-openai-responses', displayName: 'Azure OpenAI (Responses)', baseUrl: '', apiKeyEnv: 'AZURE_OPENAI_API_KEY', authStyle: 'api_key_header', identity: 'azure', reasoning: 'openai_responses' },
  { ...OPENAI_CHAT, id: 'vertex', displayName: 'Google Vertex AI', baseUrl: '', apiKeyEnv: '', identity: 'google' },
  // Bedrock's API keys reach Claude and the OpenAI-format models without AWS request signing.
  { ...ANTHROPIC_WIRE, id: 'bedrock', displayName: 'Amazon Bedrock', baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/anthropic', apiKeyEnv: 'AWS_BEARER_TOKEN_BEDROCK', reasoning: 'anthropic' },
  { ...OPENAI_CHAT, id: 'bedrock-openai', displayName: 'Amazon Bedrock (OpenAI API)', baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/openai/v1', apiKeyEnv: 'AWS_BEARER_TOKEN_BEDROCK', reasoning: 'effort' },
  { ...OPENAI_CHAT, id: 'openai', displayName: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-5.5', reasoning: 'openai' },
  { ...OPENAI_CHAT, id: 'openrouter', displayName: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY', defaultModel: 'deepseek/deepseek-v4.1-flash', reasoning: 'openrouter' },
  { ...OPENAI_CHAT, id: 'wafer', displayName: 'Wafer', baseUrl: 'https://pass.wafer.ai/v1', apiKeyEnv: 'WAFER_API_KEY', reasoning: 'wafer' },
  { ...OPENAI_CHAT, id: 'groq', displayName: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY', defaultModel: 'llama-3.3-70b-versatile', reasoning: 'groq' },
  { ...OPENAI_CHAT, id: 'deepseek', displayName: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-v4-flash', reasoning: 'deepseek' },
  { ...OPENAI_CHAT, id: 'mistral', displayName: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', apiKeyEnv: 'MISTRAL_API_KEY', toolCallIdLength: 9, defaultModel: 'mistral-large-latest', reasoning: 'mistral' },
  { ...OPENAI_CHAT, id: 'xai', displayName: 'xAI', baseUrl: 'https://api.x.ai/v1', apiKeyEnv: 'XAI_API_KEY', defaultModel: 'grok-4.3', reasoning: 'xai' },
  { ...OPENAI_CHAT, id: 'perplexity', displayName: 'Perplexity', baseUrl: 'https://api.perplexity.ai', apiKeyEnv: 'PERPLEXITY_API_KEY', supportsStreamOptions: false, supportsTools: false },
  { ...OPENAI_CHAT, id: 'fireworks', displayName: 'Fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', apiKeyEnv: 'FIREWORKS_API_KEY', reasoning: 'effort' },
  { ...OPENAI_CHAT, id: 'together', displayName: 'Together', baseUrl: 'https://api.together.xyz/v1', apiKeyEnv: 'TOGETHER_API_KEY' },
  { ...OPENAI_CHAT, id: 'deepinfra', displayName: 'DeepInfra', baseUrl: 'https://api.deepinfra.com/v1/openai', apiKeyEnv: 'DEEPINFRA_API_KEY', reasoning: 'effort' },
  { ...OPENAI_CHAT, id: 'hyperbolic', displayName: 'Hyperbolic', baseUrl: 'https://api.hyperbolic.xyz/v1', apiKeyEnv: 'HYPERBOLIC_API_KEY' },
  { ...OPENAI_CHAT, id: 'sambanova', displayName: 'SambaNova', baseUrl: 'https://api.sambanova.ai/v1', apiKeyEnv: 'SAMBANOVA_API_KEY' },
  { ...OPENAI_CHAT, id: 'cerebras', displayName: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', apiKeyEnv: 'CEREBRAS_API_KEY' },
  { ...OPENAI_CHAT, id: 'lambda', displayName: 'Lambda', baseUrl: 'https://api.lambdalabs.com/v1', apiKeyEnv: 'LAMBDA_API_KEY' },
  { ...OPENAI_CHAT, id: 'novita', displayName: 'Novita', baseUrl: 'https://api.novita.ai/v3/openai', apiKeyEnv: 'NOVITA_API_KEY' },
  { ...OPENAI_CHAT, id: 'gemini', displayName: 'Google Gemini', transport: 'gemini_generate', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKeyEnv: 'GOOGLE_API_KEY', defaultModel: 'gemini-2.5-flash', reasoning: 'gemini' },
  { ...OPENAI_CHAT, id: 'cohere', displayName: 'Cohere', baseUrl: 'https://api.cohere.com/compatibility/v1', apiKeyEnv: 'COHERE_API_KEY', supportsStreamOptions: false, defaultModel: 'command-r-plus' },
  { ...OPENAI_CHAT, id: 'nvidia', displayName: 'NVIDIA', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKeyEnv: 'NVIDIA_API_KEY', supportsStreamOptions: false },
  { ...OPENAI_CHAT, id: 'ollama', displayName: 'Ollama', baseUrl: 'http://localhost:11434/v1', apiKeyEnv: 'OLLAMA_API_KEY', reasoning: 'ollama' },
  { ...OPENAI_CHAT, id: 'ollama-cloud', displayName: 'Ollama Cloud', baseUrl: 'https://ollama.com/v1', apiKeyEnv: 'OLLAMA_API_KEY', reasoning: 'ollama' },
  { ...OPENAI_CHAT, id: 'requesty', displayName: 'Requesty', baseUrl: 'https://router.requesty.ai/v1', apiKeyEnv: 'REQUESTY_API_KEY' },
  { ...OPENAI_CHAT, id: 'vercel-ai-gateway', displayName: 'Vercel AI Gateway', baseUrl: 'https://ai-gateway.vercel.sh/v1', apiKeyEnv: 'AI_GATEWAY_API_KEY' },
  { ...OPENAI_CHAT, id: 'hugging-face', displayName: 'Hugging Face', baseUrl: 'https://router.huggingface.co/v1', apiKeyEnv: 'HF_TOKEN' },
  { ...OPENAI_RESPONSES, id: 'meta-ai', displayName: 'Meta AI', baseUrl: 'https://api.meta.ai/v1', apiKeyEnv: 'META_API_KEY', reasoning: 'openai_responses' },
  { ...OPENAI_RESPONSES, id: 'ramp-router', displayName: 'Ramp Router', baseUrl: 'https://api.router.com/v1', apiKeyEnv: 'RAMP_ROUTER_API_KEY', reasoning: 'openai_responses' },
  { ...OPENAI_CHAT, id: 'github-models', displayName: 'GitHub Models', baseUrl: 'https://models.github.ai/inference', apiKeyEnv: 'GITHUB_TOKEN' },
  { ...OPENAI_CHAT, id: 'kilo-code', displayName: 'Kilo Code', baseUrl: 'https://api.kilo.ai/api/gateway', apiKeyEnv: 'KILOCODE_API_KEY' },
  { ...OPENAI_CHAT, id: 'command-code', displayName: 'Command Code', baseUrl: 'https://api.commandcode.ai/provider/v1', apiKeyEnv: 'COMMANDCODE_API_KEY' },
  { ...OPENAI_CHAT, id: 'gmi', displayName: 'GMI Cloud', baseUrl: 'https://api.gmi-serving.com/v1', apiKeyEnv: 'GMI_API_KEY' },
  { ...OPENAI_CHAT, id: 'nebius', displayName: 'Nebius Token Factory', baseUrl: 'https://api.tokenfactory.nebius.com/v1', apiKeyEnv: 'NEBIUS_API_KEY', reasoning: 'effort' },
  { ...OPENAI_CHAT, id: 'upstage', displayName: 'Upstage', baseUrl: 'https://api.upstage.ai/v1', apiKeyEnv: 'UPSTAGE_API_KEY', reasoning: 'effort' },
  { ...OPENAI_CHAT, id: 'actual', displayName: 'Actual', baseUrl: 'https://api.actual.inc/v1', apiKeyEnv: 'ACTUAL_API_KEY', reasoning: 'effort' },
  { ...OPENAI_CHAT, id: 'ai21', displayName: 'AI21', baseUrl: 'https://api.ai21.com/v1', apiKeyEnv: 'AI21_API_KEY', supportsStreamOptions: false, supportsTools: false, defaultModel: 'jamba-1.5-large' },
  { ...OPENAI_CHAT, id: 'replicate', displayName: 'Replicate', baseUrl: 'https://api.replicate.com/v1/openai', apiKeyEnv: 'REPLICATE_API_TOKEN', supportsStreamOptions: false },
  { ...OPENAI_CHAT, id: 'zai', displayName: 'Z.AI', baseUrl: 'https://api.z.ai/api/paas/v4', apiKeyEnv: 'ZAI_API_KEY', defaultModel: 'glm-4.6', reasoning: 'glm' },
  { ...OPENAI_CHAT, id: 'kimi', displayName: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.ai/v1', apiKeyEnv: 'MOONSHOT_API_KEY', defaultModel: 'kimi-k2-turbo-preview', reasoning: 'kimi' },
  { ...ANTHROPIC_WIRE, id: 'kimi-code', displayName: 'Kimi Code', baseUrl: 'https://api.kimi.com/coding', apiKeyEnv: 'KIMI_CODE_API_KEY', authStyle: 'bearer' },
  { ...OPENAI_CHAT, id: 'alibaba', displayName: 'Alibaba DashScope', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'DASHSCOPE_API_KEY', defaultModel: 'qwen-plus', reasoning: 'qwen' },
  { ...OPENAI_CHAT, id: 'alibaba-coding-plan', displayName: 'Alibaba Coding Plan', baseUrl: 'https://coding-intl.dashscope.aliyuncs.com/v1', apiKeyEnv: 'ALIBABA_CODING_PLAN_API_KEY', reasoning: 'qwen' },
  { ...OPENAI_CHAT, id: 'alibaba-token-plan', displayName: 'Alibaba Token Plan', baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'ALIBABA_TOKEN_PLAN_API_KEY', reasoning: 'qwen' },
  { ...OPENAI_CHAT, id: 'arcee', displayName: 'Arcee AI', baseUrl: 'https://api.arcee.ai/api/v1', apiKeyEnv: 'ARCEE_API_KEY' },
  { ...OPENAI_CHAT, id: 'xiaomi', displayName: 'Xiaomi MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', apiKeyEnv: 'XIAOMI_API_KEY' },
  { ...OPENAI_CHAT, id: 'lmstudio', displayName: 'LM Studio', baseUrl: 'http://localhost:1234/v1', apiKeyEnv: 'LMSTUDIO_API_KEY', reasoning: 'effort' },
  // A decisions router, not a chat model: it answers questions with calibrated distributions and
  // refuses the completions endpoint. Carries no tools and no token cap, because it takes neither.
  { transport: 'openrouter_decisions', authStyle: 'bearer', supportsStreamOptions: false, supportsTools: false, supportsMaxTokens: false, id: 'openrouter-decisions', displayName: 'OpenRouter Decisions', baseUrl: 'https://openrouter.ai/api/alpha', apiKeyEnv: 'OPENROUTER_API_KEY' },
  { ...OPENAI_CHAT, id: 'vllm', displayName: 'vLLM', baseUrl: '', apiKeyEnv: 'VLLM_API_KEY', reasoning: 'effort' },
  { ...ANTHROPIC_WIRE, id: 'minimax', displayName: 'MiniMax', baseUrl: 'https://api.minimax.io/anthropic', apiKeyEnv: 'MINIMAX_API_KEY', authStyle: 'bearer' },
  { ...ANTHROPIC_WIRE, id: 'minimax-cn', displayName: 'MiniMax (CN)', baseUrl: 'https://api.minimaxi.com/anthropic', apiKeyEnv: 'MINIMAX_API_KEY', authStyle: 'bearer' },
  // China model labs (OpenAI-compatible; stream_options off until a live call confirms usage reporting).
  { ...OPENAI_CHAT, id: 'baidu', displayName: 'Baidu ERNIE (Qianfan)', baseUrl: 'https://qianfan.baidubce.com/v2', apiKeyEnv: 'QIANFAN_API_KEY', supportsStreamOptions: false, defaultModel: 'ernie-4.5-turbo-128k' },
  { ...OPENAI_CHAT, id: 'doubao', displayName: 'ByteDance Doubao (Volcengine Ark)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKeyEnv: 'ARK_API_KEY', supportsStreamOptions: false, defaultModel: 'doubao-seed-1-6-251015' },
  { ...OPENAI_CHAT, id: 'hunyuan', displayName: 'Tencent Hunyuan', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', apiKeyEnv: 'HUNYUAN_API_KEY', supportsStreamOptions: false, defaultModel: 'hunyuan-turbos-latest' },
  { ...OPENAI_CHAT, id: 'tencent-tokenhub', displayName: 'Tencent TokenHub', baseUrl: 'https://tokenhub.tencentmaas.com/v1', apiKeyEnv: 'TOKENHUB_API_KEY', reasoning: 'effort' },
  { ...OPENAI_CHAT, id: 'yi', displayName: '01.AI Yi', baseUrl: 'https://api.lingyiwanwu.com/v1', apiKeyEnv: 'YI_API_KEY', supportsStreamOptions: false, defaultModel: 'yi-lightning' },
  { ...OPENAI_CHAT, id: 'stepfun', displayName: 'StepFun', baseUrl: 'https://api.stepfun.com/v1', apiKeyEnv: 'STEPFUN_API_KEY', defaultModel: 'step-3.5-flash' },
  { ...OPENAI_CHAT, id: 'stepfun-plan', displayName: 'StepFun Step Plan', baseUrl: 'https://api.stepfun.ai/step_plan/v1', apiKeyEnv: 'STEPFUN_API_KEY' },
  { ...OPENAI_CHAT, id: 'stepfun-plan-cn', displayName: 'StepFun Step Plan (CN)', baseUrl: 'https://api.stepfun.com/step_plan/v1', apiKeyEnv: 'STEPFUN_API_KEY' },
  { ...OPENAI_CHAT, id: 'baichuan', displayName: 'Baichuan', baseUrl: 'https://api.baichuan-ai.com/v1', apiKeyEnv: 'BAICHUAN_API_KEY', supportsStreamOptions: false, defaultModel: 'Baichuan4-Turbo' },
  // iFlytek Spark's OpenAI-compatible gateway authenticates with the console HTTP service password,
  // not the legacy WebSocket key/secret pair.
  { ...OPENAI_CHAT, id: 'iflytek', displayName: 'iFlytek Spark', baseUrl: 'https://spark-api-open.xf-yun.com/v1', apiKeyEnv: 'SPARK_API_PASSWORD', supportsStreamOptions: false, defaultModel: 'generalv3.5', reasoning: 'glm' },
  // China aggregators (host DeepSeek / Qwen / GLM / Kimi etc.).
  { ...OPENAI_CHAT, id: 'siliconflow', displayName: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', apiKeyEnv: 'SILICONFLOW_API_KEY', supportsStreamOptions: false, defaultModel: 'deepseek-ai/DeepSeek-V3', reasoning: 'qwen' },
  { ...OPENAI_CHAT, id: 'modelscope', displayName: 'ModelScope', baseUrl: 'https://api-inference.modelscope.cn/v1', apiKeyEnv: 'MODELSCOPE_API_KEY', supportsStreamOptions: false, defaultModel: 'Qwen/Qwen2.5-72B-Instruct' },
  // Mainland-CN endpoints for providers already shipped internationally (inherit proven stream_options).
  { ...OPENAI_CHAT, id: 'kimi-cn', displayName: 'Moonshot Kimi (CN)', baseUrl: 'https://api.moonshot.cn/v1', apiKeyEnv: 'MOONSHOT_API_KEY', defaultModel: 'kimi-k2-turbo-preview', reasoning: 'kimi' },
  { ...OPENAI_CHAT, id: 'alibaba-cn', displayName: 'Alibaba DashScope (CN)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'DASHSCOPE_API_KEY', defaultModel: 'qwen-plus', reasoning: 'qwen' },
  { ...OPENAI_CHAT, id: 'alibaba-coding-plan-cn', displayName: 'Alibaba Coding Plan (CN)', baseUrl: 'https://coding.dashscope.aliyuncs.com/v1', apiKeyEnv: 'ALIBABA_CODING_PLAN_CN_API_KEY', reasoning: 'qwen' },
  { ...OPENAI_CHAT, id: 'alibaba-token-plan-cn', displayName: 'Alibaba Token Plan (CN)', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'ALIBABA_TOKEN_PLAN_CN_API_KEY', reasoning: 'qwen' },
  { ...OPENAI_CHAT, id: 'zhipu-cn', displayName: 'Zhipu GLM (CN)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKeyEnv: 'ZHIPU_API_KEY', defaultModel: 'glm-4.6', reasoning: 'glm' },
] as const satisfies readonly ProviderEntry[]

// biome-ignore format: catalog model data table — one entry per line for readability
export const CATALOG_MODELS = [
  { name: 'claude-opus', provider: 'anthropic', model: 'claude-opus-4-7' },
  { name: 'claude-sonnet', provider: 'anthropic', model: 'claude-sonnet-4-6' },
  { name: 'claude-haiku', provider: 'anthropic', model: 'claude-haiku-4-5' },
  { name: 'gpt', provider: 'openai', model: 'gpt-5.5' },
  { name: 'gpt-mini', provider: 'openai', model: 'gpt-5-mini' },
  { name: 'o1', provider: 'openai', model: 'o1' },
  { name: 'gpt-5.5', provider: 'openai', model: 'gpt-5.5' },
  { name: 'o3', provider: 'openai', model: 'o3' },
  { name: 'qwen', provider: 'ollama', model: 'qwen2.5:32b' },
  { name: 'llama', provider: 'ollama', model: 'llama3.3:70b' },
  { name: 'gemma', provider: 'ollama', model: 'gemma3:27b' },
  { name: 'groq-llama', provider: 'groq', model: 'llama-3.3-70b-versatile' },
  { name: 'deepseek-flash', provider: 'deepseek', model: 'deepseek-v4-flash' },
  { name: 'deepseek-pro', provider: 'deepseek', model: 'deepseek-v4-pro' },
  { name: 'mistral-large', provider: 'mistral', model: 'mistral-large-latest' },
  { name: 'grok', provider: 'xai', model: 'grok-4.3' },
  { name: 'grok-4', provider: 'xai', model: 'grok-4.3' },
  { name: 'auto', provider: 'openrouter', model: 'openrouter/auto' },
  { name: 'claude-via-openrouter', provider: 'openrouter', model: 'anthropic/claude-sonnet-4-6' },
  { name: 'gpt-via-openrouter', provider: 'openrouter', model: 'openai/gpt-5' },
  { name: 'gemini-via-openrouter', provider: 'openrouter', model: 'google/gemini-2.5-pro' },
  { name: 'gemini-flash', provider: 'gemini', model: 'gemini-2.5-flash' },
  { name: 'opus', provider: 'anthropic', model: 'claude-opus-4-7' },
  { name: 'claude', provider: 'anthropic', model: 'claude-sonnet-4-6' },
  { name: 'glm', provider: 'zai', model: 'glm-4.6' },
  { name: 'z-ai', provider: 'zai', model: 'glm-4.6' },
  { name: 'zhipu', provider: 'zai', model: 'glm-4.6' },
  { name: 'moonshot', provider: 'kimi', model: 'kimi-k2-turbo-preview' },
  { name: 'dashscope', provider: 'alibaba', model: 'qwen-plus' },
  { name: 'qwen-api', provider: 'alibaba', model: 'qwen-plus' },
  { name: 'lm-studio', provider: 'lmstudio', model: 'gpt-oss-20b' },
  { name: 'ernie', provider: 'baidu', model: 'ernie-4.5-turbo-128k' },
  { name: 'qianfan', provider: 'baidu', model: 'ernie-4.5-turbo-128k' },
  { name: 'ark', provider: 'doubao', model: 'doubao-seed-1-6-251015' },
  { name: 'volcengine', provider: 'doubao', model: 'doubao-seed-1-6-251015' },
  { name: 'spark', provider: 'iflytek', model: 'generalv3.5' },
  { name: 'glm-cn', provider: 'zhipu-cn', model: 'glm-4.6' },
  { name: 'qwen-cn', provider: 'alibaba-cn', model: 'qwen-plus' },
] as const satisfies readonly CatalogModel[]

const PROVIDER_BY_ID: ReadonlyMap<string, ProviderEntry> = new Map(
  PROVIDERS.map((entry): [string, ProviderEntry] => [entry.id, entry])
)

export function findProviderById(id: string): ProviderEntry | undefined {
  return PROVIDER_BY_ID.get(id)
}

export function providerById(id: string): ProviderEntry {
  const entry = findProviderById(id)

  if (!entry) {
    throw new LLMError('not_found', `unknown provider: "${id}"`)
  }

  return entry
}

// A subscription or a cloud account signs in instead, and a server on this machine answers without a key.
export function requiresApiKey(provider: ProviderEntry, baseUrl: string): boolean {
  return (
    provider.authKind !== 'oauth_subscription' &&
    provider.identity === undefined &&
    !NetworkPolicy.isLoopbackUrl(baseUrl)
  )
}
