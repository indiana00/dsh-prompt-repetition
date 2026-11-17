# Prompt repetition

Repeats the text of every new user prompt in the model request — three copies by default — so a non-reasoning model attends to the request and its constraints twice more before answering. The default follows the Google Research result in [Prompt Repetition Improves Non-Reasoning LLMs](https://arxiv.org/abs/2512.14982) (Leviathan, Kalman, and Matias, arXiv:2512.14982), which measured accuracy gains across Gemini, GPT, Claude, and DeepSeek V3 when the input prompt is repeated two or three times verbatim, without longer answers.

## What it does

- On every new user prompt, the prompt text is sent to the model `repetitions` times inside the same user message, separated by `separator`.
- The repetition is added at request assembly (`agent/pre-step`): the user message's text is repeated and nothing else changes. The message keeps its identity and source.
- A prompt containing an image or a file attachment is sent once, unchanged — an attachment is never duplicated.
- A prompt longer than `maxTextChars` is sent once, unchanged, so a huge paste cannot triple the request by accident.
- Subagent task prompts, steering messages, and queued follow-ups are ordinary user prompts and get the same treatment. Injected context from other plugins, tool results, goal rounds, and the system prompt are not repeated.

Because the repetition is part of the message the model receives, it is also part of the committed session: the transcript shows the repeated text. That is exactly what the model saw.

## Configuration

The plugin row declares these defaults; edit the row's `config` in your profile's `cordis.patch.yml` to change them:

```yaml
- id: prompt-repetition
  config:
    repetitions: 3      # total copies; 1 disables the effect, 2 matches the paper's best average
    separator: "\n\n"   # text placed between copies
    maxTextChars: 12000 # prompts with more characters are sent once; 0 removes the cap
```

| Field | Default | Meaning |
|---|---|---|
| `repetitions` | `3` | Total copies of each new user prompt, an integer from 1 through 10 |
| `separator` | `"\n\n"` | Text inserted between copies |
| `maxTextChars` | `12000` | Longest prompt text that is repeated; longer prompts are left unchanged |

Invalid configuration fails at plugin load with an explicit error instead of silently changing behavior.

## When to use it

Use it with a non-reasoning route: the reported gains are on models answering directly, and the paper found repetition neutral to slightly positive when a model is explicitly asked to think step by step. Set `repetitions: 2` for the configuration the paper found best on average; use `3` to follow the "say it three times" variant, at the cost of one more copy in every request.

## 中文說明（繁體）

這個外掛把你每條新的使用者提示，在模型請求中重複發送（預設 3 份，用空行分隔），做法對應 Google Research 的「Prompt Repetition」研究：對非推理模型，把輸入原文重複兩至三次可提升準確率，而輸出長度與延遲幾乎不變。DeepSeek V3 亦在該研究的測試模型中。

- 只重複純文字提示；含圖片或附件的提示、以及超過 `maxTextChars`（預設 12000 字元）的長提示都只發送一次。
- 因為重複是訊息本身的一部分，對話紀錄也會顯示重複後的文字（那正是模型看到的內容）。
- 想跟隨論文平均最佳的設定，可把 `repetitions` 改為 `2`。

## Limitations

- Request size grows with the prompt: `repetitions` copies of every new user prompt stay in the session history, so the same text is billed again on every later request in that session.
- The transcript shows the repeated prompt text, because the committed message is the one the model received.
- Only text-only prompts are repeated. A prompt with an image or a file attachment is sent once, even when it also has text.
- The rewriting applies to new user prompts from the moment the plugin loads; earlier messages in a resumed session keep their single copy.
- Turning the plugin off stops repetition for new prompts; history already written keeps its repeated text.
