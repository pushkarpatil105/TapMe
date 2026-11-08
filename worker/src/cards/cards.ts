import type {
  AppEnv,
  Card,
  CardLink,
  CreateCardInput,
  CreateLinkInput,
  LinkPlatform,
  QrType,
  UpdateCardInput,
} from "../types";

export const ALLOWED_PLATFORMS = new Set<LinkPlatform>([
  "google_reviews",
  "instagram",
  "whatsapp",
  "other",
]);

export const ALLOWED_QR_TYPES = new Set<QrType>([
  "google_review",
  "instagram",
  "whatsapp",
  "all_in_one",
]);

export const DEFAULT_LABELS: Record<LinkPlatform, string> = {
  google_reviews: "Google Reviews",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  other: "Website",
};

export function formatCardNumber(cardNumber: number): string {
  return String(cardNumber).padStart(3, "0");
}

export function generatePublicToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function isValidDestinationUrl(urlStr: string): boolean {
  if (typeof urlStr !== "string") return false;
  const trimmed = urlStr.trim();
  if (!trimmed || trimmed.length > 2048) return false;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Strips URL query parameters and fragments that may contain access tokens,
 * tracking identifiers, or other sensitive runtime values before writing to audit logs.
 * Preserves the protocol, host, port, and path.
 */
export function sanitizeUrlForAudit(rawUrl: string): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return "";
  }

  try {
    const parsed = new URL(rawUrl.trim());
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return rawUrl.trim().split(/[?#]/)[0];
  }
}

/**
 * Sanitizes link metadata for safe storage in audit logs, preserving platform,
 * label, display order, enabled status, and sanitizing the destination URL.
 */
export function sanitizeLinkForAudit<T extends {
  platform: LinkPlatform;
  label: string;
  destination_url: string;
  display_order: number;
  is_enabled: boolean;
}>(link: T): {
  platform: LinkPlatform;
  label: string;
  destination_url: string;
  display_order: number;
  is_enabled: boolean;
} {
  return {
    platform: link.platform,
    label: link.label,
    destination_url: sanitizeUrlForAudit(link.destination_url),
    display_order: link.display_order,
    is_enabled: Boolean(link.is_enabled),
  };
}

interface ValidatedLink {
  platform: LinkPlatform;
  label: string;
  destination_url: string;
  display_order: number;
  is_enabled: boolean;
}

export function validateLinksInput(
  links: unknown,
): { valid: true; links: ValidatedLink[] } | { valid: false; error: string } {
  if (!Array.isArray(links)) {
    return { valid: false, error: "'links' must be an array." };
  }

  if (links.length > 20) {
    return { valid: false, error: "A card cannot have more than 20 destination links." };
  }

  const validated: ValidatedLink[] = [];
  const seenUrls = new Set<string>();
  const seenUniquePlatforms = new Set<string>();

  for (let i = 0; i < links.length; i++) {
    const item = links[i];

    if (!item || typeof item !== "object") {
      return { valid: false, error: `Link at index ${i} must be an object.` };
    }

    const { platform, destination_url, label, display_order, is_enabled } =
      item as Record<string, unknown>;

    if (
      typeof platform !== "string" ||
      !ALLOWED_PLATFORMS.has(platform as LinkPlatform)
    ) {
      return {
        valid: false,
        error: `Link at index ${i} has invalid platform '${String(platform)}'. Allowed: google_reviews, instagram, whatsapp, other.`,
      };
    }

    const typedPlatform = platform as LinkPlatform;

    if (typeof destination_url !== "string" || !isValidDestinationUrl(destination_url)) {
      return {
        valid: false,
        error: `Link at index ${i} must have a valid http/https destination_url (max 2048 chars).`,
      };
    }

    const cleanUrl = destination_url.trim();
    const normalizedUrl = cleanUrl.toLowerCase();

    if (seenUrls.has(normalizedUrl)) {
      return {
        valid: false,
        error: `Duplicate destination URL '${cleanUrl}' at index ${i}.`,
      };
    }
    seenUrls.add(normalizedUrl);

    if (typedPlatform !== "other") {
      if (seenUniquePlatforms.has(typedPlatform)) {
        return {
          valid: false,
          error: `Multiple '${typedPlatform}' links are not allowed. Each card may have at most one ${DEFAULT_LABELS[typedPlatform]}.`,
        };
      }
      seenUniquePlatforms.add(typedPlatform);
    }

    let finalLabel = DEFAULT_LABELS[typedPlatform];
    if (typeof label === "string" && label.trim()) {
      if (label.trim().length > 100) {
        return {
          valid: false,
          error: `Link label at index ${i} exceeds 100 characters.`,
        };
      }
      finalLabel = label.trim();
    }

    let finalDisplayOrder = i;
    if (typeof display_order === "number") {
      if (!Number.isInteger(display_order) || display_order < 0) {
        return {
          valid: false,
          error: `Link display_order at index ${i} must be a non-negative integer.`,
        };
      }
      finalDisplayOrder = display_order;
    }

    let finalIsEnabled = true;
    if (typeof is_enabled === "boolean") {
      finalIsEnabled = is_enabled;
    } else if (is_enabled !== undefined) {
      return {
        valid: false,
        error: `Link is_enabled at index ${i} must be a boolean.`,
      };
    }

    validated.push({
      platform: typedPlatform,
      label: finalLabel,
      destination_url: cleanUrl,
      display_order: finalDisplayOrder,
      is_enabled: finalIsEnabled,
    });
  }

  return { valid: true, links: validated };
}

export function validateLinksForQrType(
  qrType: QrType,
  validatedLinks: ValidatedLink[],
): { valid: true } | { valid: false; error: string } {
  if (validatedLinks.length === 0) {
    return { valid: true };
  }

  if (qrType === "google_review") {
    if (validatedLinks.length > 1) {
      return {
        valid: false,
        error: "google_review cards allow at most 1 destination link.",
      };
    }
    if (validatedLinks[0].platform !== "google_reviews") {
      return {
        valid: false,
        error: `Link platform must be 'google_reviews' for google_review cards (received '${validatedLinks[0].platform}').`,
      };
    }
  } else if (qrType === "instagram") {
    if (validatedLinks.length > 1) {
      return {
        valid: false,
        error: "instagram cards allow at most 1 destination link.",
      };
    }
    if (validatedLinks[0].platform !== "instagram") {
      return {
        valid: false,
        error: `Link platform must be 'instagram' for instagram cards (received '${validatedLinks[0].platform}').`,
      };
    }
  } else if (qrType === "whatsapp") {
    if (validatedLinks.length > 1) {
      return {
        valid: false,
        error: "whatsapp cards allow at most 1 destination link.",
      };
    }
    if (validatedLinks[0].platform !== "whatsapp") {
      return {
        valid: false,
        error: `Link platform must be 'whatsapp' for whatsapp cards (received '${validatedLinks[0].platform}').`,
      };
    }
  } else if (qrType === "all_in_one") {
    if (validatedLinks.length > 20) {
      return {
        valid: false,
        error: "A card cannot have more than 20 destination links.",
      };
    }
  }

  return { valid: true };
}

interface RawCardRow {
  card_number: number;
  public_token: string;
  business_name: string;
  location: string | null;
  status: "active" | "inactive" | "archived";
  qr_type: QrType;
  configured_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string | null;
  total_scans: number;
}

interface RawLinkRow {
  id: string;
  card_number: number;
  platform: LinkPlatform;
  label: string;
  destination_url: string;
  display_order: number;
  is_enabled: number;
  created_at: string;
}

function mapCardRow(row: RawCardRow): Card {
  return {
    card_number: row.card_number,
    formatted_card_number: formatCardNumber(row.card_number),
    public_token: row.public_token,
    business_name: row.business_name,
    location: row.location,
    status: row.status,
    qr_type: row.qr_type,
    configured_at: row.configured_at,
    is_configured: row.configured_at !== null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    updated_by: row.updated_by,
    total_scans: Number(row.total_scans || 0),
  };
}

function mapLinkRow(row: RawLinkRow): CardLink {
  return {
    id: row.id,
    card_number: row.card_number,
    platform: row.platform,
    label: row.label,
    destination_url: row.destination_url,
    display_order: row.display_order,
    is_enabled: Boolean(row.is_enabled),
    created_at: row.created_at,
  };
}

export async function createCard(
  env: AppEnv,
  adminId: string,
  input: CreateCardInput,
  rawBody: Record<string, unknown>,
): Promise<{ success: true; card: Card } | { success: false; error: string; status: number }> {
  // Reject prohibited fields
  if ("card_number" in rawBody || "public_token" in rawBody) {
    return {
      success: false,
      error: "card_number and public_token are generated automatically and cannot be provided in the request body.",
      status: 400,
    };
  }

  if (
    "status" in rawBody ||
    "created_at" in rawBody ||
    "updated_at" in rawBody ||
    "configured_at" in rawBody ||
    "is_configured" in rawBody
  ) {
    return {
      success: false,
      error: "status and timestamps cannot be set directly during card creation.",
      status: 400,
    };
  }

  const { business_name, location, qr_type, links } = input;

  if (
    typeof business_name !== "string" ||
    !business_name.trim() ||
    business_name.trim().length > 200
  ) {
    return {
      success: false,
      error: "business_name is required and must be between 1 and 200 characters.",
      status: 400,
    };
  }

  if (
    typeof qr_type !== "string" ||
    !ALLOWED_QR_TYPES.has(qr_type as QrType)
  ) {
    return {
      success: false,
      error: "qr_type is required. Allowed values: google_review, instagram, whatsapp, all_in_one.",
      status: 400,
    };
  }

  let cleanLocation: string | null = null;
  if (location !== undefined && location !== null) {
    if (typeof location !== "string" || location.trim().length > 200) {
      return {
        success: false,
        error: "location must be a string up to 200 characters.",
        status: 400,
      };
    }
    cleanLocation = location.trim() || null;
  }

  let validatedLinks: ValidatedLink[] = [];
  if (links !== undefined) {
    const linkValidation = validateLinksInput(links);
    if (!linkValidation.valid) {
      return { success: false, error: linkValidation.error, status: 400 };
    }
    validatedLinks = linkValidation.links;
  }

  // Validate platform constraints against qr_type
  const qrValidation = validateLinksForQrType(qr_type as QrType, validatedLinks);
  if (!qrValidation.valid) {
    return { success: false, error: qrValidation.error, status: 400 };
  }

  const publicToken = generatePublicToken();
  const batchStatements: D1PreparedStatement[] = [];

  // 1. Insert card
  batchStatements.push(
    env.DB.prepare(
      `INSERT INTO cards (public_token, business_name, location, status, qr_type, configured_at, created_by, updated_by)
       VALUES (?, ?, ?, 'active', ?, CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE NULL END, ?, ?)`
    ).bind(
      publicToken,
      business_name.trim(),
      cleanLocation,
      qr_type,
      validatedLinks.length,
      adminId,
      adminId
    )
  );

  // 2. Insert links referencing the card's generated card_number atomically via subquery
  for (let i = 0; i < validatedLinks.length; i++) {
    const link = validatedLinks[i];
    batchStatements.push(
      env.DB.prepare(
        `INSERT INTO card_links (id, card_number, platform, label, destination_url, display_order, is_enabled)
         VALUES (?, (SELECT card_number FROM cards WHERE public_token = ?), ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        publicToken,
        link.platform,
        link.label,
        link.destination_url,
        link.display_order,
        link.is_enabled ? 1 : 0
      )
    );
  }

  // 3. Insert audit log atomically
  const auditLogId = crypto.randomUUID();
  const creationDetails = JSON.stringify({
    business_name: business_name.trim(),
    location: cleanLocation,
    qr_type,
    is_configured: validatedLinks.length > 0,
    links_count: validatedLinks.length,
    links: validatedLinks.map(sanitizeLinkForAudit),
  });

  batchStatements.push(
    env.DB.prepare(
      `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details, created_at)
       SELECT ?, ?, 'card.created', 'card', CAST(card_number AS TEXT), json_set(?, '$.card_number', card_number), CURRENT_TIMESTAMP
       FROM cards
       WHERE public_token = ?`
    ).bind(
      auditLogId,
      adminId,
      creationDetails,
      publicToken
    )
  );

  try {
    await env.DB.batch(batchStatements);
  } catch (err: unknown) {
    console.error("Failed to insert card atomically:", err);
    return {
      success: false,
      error: "Database error while creating card and links.",
      status: 500,
    };
  }

  const createdCard = await getCardByIdOrToken(env, publicToken);
  if (!createdCard) {
    return {
      success: false,
      error: "Card creation could not be verified.",
      status: 500,
    };
  }

  return { success: true, card: createdCard };
}

export async function listCards(
  env: AppEnv,
  page = 1,
  limit = 20,
  statusFilter?: string | null,
): Promise<{
  cards: Card[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}> {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(100, Math.max(1, limit));
  const offset = (safePage - 1) * safeLimit;

  let countSql: string;
  let querySql: string;
  let countParams: unknown[] = [];
  let queryParams: unknown[] = [];

  if (statusFilter && ["active", "inactive", "archived"].includes(statusFilter)) {
    countSql = "SELECT COUNT(*) AS total FROM cards WHERE status = ?";
    countParams = [statusFilter];

    querySql = `SELECT
       cards.card_number,
       cards.public_token,
       cards.business_name,
       cards.location,
       cards.status,
       cards.qr_type,
       cards.configured_at,
       cards.created_at,
       cards.updated_at,
       cards.created_by,
       cards.updated_by,
       COUNT(scan_events.id) AS total_scans
     FROM cards
     LEFT JOIN scan_events ON scan_events.card_number = cards.card_number
     WHERE cards.status = ?
     GROUP BY cards.card_number
     ORDER BY cards.card_number DESC
     LIMIT ? OFFSET ?`;
    queryParams = [statusFilter, safeLimit, offset];
  } else {
    // Default listing excludes archived cards
    countSql = "SELECT COUNT(*) AS total FROM cards WHERE status != 'archived'";

    querySql = `SELECT
       cards.card_number,
       cards.public_token,
       cards.business_name,
       cards.location,
       cards.status,
       cards.qr_type,
       cards.configured_at,
       cards.created_at,
       cards.updated_at,
       cards.created_by,
       cards.updated_by,
       COUNT(scan_events.id) AS total_scans
     FROM cards
     LEFT JOIN scan_events ON scan_events.card_number = cards.card_number
     WHERE cards.status != 'archived'
     GROUP BY cards.card_number
     ORDER BY cards.card_number DESC
     LIMIT ? OFFSET ?`;
    queryParams = [safeLimit, offset];
  }

  const countStmt =
    countParams.length > 0
      ? env.DB.prepare(countSql).bind(...countParams)
      : env.DB.prepare(countSql);

  const countResult = await countStmt.first<{ total: number }>();
  const total = Number(countResult?.total || 0);
  const totalPages = Math.ceil(total / safeLimit) || 1;

  const rows = await env.DB.prepare(querySql)
    .bind(...queryParams)
    .all<RawCardRow>();

  const cards = (rows.results || []).map(mapCardRow);

  return {
    cards,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      total_pages: totalPages,
    },
  };
}

export async function getCardByIdOrToken(
  env: AppEnv,
  identifier: string | number,
): Promise<Card | null> {
  const isNumeric =
    typeof identifier === "number" ||
    (typeof identifier === "string" && /^\d+$/.test(identifier.trim()));

  let cardRow: RawCardRow | null = null;

  if (isNumeric) {
    const cardNumber = typeof identifier === "number" ? identifier : parseInt(identifier.trim(), 10);
    cardRow = await env.DB.prepare(
      `SELECT
         cards.card_number,
         cards.public_token,
         cards.business_name,
         cards.location,
         cards.status,
         cards.qr_type,
         cards.configured_at,
         cards.created_at,
         cards.updated_at,
         cards.created_by,
         cards.updated_by,
         COUNT(scan_events.id) AS total_scans
       FROM cards
       LEFT JOIN scan_events ON scan_events.card_number = cards.card_number
       WHERE cards.card_number = ?
       GROUP BY cards.card_number
       LIMIT 1`
    )
      .bind(cardNumber)
      .first<RawCardRow>();
  } else {
    const token = String(identifier).trim();
    cardRow = await env.DB.prepare(
      `SELECT
         cards.card_number,
         cards.public_token,
         cards.business_name,
         cards.location,
         cards.status,
         cards.qr_type,
         cards.configured_at,
         cards.created_at,
         cards.updated_at,
         cards.created_by,
         cards.updated_by,
         COUNT(scan_events.id) AS total_scans
       FROM cards
       LEFT JOIN scan_events ON scan_events.card_number = cards.card_number
       WHERE cards.public_token = ?
       GROUP BY cards.card_number
       LIMIT 1`
    )
      .bind(token)
      .first<RawCardRow>();
  }

  if (!cardRow) {
    return null;
  }

  const card = mapCardRow(cardRow);

  const linksRows = await env.DB.prepare(
    `SELECT id, card_number, platform, label, destination_url, display_order, is_enabled, created_at
     FROM card_links
     WHERE card_number = ?
     ORDER BY display_order ASC, created_at ASC`
  )
    .bind(card.card_number)
    .all<RawLinkRow>();

  card.links = (linksRows.results || []).map(mapLinkRow);

  return card;
}

export async function updateCard(
  env: AppEnv,
  identifier: string | number,
  adminId: string,
  input: UpdateCardInput,
  rawBody: Record<string, unknown>,
  userRole?: "main_admin" | "staff",
): Promise<{ success: true; card: Card } | { success: false; error: string; status: number }> {
  // Reject attempt to modify permanent card_number, public_token, or qr_type
  if ("card_number" in rawBody || "public_token" in rawBody || "qr_type" in rawBody) {
    return {
      success: false,
      error: "card_number, public_token, and qr_type are permanent and cannot be modified.",
      status: 400,
    };
  }

  if (
    "id" in rawBody ||
    "created_at" in rawBody ||
    "created_by" in rawBody ||
    "status" in rawBody ||
    "configured_at" in rawBody ||
    "is_configured" in rawBody
  ) {
    return {
      success: false,
      error: "System identifiers and status cannot be modified via this endpoint.",
      status: 400,
    };
  }

  // Determine effective user role
  let effectiveRole = userRole;
  if (!effectiveRole) {
    const adminRow = await env.DB.prepare("SELECT role FROM admins WHERE id = ?")
      .bind(adminId)
      .first<{ role: "main_admin" | "staff" }>();
    effectiveRole = adminRow?.role || "main_admin";
  }

  // Retrieve current card
  const existingCard = await getCardByIdOrToken(env, identifier);
  if (!existingCard) {
    return {
      success: false,
      error: "Card not found.",
      status: 404,
    };
  }

  if (existingCard.status === "archived") {
    return {
      success: false,
      error: "Archived cards cannot be edited. Please restore the card first.",
      status: 400,
    };
  }

  // Staff permission rule: Staff cannot edit cards once configured_at is non-null
  if (effectiveRole === "staff" && existingCard.configured_at !== null) {
    return {
      success: false,
      error: "Staff members are not permitted to edit already-configured cards.",
      status: 403,
    };
  }

  const { business_name, location, links } = input;

  if (
    business_name === undefined &&
    location === undefined &&
    links === undefined
  ) {
    return {
      success: false,
      error: "At least one editable field (business_name, location, or links) must be provided.",
      status: 400,
    };
  }

  let finalBusinessName = existingCard.business_name;
  if (business_name !== undefined) {
    if (
      typeof business_name !== "string" ||
      !business_name.trim() ||
      business_name.trim().length > 200
    ) {
      return {
        success: false,
        error: "business_name must be a non-empty string up to 200 characters.",
        status: 400,
      };
    }
    finalBusinessName = business_name.trim();
  }

  let finalLocation = existingCard.location;
  if (location !== undefined) {
    if (location === null || location === "") {
      finalLocation = null;
    } else if (typeof location === "string" && location.trim().length <= 200) {
      finalLocation = location.trim();
    } else {
      return {
        success: false,
        error: "location must be a string up to 200 characters or null.",
        status: 400,
      };
    }
  }

  // Handle links update
  let validatedLinks: ValidatedLink[] | null = null;
  if (links !== undefined) {
    const linkValidation = validateLinksInput(links);
    if (!linkValidation.valid) {
      return { success: false, error: linkValidation.error, status: 400 };
    }
    const qrValidation = validateLinksForQrType(existingCard.qr_type, linkValidation.links);
    if (!qrValidation.valid) {
      return { success: false, error: qrValidation.error, status: 400 };
    }
    validatedLinks = linkValidation.links;
  }

  // Staff configuration rule: Staff configuring an unconfigured card must provide destination links
  if (effectiveRole === "staff" && (!validatedLinks || validatedLinks.length === 0)) {
    return {
      success: false,
      error: "At least one destination link is required to configure a card.",
      status: 400,
    };
  }

  // Determine what actually changed
  const changes: Record<string, { before: unknown; after: unknown }> = {};

  if (business_name !== undefined && finalBusinessName !== existingCard.business_name) {
    changes.business_name = {
      before: existingCard.business_name,
      after: finalBusinessName,
    };
  }

  const existingNormalizedLocation = existingCard.location || null;
  const newNormalizedLocation = finalLocation || null;
  if (location !== undefined && existingNormalizedLocation !== newNormalizedLocation) {
    changes.location = {
      before: existingCard.location,
      after: finalLocation,
    };
  }

  if (validatedLinks !== null) {
    const currentLinks = (existingCard.links || []).map((l) => ({
      platform: l.platform,
      label: l.label,
      destination_url: l.destination_url,
      display_order: l.display_order,
      is_enabled: Boolean(l.is_enabled),
    }));
    const newLinks = validatedLinks.map((l) => ({
      platform: l.platform,
      label: l.label,
      destination_url: l.destination_url,
      display_order: l.display_order,
      is_enabled: Boolean(l.is_enabled),
    }));

    const linksChanged =
      currentLinks.length !== newLinks.length ||
      currentLinks.some(
        (curr, idx) =>
          curr.platform !== newLinks[idx].platform ||
          curr.label !== newLinks[idx].label ||
          curr.destination_url !== newLinks[idx].destination_url ||
          curr.display_order !== newLinks[idx].display_order ||
          curr.is_enabled !== newLinks[idx].is_enabled
      );

    if (linksChanged) {
      changes.links = {
        before: currentLinks.map(sanitizeLinkForAudit),
        after: newLinks.map(sanitizeLinkForAudit),
      };
    }
  }

  // If no fields changed, this is a no-op update: do not write an audit event or touch DB
  if (Object.keys(changes).length === 0) {
    return { success: true, card: existingCard };
  }

  const batchStatements: D1PreparedStatement[] = [];
  const isInitialConfiguration =
    existingCard.configured_at === null &&
    (validatedLinks !== null && validatedLinks.length > 0);

  // Update card fields
  if (effectiveRole === "staff") {
    // Concurrency-safe atomic conditional update for staff:
    // If another concurrent request has already stamped configured_at, the CASE statement
    // sets status to '__ALREADY_CONFIGURED_ABORT__', which violates the CHECK constraint
    // (CHECK (status IN ('active', 'inactive', 'archived'))) and aborts the entire transaction.
    batchStatements.push(
      env.DB.prepare(
        `UPDATE cards
         SET business_name = ?,
             location = ?,
             configured_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP,
             updated_by = ?,
             status = CASE
               WHEN configured_at IS NOT NULL THEN '__ALREADY_CONFIGURED_ABORT__'
               ELSE status
             END
         WHERE card_number = ?`
      ).bind(
        finalBusinessName,
        finalLocation,
        adminId,
        existingCard.card_number
      )
    );
  } else {
    // Main Admin update: can update configured or unconfigured cards; stamps configured_at when unconfigured card gets links
    batchStatements.push(
      env.DB.prepare(
        `UPDATE cards
         SET business_name = ?, location = ?, configured_at = CASE WHEN configured_at IS NULL AND ? > 0 THEN CURRENT_TIMESTAMP ELSE configured_at END, updated_at = CURRENT_TIMESTAMP, updated_by = ?
         WHERE card_number = ?`
      ).bind(
        finalBusinessName,
        finalLocation,
        validatedLinks ? validatedLinks.length : 0,
        adminId,
        existingCard.card_number
      )
    );
  }

  // If links array was provided and changed, atomically replace links
  if (validatedLinks !== null && changes.links) {
    batchStatements.push(
      env.DB.prepare("DELETE FROM card_links WHERE card_number = ?").bind(
        existingCard.card_number
      )
    );

    for (let i = 0; i < validatedLinks.length; i++) {
      const link = validatedLinks[i];
      batchStatements.push(
        env.DB.prepare(
          `INSERT INTO card_links (id, card_number, platform, label, destination_url, display_order, is_enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          existingCard.card_number,
          link.platform,
          link.label,
          link.destination_url,
          link.display_order,
          link.is_enabled ? 1 : 0
        )
      );
    }
  }

  // Atomically write audit event for card update or initial configuration
  const auditLogId = crypto.randomUUID();
  const auditAction = isInitialConfiguration ? "card.configured" : "card.updated";
  const auditDetails = JSON.stringify({
    card_number: existingCard.card_number,
    qr_type: existingCard.qr_type,
    ...(isInitialConfiguration ? { is_configured: true } : {}),
    changed_fields: Object.keys(changes),
    changes,
  });

  batchStatements.push(
    env.DB.prepare(
      `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, 'card', ?, ?, CURRENT_TIMESTAMP)`
    ).bind(
      auditLogId,
      adminId,
      auditAction,
      String(existingCard.card_number),
      auditDetails
    )
  );

  try {
    await env.DB.batch(batchStatements);
  } catch (err: unknown) {
    const errMsg = String(err);
    // Only attribute to staff concurrency abort if this is a staff update AND
    // the check constraint failure specifically targeted the intentional cards.status check
    const isStaffConcurrencyAbort =
      effectiveRole === "staff" &&
      (errMsg.includes("__ALREADY_CONFIGURED_ABORT__") ||
        (errMsg.includes("CHECK constraint failed") &&
          (errMsg.includes("status IN") || errMsg.includes("cards.status") || errMsg.includes("status")) &&
          !errMsg.includes("platform") &&
          !errMsg.includes("qr_type") &&
          !errMsg.includes("is_enabled")));

    if (isStaffConcurrencyAbort) {
      return {
        success: false,
        error: "Staff members are not permitted to edit already-configured cards.",
        status: 403,
      };
    }
    console.error("Failed to update card atomically:", err);
    return {
      success: false,
      error: "Database error while updating card.",
      status: 500,
    };
  }

  const updatedCard = await getCardByIdOrToken(env, existingCard.card_number);
  if (!updatedCard) {
    return {
      success: false,
      error: "Failed to reload updated card.",
      status: 500,
    };
  }

  return { success: true, card: updatedCard };
}

