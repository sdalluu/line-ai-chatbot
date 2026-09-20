import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Hostatom LINE Bot',
  description: 'LINE webhook service for Hostatom customer support',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
