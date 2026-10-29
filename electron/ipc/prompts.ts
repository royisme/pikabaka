import { safeHandle } from "./safeHandle"
import { getPromptOverrides, SettingsManager } from "../services/SettingsManager"
import {
  CORE_RULES,
  PROMPT_MAX_LENGTH,
  ROLE_PROMPT,
  TASK_NAMES,
  TASK_TEXT,
  rolePrompt,
  setPromptOverridesSource,
  taskText,
  type PromptPart,
  type PromptOverrides,
  type PromptsReply,
  type TaskName,
} from "../llm/prompts"

const TASK_SET = new Set<string>(TASK_NAMES)

/** The text in force and its built-in text, for one prompt. */
function part(inForce: string, builtIn: string): PromptPart {
  return { text: inForce, defaultText: builtIn, edited: inForce !== builtIn }
}

function readPrompts(): PromptsReply {
  const overrides = getPromptOverrides()
  return {
    role: part(rolePrompt(overrides), ROLE_PROMPT),
    tasks: Object.fromEntries(TASK_NAMES.map(task => [task, part(taskText(task, overrides), TASK_TEXT[task])])) as Record<TaskName, PromptPart>,
    rules: CORE_RULES,
    maxLength: PROMPT_MAX_LENGTH,
  }
}

/** A checked value: the text to store, or `null` for "no override". */
function checkedText(name: string, value: unknown, builtIn: string): { text: string | null } | { error: string } {
  if (value === null) return { text: null }
  if (typeof value !== 'string') return { error: `${name} must be text or null` }
  const text = value.trim()
  if (text.length > PROMPT_MAX_LENGTH) return { error: `${name} is longer than ${PROMPT_MAX_LENGTH} characters` }
  return { text: text === '' || text === builtIn ? null : text }
}

export function registerPromptHandlers(): void {
  // The prompt text is read at every request: a Settings edit applies to the next answer, with no restart.
  setPromptOverridesSource(getPromptOverrides)

  safeHandle("prompts:get", async () => readPrompts())

  // Every key and value is checked before anything is written; one bad entry writes nothing.
  safeHandle("prompts:set", async (_, edit: unknown) => {
    if (typeof edit !== 'object' || edit === null || Array.isArray(edit)) {
      return { success: false, error: 'Invalid prompts' }
    }
    const changes: { role?: string | null; tasks?: Partial<Record<TaskName, string | null>> } = {}
    for (const [key, value] of Object.entries(edit)) {
      if (key === 'role') {
        const checked = checkedText('role', value, ROLE_PROMPT)
        if ('error' in checked) return { success: false, error: checked.error }
        changes.role = checked.text
      } else if (key === 'tasks') {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return { success: false, error: 'tasks must be an object' }
        }
        changes.tasks = {}
        for (const [task, text] of Object.entries(value)) {
          if (!TASK_SET.has(task)) return { success: false, error: `Unknown task: ${task}` }
          const checked = checkedText(task, text, TASK_TEXT[task as TaskName])
          if ('error' in checked) return { success: false, error: checked.error }
          changes.tasks[task as TaskName] = checked.text
        }
      } else {
        return { success: false, error: `Unknown setting: ${key}` }
      }
    }

    const saved = getPromptOverrides()
    const role = 'role' in changes ? changes.role : saved.role
    const tasks: Partial<Record<TaskName, string>> = { ...(saved.tasks ?? {}) }
    for (const [task, text] of Object.entries(changes.tasks ?? {})) {
      if (text === null) delete tasks[task as TaskName]
      else tasks[task as TaskName] = text
    }
    const next: PromptOverrides = {}
    if (role) next.role = role
    if (Object.keys(tasks).length) next.tasks = tasks
    SettingsManager.getInstance().set('prompts', Object.keys(next).length ? next : undefined)
    return { success: true }
  })
}