export type CardLifecycleAction =
  | "activate"
  | "deactivate"
  | "archive"
  | "restore";

export async function changeCardStatus(
  env: AppEnv,
  identifier: string | number,
  adminId: string,
  action: CardLifecycleAction,
): Promise<{ success: true; card: Card } | { success: false; error: string; status: number }> {
  const card = await getCardByIdOrToken(env, identifier);
  if (!card) {
    return {
      success: false,
      error: "Card not found.",
      status: 404,
    };
  }

  let newStatus: "active" | "inactive" | "archived";
  let auditAction:
    | "card.activated"
    | "card.deactivated"
    | "card.archived"
    | "card.restored";

  switch (action) {
    case "activate":
      if (card.status === "active") {
        return { success: false, error: "Card is already active.", status: 400 };
      }
      if (card.status === "archived") {
        return {
          success: false,
          error: "Archived cards cannot be activated directly. Please restore the card first.",
          status: 400,
        };
      }
      newStatus = "active";
      auditAction = "card.activated";
      break;

    case "deactivate":
      if (card.status === "inactive") {
        return { success: false, error: "Card is already inactive.", status: 400 };
      }
      if (card.status === "archived") {
        return {
          success: false,
          error: "Archived cards cannot be deactivated directly.",
          status: 400,
        };
      }
      newStatus = "inactive";
      auditAction = "card.deactivated";
      break;

    case "archive":
      if (card.status === "archived") {
        return { success: false, error: "Card is already archived.", status: 400 };
      }
      newStatus = "archived";
      auditAction = "card.archived";
      break;

    case "restore":
      if (card.status !== "archived") {
        return {
          success: false,
          error: "Only archived cards can be restored.",
          status: 400,
        };
      }
      // Rule 5: Restoring an archived card changes its status to inactive.
      newStatus = "inactive";
      auditAction = "card.restored";
      break;

    default:
      return { success: false, error: "Invalid lifecycle action.", status: 400 };
  }

  const auditLogId = crypto.randomUUID();
  const auditDetails = JSON.stringify({
    previous_status: card.status,
    new_status: newStatus,
    card_number: card.card_number,
    public_token: card.public_token,
  });

  const updateStmt = env.DB.prepare(
    `UPDATE cards
     SET status = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
     WHERE card_number = ?`
  ).bind(newStatus, adminId, card.card_number);

  const auditStmt = env.DB.prepare(
    `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, ?, 'card', ?, ?, CURRENT_TIMESTAMP)`
  ).bind(auditLogId, adminId, auditAction, String(card.card_number), auditDetails);

  try {
    await env.DB.batch([updateStmt, auditStmt]);
  } catch (err: unknown) {
    console.error("Failed to update card status atomically:", err);
    return {
      success: false,
      error: "Database error while updating card status.",
      status: 500,
    };
  }

  const updatedCard = await getCardByIdOrToken(env, card.card_number);
  if (!updatedCard) {
    return {
      success: false,
      error: "Failed to reload updated card.",
      status: 500,
    };
  }

  return { success: true, card: updatedCard };
}
