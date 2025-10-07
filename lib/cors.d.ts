export interface CorsDecision {
  requestedOrigin: string | null;
  normalizedOrigin: string | null;
  allowedOrigin: string | null;
  allowed: boolean;
  allowHeaders?: string;
}

export declare const BASE_ALLOW_HEADERS: string[];
export declare const SAFE_HEADER_REGEX: RegExp;

export declare function sanitizeOrigin(value: string | null | undefined): string | null;
export declare function normalizeOrigin(value: string | null | undefined): string | null;
export declare function getAllowedOriginsFromEnv(): string[];
export declare function resolveCorsDecision(
  originHeader?: string,
  allowList?: string[],
): CorsDecision;
export declare function buildAllowHeaders(
  req: { headers?: Record<string, any> | undefined } | null,
  baseHeaders?: string[],
): string;
export declare function resolveRequestCors(
  req: { headers?: Record<string, any> | undefined } | null,
  allowList?: string[],
): CorsDecision;
export declare function applyCorsHeaders(
  req: { headers?: Record<string, any> | undefined } | null,
  res: any,
  decision?: CorsDecision,
): CorsDecision;
export declare function ensureCors(
  req: { headers?: Record<string, any> | undefined } | null,
  res: any,
  allowList?: string[],
): CorsDecision;
export declare function handlePreflight(
  req: { headers?: Record<string, any> | undefined } | null,
  res: any,
  decision?: CorsDecision,
): CorsDecision;
export declare function respondCorsDenied(
  req: { headers?: Record<string, any> | undefined } | null,
  res: any,
  decision: CorsDecision,
  diagId: string,
): void;
export declare function withCors(
  handler: (req: any, res: any) => any | Promise<any>,
): (req: any, res: any) => Promise<any>;
