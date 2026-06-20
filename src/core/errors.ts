/**
 * Hades Army v0.6 - Error Handling
 * Custom error classes for the entire system
 */

export class HadesError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HadesError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, HadesError.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

export class ValidationError extends HadesError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class AuthenticationError extends HadesError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTHENTICATION_ERROR', 401);
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

export class AuthorizationError extends HadesError {
  constructor(message: string = 'Access denied') {
    super(message, 'AUTHORIZATION_ERROR', 403);
    this.name = 'AuthorizationError';
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }
}

export class NotFoundError extends HadesError {
  constructor(resource: string, id?: string | number) {
    super(
      `${resource}${id ? ` with id ${id}` : ''} not found`,
      'NOT_FOUND',
      404
    );
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ConflictError extends HadesError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export class RateLimitError extends HadesError {
  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 'RATE_LIMIT', 429, retryAfter ? { retryAfter } : undefined);
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class ProviderError extends HadesError {
  public readonly provider: string;

  constructor(provider: string, message: string, code: string = 'PROVIDER_ERROR') {
    super(message, code, 502, { provider });
    this.name = 'ProviderError';
    this.provider = provider;
    Object.setPrototypeOf(this, ProviderError.prototype);
  }
}

export class LLMError extends HadesError {
  public readonly provider: string;
  public readonly model?: string;

  constructor(
    provider: string,
    message: string,
    model?: string,
    code: string = 'LLM_ERROR'
  ) {
    super(message, code, 502, { provider, model });
    this.name = 'LLMError';
    this.provider = provider;
    this.model = model;
    Object.setPrototypeOf(this, LLMError.prototype);
  }
}

export class GitHubError extends HadesError {
  public readonly status?: number;

  constructor(message: string, status?: number) {
    super(message, 'GITHUB_ERROR', status || 502, { status });
    this.name = 'GitHubError';
    this.status = status;
    Object.setPrototypeOf(this, GitHubError.prototype);
  }
}

export class SecretDetectedError extends HadesError {
  public readonly secrets: Array<{ type: string; file: string; line: number }>;

  constructor(secrets: Array<{ type: string; file: string; line: number }>) {
    super(
      `Secret scan detected ${secrets.length} potential secret(s)`,
      'SECRET_DETECTED',
      400,
      { secrets }
    );
    this.name = 'SecretDetectedError';
    this.secrets = secrets;
    Object.setPrototypeOf(this, SecretDetectedError.prototype);
  }
}

export class RecoveryError extends HadesError {
  constructor(message: string) {
    super(message, 'RECOVERY_ERROR', 500);
    this.name = 'RecoveryError';
    Object.setPrototypeOf(this, RecoveryError.prototype);
  }
}

export class ContextOverflowError extends HadesError {
  constructor(currentTokens: number, maxTokens: number) {
    super(
      `Context overflow: ${currentTokens} tokens exceeds maximum ${maxTokens}`,
      'CONTEXT_OVERFLOW',
      413,
      { currentTokens, maxTokens }
    );
    this.name = 'ContextOverflowError';
    Object.setPrototypeOf(this, ContextOverflowError.prototype);
  }
}

export function isHadesError(error: unknown): error is HadesError {
  return error instanceof HadesError;
}

export function handleError(error: unknown): Response {
  if (isHadesError(error)) {
    return new Response(JSON.stringify(error.toJSON()), {
      status: error.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const unknownError = new HadesError(
    error instanceof Error ? error.message : 'Unknown error occurred',
    'INTERNAL_ERROR',
    500,
    { originalError: String(error) }
  );

  return new Response(JSON.stringify(unknownError.toJSON()), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}
