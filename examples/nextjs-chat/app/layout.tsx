import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI SDK OTel Logger - Chat Example',
  description: 'Example chat app demonstrating ai-sdk-otel-logger',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
