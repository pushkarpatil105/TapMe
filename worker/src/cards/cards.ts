import type {
  AppEnv,
  Card,
  CardLink,
  CreateCardInput,
  CreateLinkInput,
  LinkPlatform,
  UpdateCardInput,
} from "../types";

export const ALLOWED_PLATFORMS = new Set<LinkPlatform>([
  "google_reviews",
  "instagram",
  "whatsapp",
  "other",
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

interface RawCardRow {
  card_number: number;
  public_token: string;
  business_name: string;
  location: string | null;
  status: "active" | "inactive" | "archived";
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

  if ("status" in rawBody || "created_at" in rawBody || "updated_at" in rawBody) {
    return {
      success: false,
      error: "status and timestamps cannot be set directly during card creation.",
      status: 400,
    };
  }

  const { business_name, location, links } = input;

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

  const publicToken = generatePublicToken();
  const batchStatements: D1PreparedStatement[] = [];

  // 1. Insert card
  batchStatements.push(
    env.DB.prepare(
      `INSERT INTO cards (public_token, business_name, location, status, created_by, updated_by)
       VALUES (?, ?, ?, 'active', ?, ?)`
    ).bind(publicToken, business_name.trim(), cleanLocation, adminId, adminId)
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
): Promise<{ success: true; card: Card } | { success: false; error: string; status: number }> {
  // Reject attempt to modify permanent card_number or public_token
  if ("card_number" in rawBody || "public_token" in rawBody) {
    return {
      success: false,
      error: "card_number and public_token are permanent and cannot be modified.",
      status: 400,
    };
  }

  if (
    "id" in rawBody ||
    "created_at" in rawBody ||
    "created_by" in rawBody ||
    "status" in rawBody
  ) {
    return {
      success: false,
      error: "System identifiers and status cannot be modified via this endpoint.",
      status: 400,
    };
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
    validatedLinks = linkValidation.links;
  }

  const batchStatements: D1PreparedStatement[] = [];

  // Update card fields
  batchStatements.push(
    env.DB.prepare(
      `UPDATE cards
       SET business_name = ?, location = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
       WHERE card_number = ?`
    ).bind(
      finalBusinessName,
      finalLocation,
      adminId,
      existingCard.card_number
    )
  );

  // If links array was provided, atomically replace links
  if (validatedLinks !== null) {
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

  try {
    await env.DB.batch(batchStatements);
  } catch (err: unknown) {
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
