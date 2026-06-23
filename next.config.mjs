/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  devIndicators: {
    appIsrStatus: false,
    buildActivity: false,
  },
  allowedDevOrigins: ['192.168.100.55', '192.168.100.55:3000'],
  transpilePackages: ['jwks-rsa', 'jose'],
};

export default nextConfig;
