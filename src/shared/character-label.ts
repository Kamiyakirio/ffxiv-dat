/** Human-facing game ID; raw ContentId/WorldId values stay separate. */
export function formatGameId(id: unknown, server: unknown): string {
  const name = typeof id === 'string' ? id.trim() : '';
  const world = typeof server === 'string' ? server.trim() : '';
  const separator = name.lastIndexOf('@');
  if (separator > 0 && separator < name.length - 1) {
    return world ? `${name.slice(0, separator)}@${world}` : name;
  }
  return `${name || '未记录昵称'}@${world || '未知服务器'}`;
}
