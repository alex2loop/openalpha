// How a model's own name reads on the page: its vendor prefix and routing suffix dropped, its words
// capitalised, and the few names that are not plain words written the way the vendor writes them.
const WORD_CASE: Readonly<Record<string, string>> = Object.freeze({
  gpt: 'GPT',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  llama: 'Llama',
  qwen: 'Qwen',
  glm: 'GLM',
})
const VENDOR_SEPARATOR = '/'
const ROUTING_SEPARATOR = ':'
const WORD_SEPARATOR = '-'

/** "anthropic/claude-haiku-5.5" reads "Claude Haiku 5.5" and "deepseek/deepseek-v4.1-flash" reads
 *  "DeepSeek V4.1 Flash". The web never shows a raw model id. */
export function modelDisplayName(modelId: string): string {
  const name = modelId.split(VENDOR_SEPARATOR).at(-1)?.split(ROUTING_SEPARATOR)[0] ?? modelId

  return name
    .split(WORD_SEPARATOR)
    .filter((word) => word !== '')
    .map((word) => WORD_CASE[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
