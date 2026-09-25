import { z } from 'zod'

/** workspace.readContext's bounded projection of the focused worktree. */
export const PLUGIN_WORKSPACE_TERMINAL_LIMIT = 50
export const PLUGIN_WORKSPACE_LABEL_MAX_LENGTH = 512
export const PLUGIN_TERMINAL_ID_MAX_LENGTH = 1024
export const PLUGIN_WORKSPACE_REMOTE_LIMIT = 16
export const PLUGIN_WORKSPACE_REMOTE_NAME_MAX_LENGTH = 256
export const PLUGIN_WORKSPACE_REMOTE_URL_MAX_LENGTH = 2048

export const workspaceReadContextParams = z.object({}).strict().optional()
export const workspaceReadContextResult = z
  .object({
    branch: z.string().max(PLUGIN_WORKSPACE_LABEL_MAX_LENGTH),
    displayName: z.string().max(PLUGIN_WORKSPACE_LABEL_MAX_LENGTH),
    /** Fetch remotes of the focused worktree's repository, so a plugin can map
     *  it to its service. URLs never carry credentials; local-path remotes are
     *  omitted because they would reveal filesystem paths. */
    remotes: z
      .array(
        z
          .object({
            name: z.string().min(1).max(PLUGIN_WORKSPACE_REMOTE_NAME_MAX_LENGTH),
            url: z.string().min(1).max(PLUGIN_WORKSPACE_REMOTE_URL_MAX_LENGTH)
          })
          .strict()
      )
      .max(PLUGIN_WORKSPACE_REMOTE_LIMIT),
    /** Terminals of the focused worktree, so callers can address a specific
     *  terminal id — the API has no "active terminal" write target. */
    terminals: z
      .array(
        z
          .object({
            id: z.string().min(1).max(PLUGIN_TERMINAL_ID_MAX_LENGTH)
          })
          .strict()
      )
      .max(PLUGIN_WORKSPACE_TERMINAL_LIMIT)
  })
  .strict()
  .nullable()
