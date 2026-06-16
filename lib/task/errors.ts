export interface TaskErrorPayload {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export class TaskCommandError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TaskCommandError";
    this.code = code;
    this.details = details;
  }

  toPayload(): TaskErrorPayload {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function toTaskErrorPayload(error: unknown): TaskErrorPayload {
  if (error instanceof TaskCommandError) {
    return error.toPayload();
  }
  return {
    error: {
      code: "TASK_COMMAND_FAILED",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}
