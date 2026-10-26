// 2026-10-20: node-ip2region 没 @types/* 也没 .d.ts, 写一个简单 declaration
declare module 'node-ip2region' {
  interface Ip2RegionResult {
    city: number | string;
    region: string;  // '中国|0|山东省|深圳市|联通'
  }
  interface Ip2RegionInstance {
    binarySearchSync(ip: string): Ip2RegionResult | null;
    btreeSearchSync?(ip: string): Ip2RegionResult | null;
    binarySearch(ip: string, cb: (err: Error | null, r: Ip2RegionResult | null) => void): void;
    destroy(): void;
  }
  function create(): Ip2RegionInstance;
  namespace create {}  // namespace + function dual
  const _default: { create: () => Ip2RegionInstance };
  export default _default;
  export { create };
}
