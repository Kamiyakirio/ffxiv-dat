export interface GameDirectoryApi {
  scan: () => Promise<string | null>;
}
