/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Solana wallet adapters ship ESM that Next's server compiler chokes on
  // when it tries to prerender pages importing them.
  transpilePackages: ["@solana/wallet-adapter-react-ui"],
};
export default nextConfig;
