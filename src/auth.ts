const BEARER = /^Bearer\s+(\S+)$/i;

export function readBearerToken(header: string | undefined): string | null {
  const match = BEARER.exec(header?.trim() ?? "");
  const token = match?.[1];
  if (!token?.startsWith("tk_")) return null;
  return token;
}
