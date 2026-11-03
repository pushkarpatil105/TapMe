export type AppEnv = Omit<
  Env,
  "ADMIN_ORIGINS" | "COOKIE_SAME_SITE" | "COOKIE_NAME"
> & {
  PASSWORD_PEPPER: string;
  ADMIN_ORIGINS: string;
  COOKIE_SAME_SITE: "Lax" | "Strict" | "None";
  COOKIE_NAME: string;
};

export type LinkPlatform =
  | "google_reviews"
  | "instagram"
  | "whatsapp"
  | "other";

export interface CardLink {
  id: string;
  card_number: number;
  platform: LinkPlatform;
  label: string;
  destination_url: string;
  display_order: number;
  is_enabled: boolean;
  created_at: string;
}

export interface Card {
  card_number: number;
  formatted_card_number: string;
  public_token: string;
  business_name: string;
  location: string | null;
  status: "active" | "inactive" | "archived";
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string | null;
  total_scans: number;
  links?: CardLink[];
}

export interface CreateLinkInput {
  platform: LinkPlatform;
  destination_url: string;
  label?: string;
  is_enabled?: boolean;
  display_order?: number;
}

export interface CreateCardInput {
  business_name: string;
  location?: string | null;
  links?: CreateLinkInput[];
}

export interface UpdateCardInput {
  business_name?: string;
  location?: string | null;
  links?: CreateLinkInput[];
}