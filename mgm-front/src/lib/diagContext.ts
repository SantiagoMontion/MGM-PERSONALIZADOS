export interface DiagContext {
  diag_id?: string;
  stage?: string;
  job_id?: string;
}

const ctx: DiagContext = {};

export function setDiagContext(partial: DiagContext) {
  Object.assign(ctx, partial);
}

export function getDiagContext(): DiagContext {
  return ctx;
}
