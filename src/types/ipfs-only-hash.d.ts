declare module "ipfs-only-hash" {
  function of(content: string | Uint8Array): Promise<string>;
  export default {
    of: of,
  };
}
