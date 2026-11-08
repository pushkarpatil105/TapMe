/**
 * TapMe System Diagnostics & Telemetry Service
 *
 * Provides safe, bounded, in-memory telemetry for operational monitoring:
 * - Redirect failure tracking (token invalid, card not found, unconfigured, inactive)
 * - Authentication failures and rate-limit events
 * - API errors and database latency tracking
 * - System event ring buffer (bounded to 100 recent events)
 *
 * Strictly adheres to security rules:
 * - NEVER records passwords, password hashes, peppers, or session tokens.
 * - NEVER records raw IP addresses.
 * - Bounded memory consumption with FIFO eviction.
 */

export type EventSeverity = "info" | "warning" | "error" | "critical";
export type EventComponent = "auth" | "redirect" | "api" | "database" | "system";

export interface DiagnosticEvent {
  id: string;
  timestamp: string; // ISO 8601 UTC
  severity: EventSeverity;
  component: EventComponent;
  category: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface RedirectMetricsSummary {
  invalid_tokens: number;
  cards_not_found: number;
  unconfigured_cards: number;
  inactive_or_archived: number;
  successful_redirects: number;
  last_error_at: string | null;
}

export interface AuthMetricsSummary {
  failed_login_attempts: number;
  rate_limit_rejections: number;
  auth_service_errors: number;
  last_failure_at: string | null;
}

export interface ApiMetricsSummary {
  total_requests: number;
  csrf_rejections: number;
  forbidden_accesses: number;
  server_errors: number;
  last_error_at: string | null;
}

const MAX_EVENT_BUFFER_SIZE = 100;

class DiagnosticsTelemetryStore {
  private events: DiagnosticEvent[] = [];
  private redirectCounters = {
    invalid_tokens: 0,
    cards_not_found: 0,
    unconfigured_cards: 0,
    inactive_or_archived: 0,
    successful_redirects: 0,
    last_error_at: null as string | null,
  };

  private authCounters = {
    failed_login_attempts: 0,
    rate_limit_rejections: 0,
    auth_service_errors: 0,
    last_failure_at: null as string | null,
  };

  private apiCounters = {
    total_requests: 0,
    csrf_rejections: 0,
    forbidden_accesses: 0,
    server_errors: 0,
    last_error_at: null as string | null,
  };

  /**
   * Records a sanitized diagnostic event into the bounded ring buffer.
   */
  public recordEvent(
    severity: EventSeverity,
    component: EventComponent,
    category: string,
    message: string,
    details?: Record<string, unknown>
  ): DiagnosticEvent {
    const timestamp = new Date().toISOString();
    const event: DiagnosticEvent = {
      id: crypto.randomUUID(),
      timestamp,
      severity,
      component,
      category,
      message,
      details: details ? this.sanitizeDetails(details) : undefined,
    };

    // FIFO ring buffer
    this.events.unshift(event);
    if (this.events.length > MAX_EVENT_BUFFER_SIZE) {
      this.events.pop();
    }

    return event;
  }

  /**
   * Tracks a redirect failure or success category.
   */
  public recordRedirectMetric(
    category: "invalid_token" | "card_not_found" | "unconfigured" | "inactive" | "success",
    meta?: Record<string, unknown>
  ) {
    const now = new Date().toISOString();
    if (category === "success") {
      this.redirectCounters.successful_redirects++;
    } else {
      this.redirectCounters.last_error_at = now;
      if (category === "invalid_token") {
        this.redirectCounters.invalid_tokens++;
        this.recordEvent("warning", "redirect", "redirect.invalid_token", "Invalid token format received on redirect route", meta);
      } else if (category === "card_not_found") {
        this.redirectCounters.cards_not_found++;
        this.recordEvent("warning", "redirect", "redirect.card_not_found", "Card not found for public token", meta);
      } else if (category === "unconfigured") {
        this.redirectCounters.unconfigured_cards++;
        this.recordEvent("info", "redirect", "redirect.card_unconfigured", "Card scanned before destination configuration", meta);
      } else if (category === "inactive") {
        this.redirectCounters.inactive_or_archived++;
        this.recordEvent("info", "redirect", "redirect.card_inactive", "Inactive or archived card scanned", meta);
      }
    }
  }

