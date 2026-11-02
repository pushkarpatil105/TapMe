export type AppEnv = Omit<
  Env,
  "ADMIN_ORIGINS" | "COOKIE_SAME_SITE" | "COOKIE_NAME"
> & {
  PASSWORD_PEPPER: string;
  ADMIN_ORIGINS: string;
  COOKIE_SAME_SITE: "Lax" | "Strict" | "None";
  COOKIE_NAME: string;
};