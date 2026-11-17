/**
 * Prompt repetition for DeepSeek Harness.
 *
 * Each newly admitted user message is rewritten so its text appears
 * `repetitions` times (3 by default) inside the same user-role message. The
 * rewrite happens in the `agent/pre-step` waterfall, after every other
 * listener has produced its decision, so the repeated text is what the model
 * request and the session log contain. Nothing else about the message changes:
 * its identity and source are preserved.
 *
 * The technique follows "Prompt Repetition Improves Non-Reasoning LLMs"
 * (Leviathan, Kalman, Matias, Google Research, arXiv:2512.14982), which reports
 * accuracy gains for non-reasoning models when the input prompt is repeated
 * verbatim, without longer outputs or materially higher latency.
 *
 * @module @local/dsh-prompt-repetition
 */

/** Plugin identity reported to the loader. */
export const name = 'prompt-repetition'

/** Configuration defaults, used when the profile row supplies no config. */
const DEFAULT_CONFIG = Object.freeze({
  repetitions: 3,
  separator: '\n\n',
  maxTextChars: 12000,
})

/** Upper bound on `repetitions`; beyond this the context cost is not worth it. */
const MAX_REPETITIONS = 10

/**
 * Build the fail-loud error raised for an invalid row config.
 * @param message - what is wrong.
 * @returns the error to throw.
 */
function invalidConfig(message) {
  return new Error(`prompt-repetition: ${message}`)
}

/**
 * Validate the profile row's `config` and fill in defaults.
 * Misconfiguration fails at plugin load with an explicit error rather than
 * silently changing behavior.
 * @param raw - the row's raw config value, or `undefined` for all defaults.
 * @returns the resolved config.
 */
function resolveConfig(raw) {
  if (raw === undefined || raw === null) return { ...DEFAULT_CONFIG }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidConfig('config must be a mapping with repetitions, separator, and maxTextChars')
  }
  const unknown = Object.keys(raw).filter(key => !Object.hasOwn(DEFAULT_CONFIG, key))
  if (unknown.length > 0) {
    throw invalidConfig(`unknown config field(s): ${unknown.join(', ')}`)
  }
  const repetitions = raw.repetitions === undefined ? DEFAULT_CONFIG.repetitions : raw.repetitions
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > MAX_REPETITIONS) {
    throw invalidConfig(`\`repetitions\` must be an integer from 1 through ${MAX_REPETITIONS}`)
  }
  const separator = raw.separator === undefined ? DEFAULT_CONFIG.separator : raw.separator
  if (typeof separator !== 'string') {
    throw invalidConfig('`separator` must be a string')
  }
  const maxTextChars = raw.maxTextChars === undefined ? DEFAULT_CONFIG.maxTextChars : raw.maxTextChars
  if (!Number.isInteger(maxTextChars) || maxTextChars < 0) {
    throw invalidConfig('`maxTextChars` must be an integer >= 0; 0 removes the cap')
  }
  return { repetitions, separator, maxTextChars }
}

/**
 * Repeat one user message's text blocks.
 *
 * Only text-only messages are rewritten. A message carrying images or files is
 * returned unchanged so an attachment is never sent more than once, and a
 * message longer than the configured cap is returned unchanged to bound the
 * request cost of very large pastes.
 * @param message - the admitted user message (immutable, identified).
 * @param config - resolved plugin config.
 * @returns the same message, or an equivalent message with repeated content.
 */
function repeatMessage(message, config) {
  const content = message.content
  if (!Array.isArray(content) || content.length === 0) return message
  let textLength = 0
  for (const block of content) {
    if (block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') {
      return message
    }
    textLength += block.text.length
  }
  if (textLength === 0) return message
  if (config.maxTextChars > 0 && textLength > config.maxTextChars) return message

  const repeated = []
  for (let copy = 0; copy < config.repetitions; copy += 1) {
    if (copy > 0) repeated.push({ type: 'text', text: config.separator })
    for (const block of content) repeated.push(block)
  }
  return { ...message, content: repeated }
}

/**
 * Install the repetition listener.
 *
 * The listener is prepended so it is the outermost `agent/pre-step` wrapper: it
 * lets every other listener (instructions context, compaction pressure, model
 * switching) decide on the original claimed batch, then rewrites only the
 * final decision. Replacing a message before they run would hide the claimed
 * messages from their identity checks.
 * @param ctx - plugin context; the listener is disposed with it.
 * @param rawConfig - the profile row's `config`.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  if (config.repetitions === 1) {
    ctx.logger?.debug?.('prompt-repetition: repetitions is 1; the plugin is active but does nothing')
    return
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision === null || typeof decision !== 'object' || decision.kind !== 'enter' || !Array.isArray(decision.messages)) {
      return decision
    }
    const claimed = Array.isArray(payload?.messages) ? payload.messages : []
    const repeatable = new Set()
    for (const message of claimed) {
      if (message !== null && typeof message === 'object' && message.source?.kind === 'user' && typeof message.id === 'string') {
        repeatable.add(message.id)
      }
    }
    if (repeatable.size === 0) return decision

    let replaced = false
    const messages = decision.messages.map((message) => {
      if (message === null || typeof message !== 'object' || !repeatable.has(message.id)) return message
      try {
        const repeated = repeatMessage(message, config)
        if (repeated === message) return message
        replaced = true
        return repeated
      } catch (error) {
        ctx.logger?.warn?.(`prompt-repetition: left a user message unchanged: ${error?.message ?? String(error)}`)
        return message
      }
    })
    return replaced ? { ...decision, messages } : decision
  }, { prepend: true })
}