  /**
   * Tracks an authentication event.
   */
  public recordAuthMetric(
    category: "failed_login" | "rate_limited" | "service_error",
    meta?: Record<string, unknown>
  ) {
    const now = new Date().toISOString();
    this.authCounters.last_failure_at = now;
    if (category === "failed_login") {
      this.authCounters.failed_login_attempts++;
      this.recordEvent("warning", "auth", "auth.login_failed", "Failed administrator/staff login attempt", meta);
    } else if (category === "rate_limited") {
      this.authCounters.rate_limit_rejections++;
      this.recordEvent("warning", "auth", "auth.rate_limited", "Login rate limit exceeded", meta);
    } else if (category === "service_error") {
      this.authCounters.auth_service_errors++;
      this.recordEvent("error", "auth", "auth.service_error", "Authentication service error encountered", meta);
    }
  }

  /**
   * Tracks API request metrics.
   */
  public recordApiMetric(
    category: "request" | "csrf_rejected" | "forbidden" | "server_error",
    meta?: Record<string, unknown>
  ) {
    const now = new Date().toISOString();
    this.apiCounters.total_requests++;
    if (category === "csrf_rejected") {
      this.apiCounters.csrf_rejections++;
      this.apiCounters.last_error_at = now;
      this.recordEvent("warning", "api", "api.csrf_rejected", "Untrusted origin or missing CSRF validation", meta);
    } else if (category === "forbidden") {
      this.apiCounters.forbidden_accesses++;
      this.apiCounters.last_error_at = now;
      this.recordEvent("warning", "api", "api.forbidden", "Role-based authorization denied", meta);
    } else if (category === "server_error") {
      this.apiCounters.server_errors++;
      this.apiCounters.last_error_at = now;
      this.recordEvent("error", "api", "api.server_error", "Internal server error occurred", meta);
    }
  }

  /**
   * Retrieves all recent events.
   */
  public getRecentEvents(limit = 50): DiagnosticEvent[] {
    return this.events.slice(0, Math.min(limit, MAX_EVENT_BUFFER_SIZE));
  }

  /**
   * Retrieves aggregated telemetry summaries.
   */
  public getSummaries() {
    return {
      redirects: { ...this.redirectCounters },
      auth: { ...this.authCounters },
      api: { ...this.apiCounters },
    };
  }

  /**
   * Clears telemetry for testing purposes.
   */
  public resetForTesting() {
    this.events = [];
    this.redirectCounters = {
      invalid_tokens: 0,
      cards_not_found: 0,
      unconfigured_cards: 0,
      inactive_or_archived: 0,
      successful_redirects: 0,
      last_error_at: null,
    };
    this.authCounters = {
      failed_login_attempts: 0,
      rate_limit_rejections: 0,
      auth_service_errors: 0,
      last_failure_at: null,
    };
    this.apiCounters = {
      total_requests: 0,
      csrf_rejections: 0,
      forbidden_accesses: 0,
      server_errors: 0,
      last_error_at: null,
    };
  }

  /**
   * Recursively sanitizes any event detail payload.
   */
  private sanitizeDetails(obj: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = new Set([
      "password",
      "password_hash",
      "passwordhash",
      "hash",
      "pepper",
      "token",
      "token_hash",
      "session",
      "cookie",
      "secret",
      "authorization",
      "ip",
      "ip_address",
      "client_ip",
    ]);

    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveKeys.has(key.toLowerCase())) {
        continue; // strictly omit
      }
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeDetails(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

// Global singleton instance for worker process
export const telemetry = new DiagnosticsTelemetryStore();

