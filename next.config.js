/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prevent webpack from bundling server-only packages.
  // @sendgrid/mail uses internal dynamic require() calls that produce
  // numbered chunks (e.g. ./276.js) which fail to resolve on Vercel.
  // Listing them here tells Next.js to leave them as native Node requires.
  experimental: {
    serverComponentsExternalPackages: [
      '@prisma/client',
      'prisma',
      '@sendgrid/mail',
      '@sendgrid/client',
    ],
  },
};

module.exports = nextConfig;
